import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 440, height: 956 }, hasTouch: true });

const profile = { uid: 'returning-listener', displayName: 'Returning listener' };
const verified = () => ({ profile, expiresAt: Date.now() + 86400000 });
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

async function mockApi(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account/session') return route.fulfill({ json: verified() });
    if (path === '/api/account/library') return route.fulfill({ json: { unchanged: true } });
    return route.fulfill({ json: { status: 'ok', tracks: [], artists: [], albums: [], songs: [] } });
  });
}

test('returning listener opens the library during a slow session check and stays signed in through a temporary failure', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(navigation(page)).toBeVisible();

  let release!: () => void;
  const delay = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/account/session', async route => {
    await delay;
    await route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } });
  });
  try {
    await page.reload();
    await expect(navigation(page)).toBeVisible();
    expect(await page.getByText('Welcome to Sonora').count()).toBe(0);
  } finally { release(); }
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/cloudAccount.ts';
    return (await import(path)).accountSnapshot().sessionUnavailable;
  })).toBe(true);
  await expect(navigation(page)).toBeVisible();
  await page.unroute('**/api/account/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/cloudAccount.ts';
    return (await import(path)).accountSnapshot().authenticated;
  })).toBe(true);
});

test('explicit session expiration clears verified access across reloads', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(navigation(page)).toBeVisible();
  const expired = { profile: null, expiresAt: 0 };
  await page.route('**/api/account/session', route => route.fulfill({ json: expired }));
  await page.reload();
  await expect(page.getByText('Welcome to Sonora')).toBeVisible();
  await expect(navigation(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/db.ts';
    return (await import(path)).dbService.getSetting('cloud:verified-until', -1);
  })).toBe(0);
  await page.unroute('**/api/account/session');
  await page.route('**/api/account/session', route => route.abort());
  await page.reload();
  await expect(page.getByText('Waiting for Sonora')).toBeVisible();
  await expect(navigation(page)).toHaveCount(0);
});

async function enableAero(page: Page, blockAutoplay: boolean) {
  await page.addInitScript(block => {
    localStorage.setItem('sonora:appearance:v1', JSON.stringify({ style: 'aero', preset: 'default' }));
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.dataset.introStarts ??= '0';
    }, { once: true });
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      override resume() {
        if (block && !navigator.userActivation.isActive) {
          return Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
        }
        return super.resume();
      }
      override createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => {
          start(...args);
          document.documentElement.dataset.introStarts = String(Number(document.documentElement.dataset.introStarts) + 1);
          document.documentElement.dataset.introDuration = String(source.buffer?.duration);
        };
        return source;
      }
    };
  }, blockAutoplay);
}

test('Aero holds the bubbles until the opening tap and plays the supplied clip once', async ({ page, browserName }) => {
  await mockApi(page);
  await enableAero(page, true);
  await page.setViewportSize({ width: 440, height: 890 });
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open Sonora', exact: true });
  const root = page.locator('html');
  const first = splash.locator('.aero-startup-band').first();
  const scene = await splash.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, dots: element.querySelectorAll('.aero-startup-dot').length };
  });
  expect(scene).toMatchObject({ width: 440, height: 890 });
  const bubble = splash.locator('.aero-startup-bubble:not(.aero-startup-dot)').nth(5);
  const restingTop = (await bubble.boundingBox())!.y;
  await page.setViewportSize({ width: 440, height: 956 });
  await expect(splash).toHaveCSS('height', '956px');
  expect((await bubble.boundingBox())!.y).toBeCloseTo(restingTop, 0);
  expect(scene.dots).toBeGreaterThan(24);
  const top = (await first.boundingBox())!.y;
  await expect(page.locator('#root')).toHaveAttribute('inert', '');

  await expect(splash).toHaveText('');
  await expect(splash).toHaveCSS('touch-action', 'none');
  if (browserName === 'chromium') {
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 180 }] });
    for (const y of [205, 270, 350]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 170, y }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    await expect(splash).toBeEnabled();
    await expect(root).toHaveAttribute('data-intro-starts', '0');
  }

  // Hold past the old launch timeout to catch a silent, expired intro.
  await page.waitForTimeout(8250);
  await expect(splash).toBeEnabled();
  expect((await first.boundingBox())!.y).toBe(top);
  await expect(root).toHaveAttribute('data-intro-starts', '0');
  await page.screenshot({ path: '.sonora/aero-qa/startup-bubbles.png' });

  const backdrop = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundImage);
  await splash.tap({ position: { x: 90, y: 148 } });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundImage)).toBe(backdrop);
  const release = page.locator('.aero-startup.is-releasing');
  const { travel, initialTravel } = await release.evaluate(element => {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (!(animation instanceof CSSAnimation)) continue;
      animation.pause();
      animation.currentTime = 600;
    }
    const band = element.querySelector('.aero-startup-band')!;
    const lift = band.getAnimations()[0];
    const distance = [0, 250, 500, 750, 1000].map(time => {
      lift.currentTime = time;
      return -band.getBoundingClientRect().top;
    });
    lift.currentTime = 100;
    const initialTravel = -band.getBoundingClientRect().top;
    lift.currentTime = 600;
    return { travel: distance, initialTravel };
  });
  expect(travel[0]).toBeCloseTo(-top, 1);
  expect(initialTravel - travel[0]).toBeLessThan(2);
  const steps = travel.slice(1).map((position, index) => position - travel[index]);
  expect(steps[0]).toBeGreaterThan(0);
  expect(steps[1]).toBeGreaterThan(steps[0]);
  expect(steps[2]).toBeGreaterThan(steps[1]);
  expect(steps[3]).toBeGreaterThan(steps[2]);
  expect((await release.locator('.aero-startup-band').first().boundingBox())!.y).toBeLessThan(top - 100);
  await expect(root).toHaveAttribute('data-intro-starts', '1');
  expect(Number(await root.getAttribute('data-intro-duration'))).toBeCloseTo(6.31, 1);
  await page.screenshot({ path: '.sonora/aero-qa/startup-reveal.png' });
  await expect(release).toHaveCount(0);
  await navigation(page).getByRole('button', { name: 'Library', exact: true }).tap();
  await expect(root).toHaveAttribute('data-intro-starts', '1');
});

test('Aero with reduced motion supports keyboard entry and reveals without a rise', async ({ page }) => {
  await mockApi(page);
  await enableAero(page, true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open Sonora', exact: true });
  await page.keyboard.press('Tab');
  await expect(splash).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-intro-starts', '0');
  await page.keyboard.press('Enter');
  await expect(splash).toHaveCount(0);
  await expect(navigation(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-intro-starts', '1');
});

test('an unavailable clip never traps someone in the Aero opening', async ({ page }) => {
  await mockApi(page);
  await enableAero(page, true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/themes/aero/intro.m4a', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Sonora', exact: true }).tap();
  await expect(navigation(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-intro-starts', '0');
});

test('the non-Aero page never requests the intro or shows the gate', async ({ page }) => {
  await mockApi(page);
  let requests = 0;
  await page.route('**/themes/aero/intro.m4a', async route => { requests++; await route.continue(); });
  await page.goto('/');
  await expect(navigation(page)).toBeVisible();
  await expect(page.locator('.aero-startup')).toHaveCount(0);
  expect(requests).toBe(0);
});
