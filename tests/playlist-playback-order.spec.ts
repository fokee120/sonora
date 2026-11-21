import { test, expect } from '@playwright/test';
import { wave } from './fixtures/bridge-media';

test.use({ serviceWorkers: 'block', viewport: { width: 402, height: 874 }, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json:
    route.request().url().includes('/account/session') ? { profile: { uid: 'fixture', displayName: 'Fixture' }, expiresAt: Date.now() + 86400000 }
      : route.request().url().includes('/account/library') ? { unchanged: true }
      : { status: 'ok', tracks: [], albums: [], artists: [], enabled: false },
  }));
  await page.route('**/api/ytmusic/stream/**', route => route.fulfill({ contentType: 'audio/wav', body: wave(12) }));
  await page.route('**/delayed-art*.png', async route => {
    await new Promise(resolve => setTimeout(resolve, 650));
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="navy"/></svg>' });
  });
  await page.goto('/');
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.evaluate(async () => {
    const playerPath = '/src/lib/audio/PlayerEngine.ts';
    const cachePath = '/src/lib/offline/AudioCache.ts';
    const player = (await import(playerPath)).playerEngine;
    await (await import(cachePath)).audioCache.setLimit(0);
    const titles = ['Delta', 'Charlie', 'Alpha', 'Bravo', 'Echo'];
    const tracks = titles.map((title, index) => ({
      id: 'ytm:' + String(index).padStart(11, '0'), source: 'ytmusic', sourceId: String(index).padStart(11, '0'),
      cloudKey: 'ytmusic://' + String(index).padStart(11, '0'), title,
      artist: ['C', 'A', 'C', 'B', 'D'][index], album: ['A', 'D', 'B', 'E', 'C'][index],
      duration: 12, artworkUrl: '/delayed-art-' + index + '.png',
    }));
    Object.assign(window, { testPlayer: player, testTracks: tracks });
    await player.playPlaylist('test-order', tracks, false, tracks[2]);
  });
});

test('playlist ordering follows each sort without reloading the active song', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/src/lib/playlistOrder.ts';
    const { sortPlaylistTracks } = await import(path);
    const { testPlayer: player, testTracks: tracks } = window as any;
    const id = tracks[2].id;
    const output = [];
    for (const sort of ['custom', 'date-new', 'date-old', 'artist', 'album', 'title']) {
      const order = sortPlaylistTracks(tracks, sort, [tracks[4].id, tracks[2].id, tracks[0].id]);
      const src = player.audio.src;
      const time = player.audio.currentTime;
      const before = player.audio;
      player.setPlaylistOrder('test-order', order);
      const queue = player.getQueue();
      output.push({ sort, ids: queue.map(item => item.track.title), at: queue[player.getQueueIndex()].track.id,
        preserved: player.audio === before && player.audio.src === src && player.audio.currentTime >= time });
      player.toggleShuffle();
      player.setPlaylistOrder('test-order', order);
      player.toggleShuffle();
      if (player.getQueue().map(item => item.track.id).join() !== order.map(item => item.id).join()) throw Error('Shuffle restoration failed');
    }
    const waitFor = (title: string) => new Promise<void>(resolve => {
      const stop = player.subscribe(state => { if (state.currentTrack?.title === title && state.isPlaying) { queueMicrotask(() => stop()); resolve(); } });
    });
    player.next();
    await waitFor('Bravo');
    player.previous(true);
    await waitFor('Alpha');
    const previous = player.getState().currentTrack.title;
    player.audio.dispatchEvent(new Event('ended'));
    await waitFor('Bravo');
    const next = player.getState().currentTrack.title;
    player.setRepeatMode('one');
    player.seek(6);
    const restarted = new Promise<void>(resolve => {
      const stop = player.subscribe(state => {
        if (state.currentTrack?.title === 'Bravo' && state.isPlaying && state.currentTime < 1) {
          queueMicrotask(() => stop());
          resolve();
        }
      });
    });
    player.audio.dispatchEvent(new Event('ended'));
    await restarted;
    return { output, id, previous, next, repeat: player.getState().currentTrack.title };
  });
  expect(result.output.map(row => row.ids)).toEqual([
    ['Echo', 'Alpha', 'Delta', 'Charlie', 'Bravo'], ['Echo', 'Bravo', 'Alpha', 'Charlie', 'Delta'],
    ['Delta', 'Charlie', 'Alpha', 'Bravo', 'Echo'], ['Charlie', 'Bravo', 'Delta', 'Alpha', 'Echo'],
    ['Delta', 'Alpha', 'Echo', 'Charlie', 'Bravo'], ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'],
  ]);
  expect(result.output.every(row => row.at === result.id && row.preserved)).toBe(true);
  // Previous from Bravo returns to Alpha. Automatic next is Bravo.
  expect(result.previous).toBe('Alpha');
  expect(result.next).toBe('Bravo');
  expect(result.repeat).toBe('Bravo');
});

