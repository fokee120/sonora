import { test, expect, type Page, type Locator } from '@playwright/test';
import { wave } from './fixtures/bridge-media';

test.use({ serviceWorkers: 'block', viewport: { width: 440, height: 956 }, hasTouch: true });

const title = 'Blue Hour Across the Water';
const artist = 'The Glass Coast';
const album = 'Open Water';
const longLyric = 'Will the river carry all the words I never say?';
const artSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="530" height="530" viewBox="0 0 530 530"><rect width="530" height="530" fill="#133d4d"/><circle cx="326" cy="201" r="89" fill="#fff2ad"/><path fill="#087f87" d="M0 283l133-94 147 129 110-77 140 54v235H0Z"/><path fill="#57b9a8" d="M0 377l120-37 167 40 243-40v190H0Z"/><path stroke="#b5e7cb" stroke-width="4" fill="none" d="M44 383q92-10 149 3t112 6m-134 13q67-2 115 1t95 0"/><text x="49" y="480" fill="#edffdc" font-family="Georgia" font-size="31">OPEN WATER</text></svg>';
const art = '/aero-test-cover.svg';
const songs = [title, 'Sunlight Through Glass', 'Slow Current'].map((value, index) => ({
  id: 'ytm:' + String(index + 20).padStart(11, '0'), source: 'ytmusic', sourceId: String(index + 20).padStart(11, '0'),
  title: value, artist, album, artistId: 'UCaerofixture', albumId: 'MPREaerofixture', duration: 12, artworkUrl: art,
}));
const catalogSong = { videoId: songs[0].sourceId, title, artist, durationSeconds: 12, artworkUrl: art };
const release = { browseId: 'MPREaerofixture', title: album, artist, artistId: 'UCaerofixture', artworkUrl: art };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined });
  });
  await page.route('**/aero-test-cover.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: artSvg }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/account/session') return route.fulfill({ json: { profile: { uid: 'aero-fixture', displayName: 'Fixture' }, expiresAt: Date.now() + 86400000 } });
    if (path === '/api/account/library') return route.fulfill({ json: { unchanged: true } });
    if (path.startsWith('/api/ytmusic/stream/')) return route.fulfill({ contentType: 'audio/wav', body: wave(12) });
    if (path === '/api/lyrics') return route.fulfill({ json: { text: `[00:00.00]Beyond the edge of the blue\n[00:04.00]${longLyric}\n[00:08.00]The tide carries us through` } });
    if (path.startsWith('/api/ytmusic/radio/')) {
      return route.fulfill({ json: { songs: [{ ...catalogSong, videoId: 'aeroradio01', title: 'Clear Horizons' }] } });
    }
    if (path.startsWith('/api/ytmusic/browse/')) {
      const isAlbum = path.endsWith('MPREaerofixture');
      return route.fulfill({ json: { ...release, browseId: isAlbum ? release.browseId : release.artistId,
        kind: isAlbum ? 'album' : 'artist', title: isAlbum ? album : artist, songs: [catalogSong], albums: isAlbum ? [] : [release] } });
    }
    return route.fulfill({ json: { status: 'ok', tracks: [], songs: [], albums: [], artists: [], available: false, enabled: false } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Your profile' })).toBeVisible();
  await page.evaluate(async tracks => {
    const mod = '/src/lib/db.ts';
    const { dbService } = await import(mod);
    await dbService.setSetting('audio_cache_gb', 0);
    await dbService.saveTracks(tracks);
    await dbService.savePlaylist({ id: 'aero-playlist', title: 'Blue skies', description: 'A clear morning by the coast.', trackIds: tracks.map(track => track.id), createdAt: 1, updatedAt: 1 });
    await dbService.setSetting('player_track', tracks[0]);
    await dbService.setSetting('player_queue', tracks.map((track, index) => ({ track, queueId: track.id, contextIndex: index })));
    await dbService.setSetting('player_queue_cursor', tracks[0].id);
  }, songs);
  await page.reload();
  await expect(page.locator('#bottom-player-bar')).toBeVisible();
  await page.addStyleTag({ content: ':root { --safe-top: 46px; --safe-bottom: 32px; }' });
});

