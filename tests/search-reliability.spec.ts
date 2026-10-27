import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { tracks: [], albums: [], artists: [] } }));
  await page.route('**/api/ytmusic/search?**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q')!;
    await new Promise(resolve => setTimeout(resolve, query === 'older' ? 900 : 500));
    await route.fulfill({ json: { songs: [{ videoId: 'abcdefghijk', title: `Result for ${query}`, artist: 'Fixture', album: 'Fixture', durationSeconds: 180 }] } }).catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Search', exact: true }).click();
});
test('a delayed search survives loading-state renders and finishes once', async ({ page }) => {
  let requests = 0; page.on('request', req => { if (req.url().includes('/api/ytmusic/search?')) requests++; });
  await page.getByRole('textbox', { name: 'Search songs' }).fill('miracle');
  await expect(page.getByText('Result for miracle', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(requests).toBe(1);
});
test('clearing an in-flight search keeps its late results out of the page', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Search songs' }).fill('older');
  await expect(page.getByRole('status')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByText('Search for your next favorite.', { exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.getByText('Result for older', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
});
test('replacing a pending query shows only the newest results', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Search songs' });
  await input.fill('older'); await expect(page.getByRole('status')).toBeVisible();
  await input.fill('newer');
  await expect(page.getByText('Result for newer', { exact: true })).toBeVisible();
  await expect(page.getByText('Result for older', { exact: true })).toHaveCount(0);
});
