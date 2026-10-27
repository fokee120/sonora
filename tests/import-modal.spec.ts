import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 390, height: 667 }, { width: 667, height: 320 }]) {
  test(`import remains inside the viewport after scrolling (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/**', route => route.fulfill({ json: {
      configured: true, connected: false, user: null, tracks: [], albums: [], artists: [],
    } }));
    await page.goto('/?spotify=connected');
    const dialog = page.getByRole('dialog', { name: 'Import playlist by URL' });
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Close import' }).click();
    const open = page.getByRole('button', { name: 'Import a playlist', exact: true });
    await open.scrollIntoViewIfNeeded();
    await open.click();
    await expect(page.getByRole('textbox', { name: 'Playlist URL' })).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(await dialog.evaluate(element => element.parentElement?.parentElement === document.body)).toBe(true);
    await expect(page.getByRole('link', { name: 'Connect Spotify', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Playlist URL' }).fill('https://open.spotify.com/playlist/abc123');
    await page.getByRole('textbox', { name: 'Playlist URL' }).press('Shift+Tab');
    await expect(page.getByRole('link', { name: 'Connect Spotify', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
  });
}

test('free Spotify preview shows the count and partial-playlist warning before matching', async ({ page }) => {
  await page.route('**/api/**', route => {
    const url = route.request().url();
    return route.fulfill({ json: url.includes('/import/spotify') ? {
      name: 'Public fixture', items: { items: [{ item: { name: 'Feather', artists: [{ name: 'Nujabes' }] } }] },
      warning: 'Spotify public preview supplied 1 song. This may be only part of the playlist.',
    } : { configured: false, connected: false, tracks: [], user: null } });
  });
  await page.goto('/?spotify=connected');
  await page.getByRole('textbox', { name: 'Playlist URL' }).fill('https://open.spotify.com/playlist/abc123');
  await page.getByRole('button', { name: 'Fetch', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('only part of the playlist');
  await expect(page.getByRole('dialog')).toContainText('1 tracks from spotify');
  await expect(page.getByRole('button', { name: 'Import in background' })).toBeVisible();
});