const preview = (path: string) => '.sonora/aero-qa/' + path + '.png';

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: preview(name), animations: 'disabled' });
}

async function selectAero(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Look & feel', { exact: true }).click();
  await page.getByRole('button', { name: 'Frutiger Aero theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'aero');
}

async function fits(item: Locator) {
  await expect(item).toBeInViewport({ ratio: 1 });
  expect(await item.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

test('Aero persists and themes browsing, catalog pages, and overlays', async ({ page }) => {
  await selectAero(page);
  await capture(page, 'settings');
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('sonora:appearance:v1')!);
    localStorage.setItem('sonora:appearance:v1', JSON.stringify({ ...saved, background: '#e0f4f8' }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Open Sonora', exact: true }).tap();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'aero');
  await expect(page.getByRole('region', { name: 'Music recommendations' })).toBeAttached();
  await expect(page.locator('#home-view .listening-hero')).toHaveCSS('background-image', /meadow\.webp/);
  await expect(page.locator('#home-view .playlist-shelf')).toBeVisible();
  await expect(page.locator('#home-view .skeleton-rows')).toHaveCount(0);
  await expect(page.locator('#bottom-player-bar')).toHaveCSS('opacity', '1');
  const homePane = page.locator('.page-pane[data-route-view="home"]');
  await expect(homePane).toHaveCSS('background-image', /shoreline\.svg/);
  await expect(homePane).toHaveCSS('overscroll-behavior-y', 'none');
  await expect(homePane).toHaveCSS('background-color', 'rgb(123, 210, 239)');
  await capture(page, 'home-phone');
  const recommended = page.getByRole('region', { name: 'Music recommendations' });
  await recommended.scrollIntoViewIfNeeded();
  await expect(recommended.getByText('Clear Horizons', { exact: true })).toBeVisible();
  await capture(page, 'recommendations');

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('#search-view')).toBeVisible();
  await capture(page, 'search');
  const field = page.getByRole('searchbox', { name: 'Search songs' });
  await field.fill('no results');
  await expect(page.getByText('No songs found.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(440);
  await field.blur();

  await nav.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('#library-view').getByText('Blue skies', { exact: true })).toBeVisible();
  await capture(page, 'library');
  await page.locator('#library-view').getByText('Blue skies', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Blue skies' })).toBeVisible();
  await capture(page, 'playlist');
  await page.locator('#playlist-detail-view .song-list').first().scrollIntoViewIfNeeded();
  await page.locator('#playlist-detail-view').getByRole('group', { name: title + ' by ' + artist, exact: true }).getByTitle('More options').click();
  const menu = page.getByRole('dialog', { name: 'Options for ' + title });
  await fits(menu);
  await capture(page, 'song-menu');
  await menu.getByRole('button', { name: 'Go to artist', exact: true }).click();
  await expect(page.getByRole('heading', { name: artist, exact: true })).toBeVisible();
  await capture(page, 'artist');
  await page.locator('#artist-detail-view').getByRole('button', { name: new RegExp(album) }).first().click();
  await expect(page.getByRole('heading', { name: album, exact: true })).toBeVisible();
  await capture(page, 'album');

  await nav.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Look & feel', { exact: true }).click();
  await page.getByRole('button', { name: 'Default theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'classic');
  await expect(page.locator('.aero-atmosphere')).toHaveCount(0);
});

test('Aero players handle safe areas, seeks, song changes and fullscreen lyrics', async ({ page }) => {
  await selectAero(page);
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  const mini = page.locator('#bottom-player-bar');
  await mini.screenshot({ path: preview('mini') });
  await mini.getByRole('button', { name: 'Open player for ' + title }).click();
  const player = page.getByRole('dialog', { name: 'Now playing', exact: true });
  const expanded = player.locator('.player-artwork');
  await fits(expanded);
  expect((await expanded.boundingBox())!.width).toBeGreaterThan(235);
  await player.getByTitle('Open lyrics').waitFor();
  await capture(page, 'expanded');
  await page.setViewportSize({ width: 375, height: 667 });
  await fits(expanded);
  await fits(player.getByRole('button', { name: 'Play', exact: true }));
  await capture(page, 'expanded-compact');
  await page.setViewportSize({ width: 440, height: 956 });
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const seek = player.getByRole('slider', { name: 'Seek' }).first();
  await seek.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await seek.getAttribute('aria-valuenow'))).toBeGreaterThan(3);
  await player.getByTitle('Next track').click();
  await expect(player.getByRole('heading', { name: 'Sunlight Through Glass' })).toBeVisible();
  await player.getByTitle('Next track').click();
  await expect(player.getByRole('heading', { name: 'Slow Current' })).toBeVisible();

  await player.getByRole('button', { name: 'Open fullscreen listening' }).click();
  const full = page.getByRole('dialog', { name: 'Fullscreen listening' });
  await expect(full.locator('.aero-atmosphere-fullscreen')).toHaveCSS('background-image', /underwater\.webp/);
  await fits(full.locator('.immersive-cover'));
  await capture(page, 'fullscreen-phone');
  await full.getByRole('button', { name: 'Show fullscreen lyrics' }).click();
  const lyrics = full.getByRole('region', { name: 'Song lyrics' });
  const line = lyrics.getByRole('button', { name: 'Seek to lyric: ' + longLyric, exact: true });
  await fits(lyrics);
  await full.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const viewport of [{ width: 956, height: 440 }, { width: 852, height: 393 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.addStyleTag({ content: ':root { --safe-top: 0px; --safe-bottom: 21px; --safe-left: 47px; --safe-right: 47px; }' });
    const cover = full.locator('.immersive-cover');
    const transport = full.locator('.immersive-controls');
    const layout = full.locator('.aero-immersive-layout');
    await fits(cover);
    await fits(lyrics);
    await fits(full.getByRole('slider', { name: 'Seek' }).first());
    const lyricBox = (await lyrics.boundingBox())!;
    const coverBox = (await cover.boundingBox())!;
    const transportBox = (await transport.boundingBox())!;
    const layoutBox = (await layout.boundingBox())!;
    expect(lyricBox.width).toBeGreaterThan(layoutBox.width / 2);
    expect(lyricBox.x + lyricBox.width).toBeLessThanOrEqual(viewport.width - 47);
    expect(coverBox.width).toBeGreaterThan(viewport.height * .32);
    expect(transportBox.y).toBeGreaterThan(coverBox.y + coverBox.height);
    expect(Math.abs(transportBox.x + transportBox.width / 2 - coverBox.x - coverBox.width / 2)).toBeLessThan(2);
    const lineCount = await line.evaluate(el => {
      const style = getComputedStyle(el);
      return Math.round((el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight));
    });
    expect(lineCount).toBeLessThanOrEqual(2);
    await line.click();
    await expect(line).toHaveAttribute('aria-current', 'true');
    await expect.poll(async () => {
      const active = (await line.boundingBox())!;
      return Math.abs(active.y + active.height / 2 - lyricBox.y - lyricBox.height / 2);
    }).toBeLessThan(10);
    if (viewport.width === 956) await capture(page, 'fullscreen-landscape');
  }
  await page.addStyleTag({ content: ':root { --safe-left: 0px; --safe-right: 0px; }' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(full.locator('.aero-bubble').first()).toHaveCSS('animation-name', 'none');
  await full.getByRole('button', { name: 'Exit fullscreen listening' }).click();
  await expect(full).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture(page, 'home-desktop');
  await mini.getByTitle('Queue', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Play Queue' })).toBeVisible();
  await capture(page, 'queue-desktop');
});

