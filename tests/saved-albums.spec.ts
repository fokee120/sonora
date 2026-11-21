import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { wave } from './fixtures/bridge-media';

test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, serviceWorkers: 'block' });

const release = {
  browseId: 'MPREalbumfixture', title: 'Blueprints and Echoes', artist: 'Fixture artist',
  year: 2025, artworkUrl: '/fixture-album-cover.svg',
};
const albumId = 'catalog:' + release.browseId;
const songs = ['First Impression', 'Last Echo'].map((title, index) => ({
  videoId: 'album00000' + (index + 1), title, artist: release.artist,
  album: release.title, durationSeconds: 12,
}));
const trackIds = songs.map(song => 'ytm:' + song.videoId);

function remoteLibrary() {
  return {
    offline: false, revision: 1, browseCalls: [] as string[], downloads: [] as string[],
    data: { playlists: {
      mix: { id: 'mix', title: 'My mix', trackIds: [] as string[], createdAt: 1, updatedAt: 1 },
    }, albums: {} as Record<string, { title: string; tracks: { id: string; title: string }[] }> },
  };
}

async function mockService(context: BrowserContext, remote: ReturnType<typeof remoteLibrary>) {
  await context.route('**/fixture-album-cover.svg', route => remote.offline
    ? route.abort()
    : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#384c92"/><circle cx="34" cy="32" r="17" fill="#fa9869"/></svg>' }));
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (remote.offline) return route.abort('connectionrefused');
    if (path === '/api/account/session') {
      return route.fulfill({ json: { profile: { uid: 'album-owner', displayName: 'Fixture' }, expiresAt: Date.now() + 86_400_000 } });
    }
    if (path === '/api/account/library') {
      const { revision, changes } = route.request().postDataJSON();
      if (!changes.length && revision === remote.revision) return route.fulfill({ json: { revision, unchanged: true } });
      for (const { collection, id, value } of changes) {
        const records = (remote.data as Record<string, Record<string, unknown>>)[collection] ??= {};
        if (value === null) delete records[id];
        else records[id] = value;
      }
      if (changes.length) remote.revision++;
      return route.fulfill({ json: { revision: remote.revision, collections: remote.data } });
    }
    if (path === '/api/ytmusic/search' && url.searchParams.get('filter') === 'albums') {
      return route.fulfill({ json: { albums: [release] } });
    }
    if (path === '/api/ytmusic/browse/' + release.browseId) {
      const next = url.searchParams.get('continuation');
      remote.browseCalls.push(next || 'first');
      return route.fulfill({ json: {
        ...release, kind: 'album', albums: [], songs: next ? songs.slice(1) : songs.slice(0, 1),
        continuation: next ? undefined : 'album-next',
      } });
    }
    if (path.startsWith('/api/ytmusic/download/')) {
      remote.downloads.push(path.split('/').at(-1)!);
      return route.fulfill({ contentType: 'audio/wav', body: wave(12), headers: {
        'X-Audio-Complete': 'true', 'X-Audio-Duration': '12',
      } });
    }
    return route.fulfill({ json: { status: 'ok', songs: [], tracks: [], artists: [], albums: [] } });
  });
}

async function library(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
}

