import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
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


const track = { id: 'ytm:abc-def_123', source: 'ytmusic', sourceId: 'abc-def_123', cloudKey: 'ytmusic://abc-def_123', title: 'YouTube Test', artist: 'Artist', album: 'YouTube Music', duration: 4, format: 'mp3' };
for (const failure of [false, true]) {
  test(failure ? 'shows provider error instead of unsupported source' : 'YouTube audio plays and seeks in native player', async ({ page }) => {
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/ytmusic/stream/')) {
        if (failure) return route.fulfill({ status: 502, json: { error: 'Stream failed', details: 'Sonora Audio Service is unavailable.' } });
        const audio = wav();
        const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
        const start = range ? Number(range[1]) : 0;
        const end = range && range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
        return route.fulfill({ status: range ? 206 : 200, body: audio.subarray(start, end + 1), headers: {
          'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': String(end - start + 1),
          ...(range ? { 'content-range': 'bytes ' + start + '-' + end + '/' + audio.length } : {}),
        } });
      }
      return route.fulfill({ json: path === '/api/auth/session' ? { user: null, isAuthenticated: false, authRequired: false, authorizedEmails: [] } : { tracks: [], albums: [], artists: [] } });
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(async track => {
      const path = '/src/lib/audio/PlayerEngine.ts';
      await (await import(path)).playerEngine.playTrack(track);
    }, track);
    const state = () => page.evaluate(async () => {
      const path = '/src/lib/audio/PlayerEngine.ts';
      return (await import(path)).playerEngine.getState();
    });
    if (failure) {
      expect((await state()).error).toContain('YouTube MP3 could not be decoded');
      expect((await state()).isLoading).toBe(false);
    } else {
      await expect.poll(async () => (await state()).currentTime).toBeGreaterThan(0);
      await page.evaluate(async () => {
        const path = '/src/lib/audio/PlayerEngine.ts';
        (await import(path)).playerEngine.seek(2);
      });
      expect((await state()).currentTime).toBeGreaterThanOrEqual(2);
      expect((await state()).error).toBeNull();
      expect(await page.locator('iframe').count()).toBe(0);
    }
  });
}

test('audio backend reports HTTP failure instead of a generic connection error', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'NOT_FOUND' }));
  await page.goto('/');
    await page.waitForLoadState('networkidle');
  const message = await page.evaluate(async () => {
    const path = '/src/lib/ytmusic/youtubeMusic.ts';
    try { await (await import(path)).testAudioBackend(); return ''; }
    catch (error) { return (error as Error).message; }
  });
  expect(message).toContain('HTTP 404');
});

test('YouTube playback uses the audio element stream instead of fetch blob buffering', async ({ page }) => {
  const audio = wav();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/ytmusic/stream/')) {
      return route.fulfill({
        status: 200,
        body: audio,
        headers: { 'content-type': 'audio/wav', 'content-length': String(audio.length) },
      });
    }
    return route.fulfill({ json: path === '/api/auth/session' ? { user: null, isAuthenticated: false, authRequired: false, authorizedEmails: [] } : { tracks: [], albums: [], artists: [] } });
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async track => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/ytmusic/stream/')) {
        throw new Error('YouTube playback should not fetch and blob-buffer the stream');
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    const originalBlob = Response.prototype.blob;
    Response.prototype.blob = function blobGuard() {
      throw new Error('YouTube playback should not call response.blob()');
    };
    try {
      const path = '/src/lib/audio/PlayerEngine.ts';
      await (await import(path)).playerEngine.playTrack(track);
    } finally {
      Response.prototype.blob = originalBlob;
      window.fetch = originalFetch;
    }
  }, track);
  const state = () => page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    return (await import(path)).playerEngine.getState();
  });
  await expect.poll(async () => (await state()).currentTime).toBeGreaterThan(0);
});
