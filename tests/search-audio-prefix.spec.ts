import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const mp3 = readFileSync('tests/fixtures/offline-complete.mp3');

test.use({ serviceWorkers: 'block', viewport: { width: 402, height: 874 } });

const songs = (first: number) => Array.from({ length: 3 }, (_, index) => ({
  videoId: 'prefix' + String(first + index).padStart(5, '0'),
  title: 'Search result ' + (first + index),
  artist: 'Fixture artist',
  durationSeconds: 180,
}));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account/session') {
      return route.fulfill({ json: { profile: { uid: 'fixture' }, expiresAt: Date.now() + 86400000 } });
    }
    return route.fulfill({ json: { unchanged: true, status: 'ok', tracks: [], songs: [], artists: [], albums: [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  await page.evaluate(async () => {
    const path = '/src/lib/offline/AudioCache.ts';
    await (await import(path)).audioCache.setLimit(.1);
  });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Search', exact: true }).click();
});

test('search caches only the two highest results from each source', async ({ page }) => {
  const music = songs(1), videos = songs(4);
  const calls: string[] = [];
  await page.route('**/api/ytmusic/search?*', route => route.fulfill({ json: { songs: music } }));
  await page.route('**/api/youtube/search?*', route => route.fulfill({ json: { songs: videos } }));
  await page.route('**/api/ytmusic/prefix/**', route => {
    const url = new URL(route.request().url());
    calls.push(url.pathname.split('/').at(-1) + url.search);
    return route.fulfill({ status: 204, headers: {
      'X-Audio-Asset': url.pathname.split('/').at(-1)!,
      'X-Audio-Prefix-Bytes': '320',
      'X-Audio-Expires': String(Date.now() + 3600000),
    } });
  });
  const cached = () => page.evaluate(async () => {
    const path = '/src/lib/db.ts';
    const db = await (await import(path)).getDB();
    return db.getAllKeys('autoAudio');
  });

  await page.getByRole('searchbox', { name: 'Search songs' }).fill('fixture');
  await expect(page.getByText(music[2].title, { exact: true })).toBeVisible();
  await expect.poll(cached).toEqual(music.slice(0, 2).map(song => 'ytm:' + song.videoId));

  await page.getByRole('button', { name: 'YouTube', exact: true }).click();
  await expect(page.getByText(videos[2].title, { exact: true })).toBeVisible();
  const expected = [...music.slice(0, 2), ...videos.slice(0, 2)];
  await expect.poll(cached).toEqual(expected.map(song => 'ytm:' + song.videoId));
  expect([...calls].sort()).toEqual(expected.map(song => song.videoId + '?seconds=5').sort());
});

test('a new query cancels obsolete preview work', async ({ page }) => {
  const old = songs(1), fresh = songs(7);
  await page.route('**/api/ytmusic/search?*', route => route.fulfill({
    json: { songs: new URL(route.request().url()).searchParams.get('q') === 'old' ? old : fresh },
  }));
  const calls: string[] = [];
  let finishOld!: () => void;
  const oldGate = new Promise<void>(resume => { finishOld = resume; });
  await page.route('**/api/ytmusic/prefix/**', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    calls.push(id);
    if (old.slice(0, 2).some(song => song.videoId === id)) await oldGate;
    await route.fulfill({ status: 204, headers: {
      'X-Audio-Asset': id, 'X-Audio-Prefix-Bytes': '320',
      'X-Audio-Expires': String(Date.now() + 3600000),
    } }).catch(() => {});
  });
  const search = page.getByRole('searchbox', { name: 'Search songs' });
  try {
    await search.fill('old');
    await expect.poll(() => [...calls].sort()).toEqual(old.slice(0, 2).map(song => song.videoId));
    await search.fill('fresh');
    await expect.poll(() => [...calls].sort()).toEqual([...old.slice(0, 2), ...fresh.slice(0, 2)].map(song => song.videoId));
  } finally { finishOld(); }
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/db.ts';
    return (await (await import(path)).getDB()).getAllKeys('autoAudio');
  })).toEqual(fresh.slice(0, 2).map(song => 'ytm:' + song.videoId));
});

