import { test, expect } from '@playwright/test';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('production app reopens without its server after browser restart and retains downloads', async ({ playwright, browserName, baseURL: upstream }, testInfo) => {
  // Stop this real origin after installation. WebKit's offline emulation itself
  // rejects service-worker responses (Playwright #42775); an unavailable origin
  // tests its actual cached navigation without that emulation bug.
  const origin = createServer((req, res) => {
    const proxy = request(new URL(req.url!, upstream), { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode!, response.headers);
      response.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(proxy);
  });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${(origin.address() as { port: number }).port}`;
  const stopOrigin = () => new Promise<void>(resolve => {
    origin.close(() => resolve()); origin.closeAllConnections();
  });
  // Keep persistent browser paths short on Windows (CacheStorage nests hashes).
  const profile = mkdtempSync(path.join(tmpdir(), 'sonora-pwa-'));
  const launch = (offline = false) => playwright[browserName].launchPersistentContext(profile, {
    headless: true, offline, viewport: { width: 1280, height: 800 },
  });
  let context = await launch();
  try {
    let page = await context.newPage();
    page.on('console', message => { if (message.text().includes('Offline app setup')) console.log(message.text()); });
    const response = await page.goto(baseURL!);
    expect(await response!.text()).not.toContain('/@vite/client');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
    await expect(page.getByTestId('offline-readiness')).toContainText('Ready to open offline');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const sw = await context.request.get(`${baseURL}/sw.js`);
    expect(sw.headers()['content-type']).toContain('javascript');
    expect(sw.headers()['cache-control']).toContain('no-cache');
    expect((await context.request.get(`${baseURL}/api/not-a-real-route`)).status()).toBe(404);
    expect((await context.request.get(`${baseURL}/assets/missing.js`)).status()).toBe(404);

    // Save a real PCM WAV and the same records used by completed downloads.
    const nativeDecodeWorks = await page.evaluate(async () => {
      const samples = 8000 * 12, buffer = new ArrayBuffer(44 + samples * 2);
      const view = new DataView(buffer);
      const write = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
      write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVEfmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples * 2, true);
      for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(1000 * Math.sin(i * Math.PI * 2 * 440 / 8000)), true);
      const blob = new Blob([buffer], { type: 'audio/wav' });
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('personal-music-player-db');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(['tracks', 'downloads', 'audioBlobs'], 'readwrite');
      tx.objectStore('tracks').put({ id: 'offline-fixture', title: 'Cold start offline song', artist: 'Fixture', album: 'Tests', duration: 12, cloudKey: 'unused', format: 'wav' });
      tx.objectStore('downloads').put({ trackId: 'offline-fixture', status: 'completed', progress: 100, bytesDownloaded: blob.size, totalBytes: blob.size, downloadedAt: Date.now() });
      tx.objectStore('audioBlobs').put({ trackId: 'offline-fixture', blob, mimeType: blob.type, size: blob.size, cachedAt: Date.now() });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
      // Probe the test engine directly before the restart; Windows WebKit can
      // report canPlayType('audio/wav') yet reject even a raw PCM fixture.
      const url = URL.createObjectURL(blob);
      const audio = new Audio();
      const decoded = await new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(false), 4000);
        audio.onloadedmetadata = () => { clearTimeout(timer); resolve(true); };
        audio.onerror = () => { clearTimeout(timer); resolve(false); };
        audio.src = url;
      });
      audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
      return decoded;
    });
    await context.close();
    await stopOrigin();
    await expect(fetch(baseURL)).rejects.toThrow();
    context = await launch(browserName === 'chromium');
    page = await context.newPage();
    await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
    if (browserName === 'chromium') expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    // Load previously unused theme fonts after the real origin is stopped.
    for (const [name, font] of [['Notebook','Sonora Hand'],['Retro','Sonora Pixel']]) {
      await page.getByRole('button', {name: name+' theme', exact:true}).click();
      await expect(page.locator('html')).toHaveAttribute('data-style', name.toLowerCase());
      expect(await page.evaluate(async font => (await document.fonts.load('16px "'+font+'"')).length, font)).toBeGreaterThan(0);
    }
    await page.getByRole('button', {name:'Default theme', exact:true}).click();
    await page.getByRole('tab', { name: 'Downloads', exact: true }).click();
    await expect(page.getByTestId('offline-readiness')).toContainText('Ready to open offline');
    await page.locator('#downloads-view').locator('[data-track-id="offline-fixture"]').scrollIntoViewIfNeeded();
    const row = page.locator('#downloads-view').locator('#track-row-offline-fixture');
    await expect(row).toContainText('Cold start offline song');
    const saved = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('personal-music-player-db'); r.onsuccess = () => resolve(r.result); });
      const record = await new Promise<any>(resolve => { const r = db.transaction('audioBlobs').objectStore('audioBlobs').get('offline-fixture'); r.onsuccess = () => resolve(r.result); });
      const bytes = new Uint8Array(await record.blob.arrayBuffer()); db.close();
      return { size: bytes.length, signature: String.fromCharCode(...bytes.slice(0, 4)) };
    });
    expect(saved).toEqual({ size: 192044, signature: 'RIFF' });
    if (!nativeDecodeWorks && browserName === 'webkit' && process.platform === 'win32') {
      testInfo.annotations.push({ type: 'Media limitation', description: 'Windows WebKit rejects the raw PCM fixture even online. Cold offline navigation and saved audio bytes verified; playback requires Safari/macOS verification.' });
      return;
    }
    expect(nativeDecodeWorks).toBe(true);
    await row.click();
    await expect(page.locator('#bottom-player-bar').getByTitle('Playing from local IndexedDB cache')).toBeVisible();
    const progress = page.locator('#bottom-player-bar [role="slider"]').first();
    await expect.poll(async () => Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    await expect(page.getByTestId('dock-notices').getByRole('alert')).toHaveCount(0);
  } finally { await context.close(); await stopOrigin(); }
});

test('a production worker update keeps a paused native player attached until idle',async({page})=>{
 await page.addInitScript(()=>{const count=Number(sessionStorage.getItem('test-shell-starts')||0)+1;sessionStorage.setItem('test-shell-starts',String(count));});
 await page.goto('/');
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.reload();await page.waitForLoadState('networkidle');
 const before=await page.evaluate(()=>Number(sessionStorage.getItem('test-shell-starts')));
 await page.evaluate(()=>{
  const audio=document.createElement('audio');audio.dataset.sonoraPlayer='true';audio.src='data:audio/wav;base64,UklGRg==';audio.hidden=true;document.body.append(audio);
  Object.defineProperty(navigator.serviceWorker,'controller',{configurable:true,get:()=>({scriptURL:new URL('/sw.js',location.href).href})});
  navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
 });
 await page.waitForTimeout(400);
 expect(await page.evaluate(()=>Number(sessionStorage.getItem('test-shell-starts')))).toBe(before);
 expect(await page.locator('audio[data-sonora-player]').count()).toBe(1);
 await Promise.all([page.waitForEvent('domcontentloaded'),page.evaluate(()=>{document.querySelector('audio[data-sonora-player]')?.remove();document.dispatchEvent(new Event('visibilitychange'));})]);
 await expect.poll(()=>page.evaluate(()=>Number(sessionStorage.getItem('test-shell-starts')))).toBeGreaterThan(before);
});
