import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account/session') {
      return route.fulfill({ json: { profile: { uid: 'search-fixture' }, expiresAt: Date.now() + 86_400_000 } });
    }
    return route.fulfill({ json: { status: 'ok', unchanged: true, tracks: [], albums: [], artists: [], songs: [] } });
  });
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
  await page.getByRole('searchbox', { name: 'Search songs' }).fill('miracle');
  await expect(page.getByText('Result for miracle', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(requests).toBe(1);
});
test('clearing an in-flight search keeps its late results out of the page', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Search songs' }).fill('older');
  await expect(page.getByRole('status')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByText('Search for your next favorite.', { exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.getByText('Result for older', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
});
test('replacing a pending query shows only the newest results', async ({ page }) => {
  const input = page.getByRole('searchbox', { name: 'Search songs' });
  await input.fill('older'); await expect(page.getByRole('status')).toBeVisible();
  await input.fill('newer');
  await expect(page.getByText('Result for newer', { exact: true })).toBeVisible();
  await expect(page.getByText('Result for older', { exact: true })).toHaveCount(0);
});

test('live typing stays out of history, while submitting and opening a result saves the query', async ({ page }) => {
  const box = page.getByRole('searchbox');
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('sonora:recent-searches') || '[]'));
  await box.fill('m');
  await expect(page.getByText('Result for m', { exact: true })).toBeVisible();
  await box.fill('mo');
  await expect(page.getByText('Result for mo', { exact: true })).toBeVisible();
  expect(await stored()).toEqual([]);

  for (const term of ['Moonlight', 'Midnight', 'Jazz', 'Echo', 'Ocean', 'Summer', 'Sunset']) {
    await box.fill(term);
    await box.press('Enter');
  }
  await box.fill('sunset');
  await page.getByRole('button', { name: 'Submit search' }).click();
  await expect.poll(stored).toEqual(['sunset', 'Summer', 'Ocean', 'Echo', 'Jazz', 'Midnight', 'Moonlight']);

  await box.fill('constellation');
  await expect(page.getByText('Result for constellation', { exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Result for constellation by Fixture' }).press('Enter');
  await expect.poll(stored).toEqual(['constellation', 'sunset', 'Summer', 'Ocean', 'Echo', 'Jazz', 'Midnight', 'Moonlight']);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  const history = page.getByRole('region', { name: 'Search history' });
  await expect(history.getByRole('button', { name: 'Moonlight', exact: true })).toHaveCount(0);
  await history.getByRole('button', { name: 'Full history' }).click();
  await expect(history.getByRole('button', { name: 'Moonlight', exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Moonlight', exact: true }).click();
  await expect(box).toHaveValue('Moonlight');
  await expect.poll(stored).toEqual(['Moonlight', 'constellation', 'sunset', 'Summer', 'Ocean', 'Echo', 'Jazz', 'Midnight']);
  await page.reload();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Search', exact: true }).click();
  await history.getByRole('button', { name: 'Full history' }).click();
  await expect(history.getByRole('button', { name: 'Midnight', exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(history).toHaveCount(0);
  await expect.poll(stored).toEqual([]);
});
