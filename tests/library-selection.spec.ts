import { test, expect, type Locator, type Page } from '@playwright/test';

test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });

const songs = ['First', 'Shared', 'Last'].map((title, i) => ({
  id: 'ytm:song000000' + i, title, artist: 'Fixture artist', album: 'Fixture album', duration: 12,
  cloudKey: 'ytmusic://song000000' + i, source: 'ytmusic',
}));
const originPlaylists = [
  { id: 'first-mix', title: 'First mix', trackIds: [songs[0].id, songs[1].id], createdAt: 2, updatedAt: 2, playback: { sort: 'date-old' } },
  { id: 'second-mix', title: 'Second mix', trackIds: [songs[1].id, songs[2].id], createdAt: 1, updatedAt: 1, playback: { sort: 'date-old' } },
];
const originAlbums = ['First album', 'Second album'].map((title, index) => ({
  id: 'catalog:MPREfixture' + index, title, artist: 'Fixture artist', trackCount: 2, duration: 24,
  tracks: songs.slice(index, index + 2), savedAt: 2 - index,
}));

async function goToLibrary(page: Page) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Library', exact: true }).tap();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/api/account/session'
      ? { profile: { uid: 'library-selection-fixture' }, expiresAt: Date.now() + 86_400_000 }
      : { status: 'ok', unchanged: true, tracks: [], songs: [], albums: [], artists: [] } });
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.evaluate(async ({ songs, originPlaylists, originAlbums }) => {
    const dbPath = '/src/lib/db.ts';
    const { dbService } = await import(dbPath);
    await dbService.saveTracks(songs.slice(0, 2));
    await dbService.saveAlbums(originAlbums);
    for (const playlist of originPlaylists) await dbService.savePlaylist(playlist);
    await dbService.saveAudioBlob(songs[0].id, new Blob(['audio fixture']));
  }, { songs, originPlaylists, originAlbums });
  await page.reload();
  await goToLibrary(page);
});

async function holdCollection(page: Page, item: Locator) {
  await item.scrollIntoViewIfNeeded();
  const bounds = (await item.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
    });
    await expect(item).toHaveAttribute('aria-pressed', 'true');
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await client.detach(); }
  await expect(item).toHaveAttribute('aria-pressed', 'true');
}

test('long pressing a playlist selects it and merges without removing the originals', async ({ page }) => {
  const first = page.getByRole('button', { name: /^First mix/ });
  await holdCollection(page, first);
  const actions = page.getByRole('group', { name: 'Selection actions' });
  const merge = actions.getByRole('button', { name: 'Merge', exact: true });
  await expect(merge).toBeDisabled();
  await page.getByRole('button', { name: /^Second mix/ }).tap();
  await expect(actions).toContainText('2 selected');
  await merge.tap();
  const dialog = page.getByRole('dialog', { name: 'Merge playlists' });
  await dialog.getByLabel('New playlist name').fill('Combined mix');
  await dialog.getByRole('button', { name: 'Merge', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Combined mix', exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const path = '/src/lib/db.ts';
    return (await import(path)).dbService.getAllPlaylists();
  });
  expect(saved.map((p: { title: string }) => p.title)).toEqual(expect.arrayContaining(['First mix', 'Second mix', 'Combined mix']));
  expect(saved.find((p: { title: string }) => p.title === 'Combined mix')?.trackIds).toEqual(songs.map(song => song.id));
});

test('album selection merges complete album tracks into a playlist and can remove saved albums', async ({ page }) => {
  const albumsTab = page.getByRole('tab', { name: 'Albums' });
  await albumsTab.tap();
  await holdCollection(page, page.getByRole('button', { name: /^First album/ }));
  await page.getByRole('button', { name: /^Second album/ }).tap();
  await page.getByRole('button', { name: 'Merge', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Merge albums' });
  await dialog.getByRole('button', { name: 'Merge', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Merged albums', exact: true })).toBeVisible();
  await expect(page.locator('#playlist-detail-view .track-row-slot')).toHaveCount(3);
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page.getByRole('tab', { name: 'Playlists' })).toHaveAttribute('aria-selected', 'true');
  await albumsTab.tap();
  const first = page.getByRole('button', { name: /^First album/ });
  const second = page.getByRole('button', { name: /^Second album/ });
  await expect(second).toBeVisible();
  await holdCollection(page, first);
  await second.tap();
  await page.getByRole('button', { name: 'Remove albums', exact: true }).tap();
  await page.getByRole('dialog', { name: 'Remove from Library' }).getByRole('button', { name: 'Remove', exact: true }).tap();
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);
  const saved = await page.evaluate(async id => {
    const path = '/src/lib/db.ts';
    const { dbService } = await import(path);
    return { audio: await dbService.getAudioBlob(id).then((blob: Blob) => blob?.text()), tracks: await dbService.getAllTracks() };
  }, songs[0].id);
  expect(saved.audio).toBe('audio fixture');
  expect(saved.tracks.map((t: { id: string }) => t.id).sort()).toEqual(songs.map(song => song.id));
});

test('scrolling does not select or open playlists, and bulk removal asks for confirmation', async ({ page }) => {
  const first = page.getByRole('button', { name: /^First mix/ });
  const bounds = (await first.boundingBox())!;
  const x = bounds.x + 42;
  const y = bounds.y + 24;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 48 }] });
    await page.waitForTimeout(530);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await client.detach(); }
  await expect(page.getByRole('group', { name: 'Selection actions' })).toHaveCount(0);
  await expect(page.locator('#playlist-detail-view')).toHaveCount(0);

  await holdCollection(page, first);
  await page.getByRole('button', { name: /^Second mix/ }).tap();
  await page.getByRole('button', { name: 'Remove playlists', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Remove from Library' });
  await dialog.getByRole('button', { name: 'Cancel' }).tap();
  await expect(first).toBeVisible();
  await page.getByRole('button', { name: 'Remove playlists', exact: true }).tap();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).tap();
  await expect(first).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Second mix/ })).toHaveCount(0);
});
