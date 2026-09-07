import { test, expect, type Page } from '@playwright/test';
import scanHandler from '../api/drive/scan.js';

function wav(seconds = 4): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < dataSize / 2; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 1000), 44 + i * 2);
  return buffer;
}

const audio = wav();
const track = {
  id: 'gdrive:test-file', title: 'Test Song', artist: 'Test Artist', album: 'Google Drive Audio',
  duration: 0, cloudKey: 'gdrive://test-file/Test%20Song%20-%20Test%20Artist.wav',
  sizeBytes: audio.length, format: 'WAV', metadataKey: 'test-v1',
};

async function setup(page: Page) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/library' ? { tracks: [track], albums: [], artists: [] }
      : path === '/api/auth/session' ? { user: null, isAuthenticated: false, authRequired: false, authorizedEmails: [] }
      : path === '/api/health' ? { status: 'ok' } : {};
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await expect(page.getByText('Test Song').first()).toBeVisible();
  // Supply a synthetic OAuth token after Firebase's initial signed-out callback.
  await page.evaluate(async () => {
    const modulePath = '/src/lib/googleAuth.ts';
    const { auth } = await import(modulePath);
    await auth.authStateReady();
    localStorage.setItem('gdrive_access_token', 'test-only-token');
  });
}

async function serveAudio(page: Page, requests: string[]) {
  await page.route('https://www.googleapis.com/drive/v3/files/**', async route => {
    expect(route.request().headers().authorization).toBe('Bearer test-only-token');
    expect(route.request().url()).not.toContain('test-only-token');
    requests.push(route.request().url());
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d+)/);
    const start = range ? Number(range[1]) : 0;
    const end = range ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    await route.fulfill({ status: range ? 206 : 200, body: audio.subarray(start, end + 1), headers: {
      'content-type': 'audio/wav', 'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${audio.length}`,
      'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Length, Content-Range',
    } });
  });
}

test('scan paginates the whole Drive and reads Song - Artist filenames without invented durations', async () => {
  const original = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    urls.push(url);
    return Response.json(urls.length === 1
      ? { nextPageToken: 'next', files: [{ id: 'one', name: 'A Song - Tame Impala.mp3', size: '100', modifiedTime: 'today' }] }
      : { files: [{ id: 'two', name: 'Afterthought - Joji, BENEE.MP3' }, { id: 'three', name: 'notes.txt' }] });
  };
  let status = 0;
  let payload: any;
  try {
    await scanHandler({ method: 'POST', headers: { authorization: 'Bearer test-only-token' }, body: {} }, {
      setHeader() {}, status(code) { status = code; return { json(value) { payload = value; } }; },
    });
  } finally { globalThis.fetch = original; }
  expect(status).toBe(200);
  expect(payload.tracks).toHaveLength(2);
  expect(payload.tracks[0]).toMatchObject({ title: 'A Song', artist: 'Tame Impala', duration: 0 });
  expect(payload.tracks[1]).toMatchObject({ title: 'Afterthought', artist: 'Joji, BENEE' });
  expect(new Set(payload.albums.map((album: any) => album.id)).size).toBe(2);
  expect(urls[0].searchParams.get('q')).not.toContain('parents');
  expect(urls[1].searchParams.get('pageToken')).toBe('next');
});

test('Drive playback advances, reports real duration, and can seek', async ({ page }) => {
  const requests: string[] = [];
  await serveAudio(page, requests);
  await setup(page);
  await page.getByText('Test Song').first().click();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    return (await import(path)).playerEngine.getState().currentTime;
  })).toBeGreaterThan(0);
  const state = await page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const { playerEngine } = await import(path);
    playerEngine.seek(2);
    return playerEngine.getState();
  });
  expect(state.duration).toBeCloseTo(4);
  expect(state.currentTime).toBe(2);
  expect(state.error).toBeNull();
  expect(requests).toHaveLength(1);
});

test('metadata reads byte ranges and finds the actual duration', async ({ page }) => {
  const requests: string[] = [];
  await serveAudio(page, requests);
  await setup(page);
  const duration = await page.evaluate(async track => {
    const path = '/src/lib/audio/driveMetadata.ts';
    return (await import(path)).readDriveDuration(track);
  }, track);
  expect(duration).toBeCloseTo(4);
  expect(requests.length).toBeGreaterThan(0);
});

test('download button saves actual audio and plays it while offline', async ({ page, context }) => {
  const requests: string[] = [];
  await serveAudio(page, requests);
  await setup(page);
  const row = page.locator('[id="track-row-gdrive:test-file"]').first();
  await row.hover();
  await row.getByTitle('Download for offline playback').click();
  await expect(row.getByTitle('Downloaded offline. Click to remove from local storage.')).toBeVisible();
  const saved = await page.evaluate(async () => {
    const path = '/src/lib/db.ts';
    const blob = await (await import(path)).dbService.getAudioBlob('gdrive:test-file');
    return { size: blob.size, type: blob.type };
  });
  expect(saved).toEqual({ size: audio.length, type: 'audio/wav' });
  await context.setOffline(true);
  await row.getByText('Test Song', { exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const state = (await import(path)).playerEngine.getState();
    return state.isPlaying && state.playbackSource === 'local';
  })).toBe(true);
  expect(requests).toHaveLength(1);
});

test('expired Drive authorization produces a visible error and a download retry', async ({ page }) => {
  await page.route('https://www.googleapis.com/drive/v3/files/**', route => route.fulfill({ status: 401, json: { error: { message: 'Expired' } } }));
  await setup(page);
  const row = page.locator('[id="track-row-gdrive:test-file"]').first();
  await row.hover();
  await row.getByTitle('Download for offline playback').click();
  await expect(row.getByRole('alert')).toContainText('authorization expired');
  await expect(row.getByTitle('Retry download')).toBeVisible();
  await row.getByText('Test Song', { exact: true }).click();
  await expect(page.locator('#bottom-player-bar').getByRole('alert')).toContainText('authorization expired');
});

for (const granted of [true, false]) {
  test(`storage protection reports ${granted ? 'approval' : 'denial'}`, async ({ page }) => {
    await page.addInitScript(granted => {
      let persisted = false;
      Object.defineProperty(navigator.storage, 'persisted', { value: async () => persisted });
      Object.defineProperty(navigator.storage, 'persist', { value: async () => { persisted = granted; return persisted; } });
    }, granted);
    await setup(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('button', { name: 'Request Persistent Storage' }).click();
    await expect(page.getByRole('status')).toContainText(granted ? 'protection is enabled' : 'did not grant protection');
    await expect(page.getByText(granted ? 'Storage is Persistent' : 'Storage is Best-Effort', { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/storage-${granted}.png`, fullPage: true });
  });
}

test('unsupported storage feedback fits a mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { value: undefined });
  });
  await setup(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
  await page.getByRole('button', { name: 'Request Persistent Storage' }).click();
  await expect(page.getByRole('status')).toContainText('does not support');
  const bounds = await page.getByRole('status').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/storage-mobile.png', fullPage: true });
});
