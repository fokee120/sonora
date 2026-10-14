import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
test('migration removes only exact bundled IDs and retains personal catalog, playlists and audio bytes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { getDB, dbService } = await import(/* @vite-ignore */ String('/src/lib/db.ts'));
    const db = await getDB();
    const base = { title: 'My song', artist: 'Personal', album: 'Personal album', duration: 10, cloudKey: 'personal', trackNumber: 1, genre: '', year: 2026, addedAt: 1 };
    await dbService.saveTracks([{ ...base, id: 'demo-sample-m4a' }, { ...base, id: 'demo-user-recording' }, { ...base, id: 'gdrive:personal' }, { ...base, id: 'yt:abcdefghijk' }]);
    await dbService.saveAudioBlob('demo-sample-m4a', new Blob(['preserve bytes']));
    await dbService.savePlaylist({ id: 'personal-playlist', title: 'Mine', trackIds: ['gdrive:personal'], createdAt: 1, updatedAt: 1 });
    const { migrateLegacyCatalog } = await import(/* @vite-ignore */ String('/src/lib/legacyCatalogMigration.ts'));
    await migrateLegacyCatalog();
    return { ids: (await dbService.getAllTracks()).map(t => t.id), bytes: await (await dbService.getAudioBlob('demo-sample-m4a'))?.text(), playlist: await dbService.getPlaylist('personal-playlist') };
  });
  expect(result.ids).not.toContain('demo-sample-m4a');
  expect(result.ids).toEqual(expect.arrayContaining(['demo-user-recording', 'gdrive:personal', 'yt:abcdefghijk']));
  expect(result.bytes).toBe('preserve bytes');
  expect(result.playlist?.trackIds).toEqual(['gdrive:personal']);
});
test('fresh launch has an empty catalog and never requests local account or bucket APIs', async ({ page }) => {
  const calls: string[] = [];
  page.on('pageerror', error => console.error('PAGE ERROR', error.message));
  await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('/ytmusic/status')
    ? { searchAvailable: true, bridge: { mode: 'chromium' } }
    : { status: 'ok', tracks: [], albums: [], artists: [] } }));
  page.on('request', request => calls.push(new URL(request.url()).pathname));
  await page.goto('/');
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.getByText('0 tracks indexed')).toBeVisible();
  expect(calls.filter(path => path.startsWith('/api/auth/') || path.startsWith('/api/storage/'))).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect(page.locator('#settings-view')).toBeVisible();
  await expect(page.locator('#settings-view')).not.toContainText('GCS');
  await expect(page.locator('#settings-view')).toContainText('Chromium bridge');
  await expect(page.locator('#settings-view')).not.toContainText('Backend Missing');
});