async function openFromSearch(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('#search-view').getByRole('button', { name: 'Albums', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search songs' }).fill(release.title);
  await page.locator('#search-view .catalog-card').filter({ hasText: release.title }).click();
  await expect(page.getByRole('heading', { name: release.title })).toBeVisible();
}

async function saveAlbum(page: Page) {
  await openFromSearch(page);
  await page.getByRole('button', { name: 'Save album', exact: true }).click();
  await page.getByRole('dialog', { name: 'Save album' }).getByRole('button', { name: 'Save to Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'In Library', exact: true })).toBeVisible();
}

test('saving a release creates a separate album with the full original track list and syncs it', async ({ page, context, browser }) => {
  const remote = remoteLibrary();
  await mockService(context, remote);
  await page.goto('/');
  await saveAlbum(page);
  await expect.poll(() => remote.data.albums[albumId]?.tracks.map(track => track.id)).toEqual(trackIds);
  expect(remote.browseCalls).toEqual(['first', 'album-next']);
  expect(Object.keys(remote.data.playlists)).toEqual(['mix']);

  await library(page);
  await page.getByRole('tab', { name: 'Playlists' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Playlists' }).getByText(release.title)).toHaveCount(0);
  await page.getByRole('tab', { name: 'Albums' }).click();
  const card = page.getByRole('tabpanel', { name: 'Albums' }).getByRole('button', { name: new RegExp(release.title) });
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toBeVisible();
  await card.click();
  await expect(page.locator('#album-detail-view .track-row-slot')).toHaveCount(2);
  await page.getByRole('button', { name: 'In Library', exact: true }).click();
  await page.getByRole('dialog', { name: 'Save album' }).getByRole('button', { name: 'My mix', exact: true }).click();
  await expect.poll(() => remote.data.playlists.mix.trackIds).toEqual(trackIds);
  expect(remote.data.albums[albumId].tracks.map(track => track.id)).toEqual(trackIds);
  await page.getByRole('button', { name: 'Back to Library' }).click();
  await expect(page.getByRole('tab', { name: 'Albums' })).toHaveAttribute('aria-selected', 'true');

  const otherDevice = await browser.newContext({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });
  try {
    await mockService(otherDevice, remote);
    const otherPage = await otherDevice.newPage();
    await otherPage.goto(page.url());
    await library(otherPage);
    await otherPage.getByRole('tab', { name: 'Albums' }).click();
    await expect(otherPage.getByRole('tabpanel', { name: 'Albums' }).getByText(release.title, { exact: true })).toBeVisible();
  } finally { await otherDevice.close(); }
});

test('saved albums load from the device and play their downloaded tracks during an outage', async ({ page, context }) => {
  const remote = remoteLibrary();
  await mockService(context, remote);
  await page.goto('/');
  await saveAlbum(page);
  await page.getByRole('button', { name: 'Download album', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove album download', exact: true })).toBeVisible();
  expect(remote.downloads.sort()).toEqual(songs.map(song => song.videoId).sort());

  const cover = page.locator('.album-profile-art img');
  await expect(cover).toHaveAttribute('src', /^blob:/);
  await page.evaluate(async id => {
    const path = '/src/lib/offline/OfflineManager.ts';
    await (await import(path)).offlineManager.removeTrackDownload(id);
  }, trackIds[0]);
  remote.offline = true;
  await page.reload();
  await expect(page.getByRole('button', { name: /Offline mode/ })).toBeVisible();
  const previousCatalogRequests = remote.browseCalls.length;
  await library(page);
  await page.getByRole('tab', { name: 'Albums' }).click();
  await page.getByRole('tabpanel', { name: 'Albums' }).getByText(release.title, { exact: true }).click();
  await expect(page.locator('.album-profile-art img')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('#album-detail-view .track-row-slot')).toHaveCount(2);
  const first = page.locator('#album-detail-view [data-track-id="' + trackIds[0] + '"] .track-row');
  const second = page.locator('#album-detail-view [data-track-id="' + trackIds[1] + '"] .track-row');
  await expect(first).toHaveAttribute('data-offline-unavailable', 'true');
  await expect(second).not.toHaveAttribute('data-offline-unavailable', 'true');
  await page.locator('#album-detail-view').getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const state = (await import(path)).playerEngine.getState();
    return { id: state.currentTrack?.id, playing: state.isPlaying, source: state.playbackSource };
  })).toEqual({ id: trackIds[1], playing: true, source: 'local' });
  expect(remote.browseCalls.length).toBe(previousCatalogRequests);

  await page.getByRole('button', { name: 'In Library', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from Library', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Albums' }).getByText(release.title)).toHaveCount(0);
  expect(await page.evaluate(async id => {
    const path = '/src/lib/db.ts';
    return (await (await import(path)).dbService.getDownloadState(id))?.status;
  }, trackIds[1])).toBe('completed');
});
