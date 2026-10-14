import { test, expect } from '@playwright/test';

test('development shell does not install a service worker that can reload playback', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { user: null, authRequired: false, tracks: [], albums: [], artists: [] } }));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(registration => registration.scope));
  expect(registrations).toEqual([]);
});

test('opening YouTube search warms playback without selecting a song', async ({ page }) => {
  let prepares = 0;
  let streams = 0;
  await page.route('**/api/**', route => {
    if (route.request().url().includes('/bridge/prepare')) prepares++;
    if (route.request().url().includes('/ytmusic/stream/')) streams++;
    return route.fulfill({ json: { ok: true, user: null, authRequired: false, tracks: [], albums: [], artists: [] } });
  });
  await page.goto('/');
  await page.locator('#nav-search').waitFor();
  // Programmatic navigation tests the search lifecycle, not pointerdown warmup.
  await page.locator('#nav-search').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#search-input')).toBeVisible();
  await expect.poll(() => prepares).toBe(1);
  expect(streams).toBe(0);
});
