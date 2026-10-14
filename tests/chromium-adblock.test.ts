import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import { ChromiumBridge } from '../src/server/bridge/ChromiumBridge.js';

test('ad blocking fails clearly when its extension is missing', async () => {
  const previous = process.env.SONORA_ADBLOCK_EXTENSION_DIR;
  process.env.SONORA_ADBLOCK_EXTENSION_DIR = resolve('.sonora/extensions/does-not-exist');
  const bridge = new ChromiumBridge();
  try {
    await assert.rejects(bridge.ensureReady(), /adblock.*manifest|manifest.*adblock/i);
  } finally {
    await bridge.close();
    if (previous === undefined) delete process.env.SONORA_ADBLOCK_EXTENSION_DIR;
    else process.env.SONORA_ADBLOCK_EXTENSION_DIR = previous;
  }
});

test('real sessions load uBOL Complete before YTM navigation and isolate browser and extension storage', { timeout: 90000 }, async () => {
  const original = chromium.launchPersistentContext.bind(chromium);
  const originalLaunch = chromium.launch.bind(chromium);
  chromium.launch = async () => { throw new Error('Shared browser launch must be replaced with isolated persistent contexts'); };
  const contexts: BrowserContext[] = [];
  const bridge = new ChromiumBridge();
  // Only intercept YTM navigation; browser, extension and DNR APIs remain real.
  chromium.launchPersistentContext = async (profile, options) => {
    assert.equal(profile, '', 'never reuse a profile');
    assert.equal(options?.channel, 'chromium');
    const context = await original(profile, options);
    contexts.push(context);
    await context.route('https://music.youtube.com/**', async route => {
      const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
      assert.ok(worker, 'extension must be loaded before navigation');
      const modes = await worker.evaluate(async () => {
        return (await (globalThis as any).chrome.storage.local.get('filteringModeDetails')).filteringModeDetails;
      });
      assert.ok(modes.complete.includes('youtube.com'), 'Complete must be configured before navigation');
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local YTM fixture</title><video></video><div id="movie_player"></div><script>document.querySelector("#movie_player").loadVideoById = () => {};</script>' });
    });
    return context;
  };
  try {
    await bridge.ensureReady();
    const first = await (bridge as any).getSession('adblock-first');
    const second = await (bridge as any).getSession('adblock-second');
    assert.equal(contexts.length, 2);
    assert.notEqual(first.context.browser(), second.context.browser());
    for (const context of contexts) {
      const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'))!;
      const state = await worker.evaluate(async () => {
        const chrome = (globalThis as any).chrome;
        const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
        const resources = chrome.runtime.getManifest().declarative_net_request.rule_resources;
        const counts = await Promise.all(enabled.map(async (id: string) => {
          const resource = resources.find((item: any) => item.id === id);
          return (await (await fetch(chrome.runtime.getURL(resource.path))).json()).length;
        }));
        return {
          enabled, count: counts.reduce((sum: number, n: number) => sum + n, 0),
          permissions: await chrome.permissions.contains({ origins: ['<all_urls>'] }),
          scripts: (await chrome.scripting.getRegisteredContentScripts()).length,
          matched: (await chrome.declarativeNetRequest.testMatchOutcome({
            url: 'https://googleads.g.doubleclick.net/pagead/ads',
            type: 'xmlhttprequest',
            initiator: 'https://music.youtube.com',
          })).matchedRules.length,
        };
      });
      assert.ok(state.enabled.length > 0, 'DNR rulesets enabled');
      assert.ok(state.count > 0, 'active static DNR rules exist');
      assert.ok(state.matched > 0, 'Chromium DNR engine matches an ad request without making a network request');
      console.log('uBOL session protection:', JSON.stringify(state));
      assert.equal(state.permissions, true);
      assert.ok(state.scripts > 0, 'filtering content scripts registered');
    }
    await first.page.evaluate(() => { localStorage.setItem('isolation', 'first'); document.cookie = 'isolation=first; SameSite=Lax; Secure'; });
    assert.equal(await second.page.evaluate(() => localStorage.getItem('isolation')), null);
    assert.equal((await second.context.cookies()).some((cookie: any) => cookie.name === 'isolation'), false);
    const firstWorker = contexts[0].serviceWorkers()[0];
    const secondWorker = contexts[1].serviceWorkers()[0];
    await firstWorker.evaluate(() => (globalThis as any).chrome.storage.local.set({ sonoraIsolation: 'first' }));
    assert.deepEqual(await secondWorker.evaluate(() => (globalThis as any).chrome.storage.local.get('sonoraIsolation')), {});
    assert.equal(bridge.sessionCount, 2);
  } finally {
    chromium.launchPersistentContext = original;
    chromium.launch = originalLaunch;
    await bridge.close();
    assert.equal(bridge.sessionCount, 0);
    for (const context of contexts) assert.equal(context.browser()?.isConnected(), false);
  }
});

test('explicit SONORA_ADBLOCK=false opts out and failed readiness can be retried', { timeout: 30000 }, async () => {
  const previous = process.env.SONORA_ADBLOCK;
  const previousDir = process.env.SONORA_ADBLOCK_EXTENSION_DIR;
  const original = chromium.launchPersistentContext.bind(chromium);
  const bridge = new ChromiumBridge();
  let context: BrowserContext | undefined;
  process.env.SONORA_ADBLOCK_EXTENSION_DIR = resolve('.sonora/extensions/does-not-exist');
  process.env.SONORA_ADBLOCK = 'true';
  chromium.launchPersistentContext = async (profile, options) => {
    assert.equal(profile, '');
    assert.equal(options?.channel, 'chromium');
    assert.equal(options?.args?.some(arg => arg.startsWith('--load-extension=') || arg.startsWith('--disable-extensions-except=')), false);
    context = await original(profile, options);
    await context.route('https://music.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Explicit opt-out fixture</title><div id="movie_player"></div><script>document.querySelector("#movie_player").loadVideoById = () => {};</script>' }));
    return context;
  };
  try {
    await assert.rejects(bridge.ensureReady(), /adblock.*manifest/i);
    process.env.SONORA_ADBLOCK = 'false';
    await Promise.all([bridge.ensureReady(), bridge.ensureReady()]);
    await (bridge as any).getSession('explicit-opt-out');
    assert.deepEqual(context!.serviceWorkers(), []);
    assert.equal(bridge.sessionCount, 1);
  } finally {
    chromium.launchPersistentContext = original;
    await bridge.close();
    if (previous === undefined) delete process.env.SONORA_ADBLOCK;
    else process.env.SONORA_ADBLOCK = previous;
    if (previousDir === undefined) delete process.env.SONORA_ADBLOCK_EXTENSION_DIR;
    else process.env.SONORA_ADBLOCK_EXTENSION_DIR = previousDir;
  }
});