test('changing the playlist sort control immediately changes Next', async ({ page }) => {
  await page.evaluate(async () => {
    const dbPath = '/src/lib/db.ts';
    const { dbService } = await import(dbPath);
    const tracks = (window as any).testTracks;
    await dbService.saveTracks(tracks);
    await dbService.savePlaylist({
      id: 'sort-ui', title: 'Sort UI fixture', trackIds: tracks.map(track => track.id),
      createdAt: 1, updatedAt: 1, playback: { sort: 'date-old', shuffle: false },
    });
  });
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Library' }).click();
  await page.locator('#library-view').getByText('Sort UI fixture', { exact: true }).click();
  await page.getByRole('group', { name: 'Alpha by C' }).getByText('Alpha', { exact: true }).click();
  const mini = page.locator('.mini-track');
  await expect(mini).toHaveAttribute('aria-label', 'Open player for Alpha');
  await page.getByLabel('Sort playlist', { exact: true }).selectOption('date-new');
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const { playerEngine } = await import(path);
    return playerEngine.getQueue()[playerEngine.getQueueIndex() + 1]?.track.title;
  })).toBe('Charlie');
  await page.locator('.mini-transport').getByTitle('Next track').click();
  await expect(mini).toHaveAttribute('aria-label', 'Open player for Charlie');
});

test('player swipes track touch, cancel cleanly, and skip once per gesture', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'LayoutCount')!.value;
  const moveLayouts: number[] = [];
  const mini = page.locator('.mini-track');
  const expanded = page.locator('.player-art-stage');
  const touch = (type, x?: number, y?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y! }] });
  async function swipe(target, offset: number, cancel = false) {
    const rect = await target.boundingBox();
    if (!rect) throw Error('Player surface unavailable');
    const x = rect.x + Math.min(rect.width * .7, rect.width - 12);
    const y = rect.y + rect.height / 2;
    const mover = target === mini ? page.locator('.mini-track-slide') : page.locator('.expanded-track-slide');
    await touch('touchStart', x, y);
    const before = await layouts();
    for (const fraction of [.25, .5, .75, 1]) await touch('touchMove', x + offset * fraction, y);
    moveLayouts.push(await layouts() - before);
    await expect.poll(() => mover.evaluate((element, sign) =>
      new DOMMatrix(getComputedStyle(element).transform).m41 * sign, Math.sign(offset))).toBeGreaterThan(15);
    await touch(cancel ? 'touchCancel' : 'touchEnd');
  }
  await expect(mini).toHaveAccessibleName('Open player for Alpha');
  await swipe(mini, -70, true);
  await expect(mini).toHaveAccessibleName('Open player for Alpha');
  await swipe(mini, -72);
  await expect(mini).toHaveAccessibleName('Open player for Bravo');
  await swipe(mini, -72);
  await expect(mini).toHaveAccessibleName('Open player for Echo');
  await mini.click();
  await expect(expanded).toBeVisible();
  await expect.poll(async () => (await expanded.boundingBox())!.y).toBeLessThan(350);
  await swipe(expanded, 84, true);
  await swipe(expanded, 84);
  await expect(mini).toHaveAttribute('aria-label', 'Open player for Bravo');
  await swipe(expanded, 84);
  await expect(mini).toHaveAttribute('aria-label', 'Open player for Alpha');
  await expect(page.locator('.expanded-track-frame')).toHaveCount(1);
  await expect(page.locator('.player-heading-frame')).toHaveCount(1);
  console.log('Layout passes during four touch moves per gesture:', moveLayouts);
});
