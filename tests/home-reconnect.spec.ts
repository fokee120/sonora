import { expect, test } from '@playwright/test';
import { VISUAL_THEMES } from '../src/lib/appearance';

test.use({ serviceWorkers: 'block', viewport: { width: 402, height: 874 } });

test('Home offers reconnect in every visual theme', async ({ page }) => {
  let healthy = false;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ status: healthy ? 200 : 503, json: { status: healthy ? 'ok' : 'offline' } });
    return route.fulfill({ json: path === '/api/account/session'
      ? { profile: { uid: 'fixture', displayName: 'Fixture' }, expiresAt: Date.now() + 86400000 }
      : { unchanged: true, tracks: [], artists: [], albums: [] } });
  });
  await page.goto('/');
  const retry = page.getByRole('button', { name: 'Offline mode. Tap to reconnect' });
  for (const theme of VISUAL_THEMES) {
    await page.evaluate(async id => {
      const path = '/src/lib/appearance.ts';
      (await import(path)).chooseTheme(id);
    }, theme.id);
    await expect(page.locator('html')).toHaveAttribute('data-style', theme.id);
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
  }
  const navigation = page.getByRole('navigation');
  await navigation.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(retry).toBeHidden();
  await navigation.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(retry).toBeVisible();
  healthy = true;
  await retry.click();
  await expect(retry).toBeHidden();
});
