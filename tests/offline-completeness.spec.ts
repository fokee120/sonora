import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
test.use({ serviceWorkers: 'block' });
function wav(seconds: number) {
  const rate = 8000, size = Math.round(rate * seconds) * 2;
  const b = Buffer.alloc(44 + size);
  b.write('RIFF'); b.writeUInt32LE(size + 36, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(size, 40);
  for (let i = 0; i < size / 2; i++) b.writeInt16LE(Math.round(1000 * Math.sin(i * 2 * Math.PI * 440 / rate)), 44 + i * 2);
  return b;
}
const track = { id: 'ytm:abcdefghijk', source: 'ytmusic', sourceId: 'abcdefghijk', cloudKey: 'ytmusic://abcdefghijk', title: 'Offline completeness', artist: 'Fixture', album: 'Tests', duration: 120, format: 'wav' };
async function setup(page: Page, duration = track.duration) {
  await page.route('**/api/**', route => route.fulfill({ json: { user: null, authRequired: false, tracks: [{ ...track, duration }], albums: [], artists: [] } }));
  await page.goto('/');
  await page.evaluate(async fixture => {
    const path = '/src/lib/db.ts';
    await (await import(path)).dbService.saveTracks([fixture]);
  }, { ...track, duration });
  await page.reload();
  await expect(page.getByText(track.title).first()).toBeVisible();
}
async function state(page: Page) {
  return page.evaluate(async id => {
    const path = '/src/lib/offline/OfflineManager.ts';
    const { offlineManager } = await import(path);
    return { state: offlineManager.getDownloadState(id), stored: !!await offlineManager.audioStorage.get(id) };
  }, track.id);
}
test('five-second EOF is rejected before storing a long song and offers retry', async ({ page }) => {
  await setup(page);
  // Even a response claiming success must not override native decoded evidence.
  await page.route('**/api/ytmusic/download/**', route => route.fulfill({ body: wav(5), headers: { 'content-type': 'audio/wav', 'X-Audio-Complete': 'true', 'X-Audio-Duration': '120' } }));
  const row = page.locator(`[id="track-row-${track.id}"]`).first();
  await row.hover(); await row.getByTitle('Download for offline playback').click();
  await expect.poll(async () => (await state(page)).state?.status).toBe('failed');
  expect((await state(page)).stored).toBe(false);
  await expect(row.getByRole('alert')).toContainText(/incomplete|shorter/i);
  await expect(row.getByTitle('Retry download')).toBeVisible();
});

test('legacy truncated cache shows redownload, keeps catalog duration and other downloads', async ({ page, context }) => {
  await setup(page);
  await page.evaluate(async ({ track, bytes }) => {
    const offlinePath = '/src/lib/offline/OfflineManager.ts', playerPath = '/src/lib/audio/PlayerEngine.ts', dbPath = '/src/lib/db.ts';
    const { offlineManager: manager } = await import(offlinePath);
    await import(playerPath);
    const { dbService } = await import(dbPath);
    await dbService.saveTracks([track]);
    const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
    for (const id of [track.id, 'keep-other-download']) {
      await manager.audioStorage.save(id, blob);
      const state = { trackId: id, status: 'completed', progress: 100, bytesDownloaded: blob.size, totalBytes: blob.size };
      await dbService.saveDownloadState(state);
      (manager as any).downloadsCache.set(id, state);
    }
    (manager as any).notify();
  }, { track, bytes: [...wav(5)] });
  await context.setOffline(true);
  await page.getByText(track.title).first().click();
  await expect(page.locator('#bottom-player-bar').getByRole('alert')).toContainText(/incomplete.*retry the download/i);
  const result = await page.evaluate(async id => {
    const playerPath = '/src/lib/audio/PlayerEngine.ts', offlinePath = '/src/lib/offline/OfflineManager.ts';
    const { offlineManager: manager } = await import(offlinePath);
    return { player: (await import(playerPath)).playerEngine.getState(), other: manager.isTrackDownloaded('keep-other-download'), retained: !!await manager.audioStorage.get(id), state: manager.getDownloadState(id) };
  }, track.id);
  expect(result.player.currentTrack?.duration).toBe(120);
  expect(result.player.duration).toBe(120);
  expect(result.player.isPlaying).toBe(false);
  expect(result.other).toBe(true);
  expect(result.retained).toBe(true);
  expect(result.state?.status).toBe('failed');
  await context.setOffline(false);
  const row = page.locator(`[id="track-row-${track.id}"]`).first();
  await row.hover();
  await expect(row.getByTitle('Retry download')).toBeVisible();
});
for (const fixture of ['offline-complete.webm', 'offline-infinite.webm']) {
  test(`native Opus ${fixture} verifies and plays offline`, async ({ page, context }) => {
    const audio = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url));
    await setup(page, 3);
    const measured = await page.evaluate(async bytes => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const native = new Audio();
      const metadataDuration = await new Promise<number>((resolve, reject) => {
        native.onloadedmetadata = () => resolve(native.duration);
        native.onerror = () => reject(new Error('Fixture decode failed'));
        native.src = url;
      });
      native.removeAttribute('src'); native.load(); URL.revokeObjectURL(url);
      const path = '/src/lib/offline/audioCompleteness.ts';
      const actual = await (await import(path)).readAudioDuration(blob);
      return { finiteMetadata: Number.isFinite(metadataDuration), actual };
    }, [...audio]);
    expect(measured.finiteMetadata).toBe(fixture === 'offline-complete.webm');
    expect(measured.actual).toBeCloseTo(3, 1);
    await page.route('**/api/ytmusic/download/**', route => route.fulfill({ body: audio, headers: { 'content-type': 'audio/webm' } }));
    const row = page.locator(`[id="track-row-${track.id}"]`).first();
    await row.hover(); await row.getByTitle('Download for offline playback').click();
    await expect.poll(async () => (await state(page)).state?.status).toBe('completed');
    await context.setOffline(true);
    await page.getByText(track.title).first().click();
    await expect.poll(() => page.evaluate(async () => {
      const path = '/src/lib/audio/PlayerEngine.ts';
      const state = (await import(path)).playerEngine.getState();
      return state.isPlaying && state.playbackSource === 'local' && state.currentTime > 0;
    })).toBe(true);
  });
}

for (const [expected, actual] of [[26, 25], [5, 5], [0, 4]]) {
  test(`complete native WAV ${actual}s saves and plays offline (catalog ${expected}s)`, async ({ page, context }) => {
    await setup(page, expected);
    await page.route('**/api/ytmusic/download/**', route => route.fulfill({ body: wav(actual), headers: { 'content-type': 'audio/wav' } }));
    const row = page.locator(`[id="track-row-${track.id}"]`).first();
    await row.hover(); await row.getByTitle('Download for offline playback').click();
    await expect.poll(async () => (await state(page)).state?.status).toBe('completed');
    expect((await state(page)).stored).toBe(true);
    await context.setOffline(true);
    await page.getByText(track.title).first().click();
    await expect.poll(() => page.evaluate(async () => {
      const path = '/src/lib/audio/PlayerEngine.ts';
      const state = (await import(path)).playerEngine.getState();
      return state.isPlaying && state.playbackSource === 'local' && state.currentTime > 0;
    })).toBe(true);
    const player = await page.evaluate(async () => {
      const path = '/src/lib/audio/PlayerEngine.ts';
      return (await import(path)).playerEngine.getState();
    });
    expect(player.currentTrack?.duration).toBe(expected || actual);
    expect(player.error).toBeNull();
  });
}