test('desktop starts with MP3 even when the source cannot precache', async ({ page }) => {
  const [song] = songs(20);
  const requested: string[] = [];
  await page.route('**/api/ytmusic/search?*', route => route.fulfill({ json: { songs: [song] } }));
  await page.route('**/api/ytmusic/prefix/**', route => route.fulfill({ status: 422 }));
  await page.route('**/api/ytmusic/stream/**', route => {
    const query = new URL(route.request().url()).searchParams;
    requested.push(query.get('format') ?? '');
    expect(query.has('delivery')).toBe(false);
    return route.fulfill({ contentType: 'audio/mpeg', body: mp3 });
  });
  await page.getByRole('searchbox', { name: 'Search songs' }).fill('direct mp3');
  await page.getByText(song.title, { exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const state = (await import(path)).playerEngine.getState();
    return state.isPlaying && state.currentTime > 0;
  })).toBe(true);
  expect(requested).toEqual(['mp3']);
});


test('previews from an earlier server run are refreshed on the next search', async ({ page }) => {
  let generation = 'first';
  const [song] = songs(30);
  await page.route('**/api/health?*', route => route.fulfill({ json: { status: 'ok', audioCacheGeneration: generation } }));
  await page.route('**/api/ytmusic/search?*', route => route.fulfill({ json: { songs: [song] } }));
  await page.route('**/api/ytmusic/prefix/**', route => route.fulfill({
    status: 204,
    headers: { 'X-Audio-Asset': generation + '.fixture', 'X-Audio-Prefix-Bytes': '320', 'X-Audio-Expires': String(Date.now() + 3600000) },
  }));
  const reconnect = () => page.evaluate(async () => {
    const path = '/src/lib/serverConnection.ts';
    await (await import(path)).reconnectToServer();
  });
  const lookup = () => page.evaluate(async id => {
    const path = '/src/lib/db.ts';
    return (await (await (await import(path)).getDB()).get('autoAudio', 'ytm:' + id))?.asset;
  }, song.videoId);

  await reconnect();
  const search = page.getByRole('searchbox', { name: 'Search songs' });
  await search.fill('before restart');
  await expect.poll(lookup).toBe('first.fixture');
  generation = 'second';
  await reconnect();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/offline/AudioCache.ts';
    return (await (await import(path)).audioCache.stats()).count;
  })).toBe(0);
  await search.fill('after restart');
  await expect.poll(lookup).toBe('second.fixture');
});


test.describe('iPhone online startup', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });

  test('a prepared song starts with a single MP3 request and stores only a receipt on the phone', async ({ page }) => {
    const [song] = songs(40);
    const requested: URL[] = [];
    await page.route('**/api/ytmusic/search?*', route => route.fulfill({ json: { songs: [song] } }));
    await page.route('**/api/ytmusic/prefix/**', route => route.fulfill({
      status: 204,
      headers: { 'X-Audio-Asset': 'fixture', 'X-Audio-Prefix-Bytes': '320', 'X-Audio-Expires': String(Date.now() + 3600000) },
    }));
    await page.route('**/api/ytmusic/stream/**', route => {
      requested.push(new URL(route.request().url()));
      return route.fulfill({ contentType: 'audio/mpeg', body: mp3 });
    });
    await page.getByRole('searchbox', { name: 'Search songs' }).fill('iphone mp3');
    const receipt = () => page.evaluate(async id => {
      const path = '/src/lib/db.ts';
      return (await (await import(path)).getDB()).get('autoAudio', 'ytm:' + id);
    }, song.videoId);
    await expect.poll(receipt).toMatchObject({ asset: 'fixture', size: 320 });
    expect(await receipt()).not.toHaveProperty('bytes');

    await page.getByText(song.title, { exact: true }).click();
    await expect.poll(() => page.evaluate(async () => {
      const path = '/src/lib/audio/PlayerEngine.ts';
      const state = (await import(path)).playerEngine.getState();
      return state.isPlaying && state.currentTime > 0;
    })).toBe(true);
    expect(requested).toHaveLength(1);
    expect(requested[0].searchParams.get('format')).toBe('mp3');
    for (const key of ['asset', 'prefixKey', 'delivery']) expect(requested[0].searchParams.has(key)).toBe(false);
  });
});
