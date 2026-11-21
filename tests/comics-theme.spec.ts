import { test, expect, type Page, type Locator } from '@playwright/test';
import { COMIC_HEROES, type ComicHeroId } from '../src/lib/comicHeroes';

test.use({ serviceWorkers: 'block', viewport: { width: 375, height: 667 }, hasTouch: true });

const title = 'Across the rooftops of a sleeping city, where the last train waits for the first light';
const viewports = [
  { name: 'small', width: 375, height: 667, coverWidth: 640, coverHeight: 359, light: true },
  { name: 'large', width: 440, height: 956, coverWidth: 426, coverHeight: 640, light: false },
] as const;

function fixtureCover(width: number, height: number, light: boolean) {
  const paper = light ? '#eed8b5' : '#22273b';
  const ink = light ? '#372832' : '#ebaa91';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><path fill="${paper}" d="M0 0h${width}v${height}H0z"/><circle fill="${ink}" cx="${width / 2}" cy="${height * .42}" r="${Math.min(width,height) * .27}"/><path fill="none" stroke="${ink}" stroke-width="2" d="M14 14h${width-28}v${height-28}H14z"/><text font-family="Georgia" font-size="26" fill="${ink}" x="${width / 2}" y="${height - 35}" text-anchor="middle">NIGHT JOURNAL</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // The app also supports a fixed viewport when native fullscreen is unavailable.
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined });
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === '/api/account/session'
      ? { profile: { uid: 'fixture', displayName: 'Fixture' }, expiresAt: Date.now() + 86400000 }
      : path === '/api/account/library' ? { unchanged: true }
      : { status: 'ok', tracks: [], albums: [], artists: [], available: false, enabled: false } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Your profile' })).toBeVisible();
});

