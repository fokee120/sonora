import { test, expect } from '@playwright/test';
import api from '../src/server/ytmusic/api.js';
import { downloaderService } from '../src/server/ytmusic/DownloaderService.js';

// Opt-in integration: real Cobalt media, with only catalog/auth fixtures mocked.
test.use({ serviceWorkers: 'block' });
test('real Cobalt MP3 plays, seeks, downloads through the button and plays offline', async ({ page, context }) => {
  test.skip(!process.env.COBALT_LIVE_URL, 'Set COBALT_LIVE_URL to your running Cobalt instance.');
  test.setTimeout(120000);
  downloaderService.setConfig({ enabled: true, url: process.env.COBALT_LIVE_URL!, audioFormat: 'mp3' });
  const server = api.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  const track = { id: 'ytm:dQw4w9WgXcQ', source: 'ytmusic', sourceId: 'dQw4w9WgXcQ', cloudKey: 'ytmusic://dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: 'Whenever You Need Somebody', duration: 214, format: 'mp3' };
  const requests: string[] = [];
  try {
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (/\/api\/ytmusic\/(stream|download)\//.test(path)) {
        expect(route.request().headers().range).toBeUndefined();
        requests.push(path);
        const response = await route.fetch({ url: `http://127.0.0.1:${port}${path}`, timeout: 90000 });
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('audio/mpeg');
        return route.fulfill({ response });
      }
      return route.fulfill({ json: path === '/api/auth/session'
        ? { user: null, isAuthenticated: false, authRequired: false, authorizedEmails: [] }
        : { tracks: [track], albums: [], artists: [] } });
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const row = page.locator('[id="track-row-ytm:dQw4w9WgXcQ"]').first();
    await row.getByText(track.title, { exact: true }).click();
    const state = () => page.evaluate(async () => {
      const path = '/src/lib/audio/PlayerEngine.ts';
      return (await import(path)).playerEngine.getState();
    });
    await expect.poll(async () => (await state()).currentTime, { timeout: 60000 }).toBeGreaterThan(0);
    expect((await state()).error).toBeNull();
    await page.evaluate(async () => {
      const path = '/src/lib/audio/PlayerEngine.ts';
      (await import(path)).playerEngine.seek(90);
    });
    await expect.poll(async () => (await state()).currentTime).toBeGreaterThanOrEqual(90);
    expect((await state()).duration).toBeGreaterThan(200);
    await row.hover();
    await row.getByTitle('Download for offline playback').click();
    await expect(row.getByTitle('Downloaded offline. Click to remove from local storage.')).toBeVisible({ timeout: 60000 });
    const saved = await page.evaluate(async () => {
      const path = '/src/lib/db.ts';
      const blob = await (await import(path)).dbService.getAudioBlob('ytm:dQw4w9WgXcQ');
      return { size: blob.size, type: blob.type };
    });
    expect(saved.size).toBeGreaterThan(1000000);
    expect(saved.type).toBe('audio/mpeg');
    await context.setOffline(true);
    await page.evaluate(async track => {
      const path = '/src/lib/audio/PlayerEngine.ts';
      await (await import(path)).playerEngine.playTrack(track);
    }, track);
    await expect.poll(async () => { const s = await state(); return s.isPlaying && s.playbackSource === 'local'; }).toBe(true);
    expect(requests.filter(p => p.includes('/stream/'))).toHaveLength(1);
    expect(requests.filter(p => p.includes('/download/'))).toHaveLength(1);
    expect(await page.locator('iframe').count()).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