async function seed(page: Page, localId: string, artworkUrl: string, heroId: ComicHeroId) {
  await page.evaluate(async ({ localId, title, artworkUrl, heroId }) => {
    const appearance = '/src/lib/appearance.ts';
    const path = '/src/lib/db.ts';
    const { dbService } = await import(path);
    const track = { id: 'ytm:' + localId, source: 'ytmusic', sourceId: localId,
      title, artist: 'Night Journal', duration: 180, artworkUrl };
    await dbService.setSetting('audio_cache_gb', 0);
    await dbService.saveTracks([track]);
    await dbService.setSetting('player_track', track);
    await dbService.setSetting('player_queue', [{ track, queueId: localId, contextIndex: 0 }]);
    await dbService.setSetting('player_queue_cursor', localId);
    (await import(appearance)).chooseComicHero(heroId);
  }, { localId, title, artworkUrl, heroId });
  await page.reload();
  await expect(page.locator('#bottom-player-bar .mini-track')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function ready(image: Locator) {
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

async function actuallyInViewport(item: Locator, minimumSize: number) {
  await expect(item).toBeInViewport({ ratio: 1 });
  const box = (await item.boundingBox())!;
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(minimumSize);
  return box;
}

async function verifyStage(dialog: Locator, cover: Locator, hero: typeof COMIC_HEROES[number], width: number, height: number) {
  const stage = dialog.locator('.comic-cover-stage');
  const artwork = await actuallyInViewport(cover, 128);
  const scene = (await stage.boundingBox())!;
  const root = (await dialog.boundingBox())!;
  expect(artwork.y).toBeGreaterThan(root.y + 25);
  expect(artwork.width / scene.width).toBeGreaterThanOrEqual(.65);
  expect(artwork.width / scene.width).toBeLessThanOrEqual(.8);
  expect(Math.abs(artwork.x + artwork.width / 2 - (scene.x + scene.width / 2))).toBeLessThan(3);
  await expect(cover).toHaveCSS('object-fit', 'contain');
  expect(await cover.evaluate(node => {
    const image = node as HTMLImageElement;
    return [image.naturalWidth, image.naturalHeight];
  })).toEqual([width, height]);
  const figure = stage.locator('.comic-figure');
  await expect(figure).toHaveAttribute('src', hero.art);
  await ready(figure);
  expect((await figure.boundingBox())!.height).toBeLessThan(artwork.height);
}

test('Comics picker persists the six hero choices, including Storm', async ({ page }) => {
  const settings = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Look & feel', { exact: true }).click();
  };
  await settings();
  await page.getByRole('button', { name: 'Comics theme' }).click();
  const picker = page.getByRole('group', { name: 'Comic heroes' });
  await expect(picker.getByRole('button')).toHaveCount(6);
  for (const hero of COMIC_HEROES) {
    const option = picker.getByRole('button', { name: hero.name, exact: true });
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-comic-hero', hero.id);
    await expect(page.locator('.comic-scene-picker .comic-environment img')).toHaveAttribute('src', hero.world);
    await expect(page.locator('.comic-scene-picker .comic-emblem')).toHaveAttribute('src', hero.mark);
    const motion = page.locator('.comic-scene-picker .comic-figure');
    await ready(motion);
    await expect(motion).toHaveCSS('animation-name', 'comic-figure-in');
  }
  await page.reload();
  await settings();
  await expect(picker.getByRole('button', { name: 'Storm', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.comic-scene-picker .comic-figure')).toHaveCSS('animation-name', 'none');
  await picker.scrollIntoViewIfNeeded();
  await picker.locator('.comic-picker-poster').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  await page.screenshot({ path: '.sonora/comics-recovery/picker.jpg', animations: 'disabled' });
});

for (const hero of COMIC_HEROES) {
  test(hero.name + ' keeps the album dominant in both players', async ({ page }) => {
    for (const size of viewports) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await seed(page, size.light ? 'comic-light' : 'comic-dark',
        fixtureCover(size.coverWidth, size.coverHeight, size.light), hero.id);
      await page.addStyleTag({ content: size.light ? ':root { --safe-top: 20px; --safe-bottom: 0px; }' : ':root { --safe-top: 48px; --safe-bottom: 34px; }' });
      const prefix = '.sonora/comics-recovery/' + hero.id + '-' + size.name;
      const mini = page.locator('#bottom-player-bar');
      await ready(mini.locator('.mini-cover-image'));
      await expect(mini.locator('.scrolling-title')).toHaveText(title);
      await actuallyInViewport(mini.getByRole('button', { name: 'Play', exact: true }), 44);
      await mini.screenshot({ path: prefix + '-mini.jpg', animations: 'disabled' });

      await mini.getByRole('button', { name: 'Open player for ' + title }).click();
      const expanded = page.getByRole('dialog', { name: 'Now playing', exact: true });
      const expandedCover = expanded.locator('.player-cover-image');
      await ready(expandedCover);
      await verifyStage(expanded, expandedCover, hero, size.coverWidth, size.coverHeight);
      await expect(expanded.locator('.comic-song-title')).toHaveText(title);
      await actuallyInViewport(expanded.getByRole('button', { name: 'Play', exact: true }), 44);
      await actuallyInViewport(expanded.getByRole('slider', { name: 'Seek' }), 20);
      await expanded.screenshot({ path: prefix + '-expanded.jpg', animations: 'disabled' });

      await expanded.getByRole('button', { name: 'Open fullscreen listening' }).click();
      const fullscreen = page.getByRole('dialog', { name: 'Fullscreen listening' });
      const fullscreenCover = fullscreen.locator('.immersive-cover img');
      await ready(fullscreenCover);
      await verifyStage(fullscreen, fullscreenCover, hero, size.coverWidth, size.coverHeight);
      await expect(fullscreen.getByRole('heading', { name: title })).toBeInViewport();
      await actuallyInViewport(fullscreen.getByRole('button', { name: 'Play', exact: true }), 44);
      await fullscreen.screenshot({ path: prefix + '-fullscreen.jpg', animations: 'disabled' });
      if (!size.light) {
        await page.setViewportSize({ width: 860, height: 402 });
        await actuallyInViewport(fullscreenCover, 120);
        await actuallyInViewport(fullscreen.getByRole('button', { name: 'Play', exact: true }), 44);
        expect(await fullscreen.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      }
      await fullscreen.getByRole('button', { name: 'Exit fullscreen listening' }).click();
      await expect(fullscreen).toHaveCount(0);
    }
  });
}


test('lyrics keep the comic cover and transport available in compact fullscreen', async ({ page }) => {
  await page.route('**/api/lyrics?*', route => route.fulfill({
    json: { text: '[00:00.00]Across the rooftops\n[00:08.00]Out into the blue' },
  }));
  await seed(page, 'with-lyrics', fixtureCover(480,480,true), 'moon-knight');
  await page.locator('#bottom-player-bar .mini-track').click();
  await page.getByRole('button', { name: 'Open fullscreen listening' }).click();
  const fullscreen = page.getByRole('dialog', { name: 'Fullscreen listening' });
  await fullscreen.getByRole('button', { name: 'Show fullscreen lyrics' }).click();
  await expect(fullscreen.getByRole('region', { name: 'Song lyrics' })).toBeVisible();
  await actuallyInViewport(fullscreen.locator('.immersive-cover'), 130);
  await actuallyInViewport(fullscreen.getByRole('slider', { name: 'Seek' }), 4);
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(fullscreen.getByRole('region', { name: 'Song lyrics' })).toBeInViewport();
  await actuallyInViewport(fullscreen.locator('.immersive-cover'), 120);
  await actuallyInViewport(fullscreen.getByRole('button', { name: 'Play', exact: true }), 44);
  await fullscreen.getByRole('button', { name: 'Shuffle', exact: true }).click();
  await expect(fullscreen.getByRole('button', { name: 'Shuffle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await fullscreen.screenshot({ path: '.sonora/comics-recovery/landscape-lyrics.jpg', animations: 'disabled' });
  const scene = fullscreen.locator('.comic-immersive');
  await scene.press('Space');
  await expect(scene).toHaveAttribute('data-controls', 'hidden');
  await actuallyInViewport(fullscreen.locator('.immersive-cover'), 120);
  await expect(fullscreen.getByRole('region', { name: 'Song lyrics' })).toBeInViewport();
  await scene.press('Space');
  await expect(scene).toHaveAttribute('data-controls', 'visible');
  await actuallyInViewport(fullscreen.getByRole('button', { name: 'Play', exact: true }), 44);
});
