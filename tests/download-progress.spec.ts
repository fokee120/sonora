import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test.use({ serviceWorkers: 'block' });
const track = { id: 'ytm:abcdefghijk', source: 'ytmusic', sourceId: 'abcdefghijk', cloudKey: 'ytmusic://abcdefghijk', title: 'Capture progress test', artist: 'Fixture', album: 'Tests', duration: 3 };
async function setup(page: any) {
  await page.route('**/api/**', (route: any) => route.fulfill({ json: { user: null, authRequired: false, tracks: [track], albums: [], artists: [] } }));
  await page.goto('/');
  await page.evaluate(async track => {
    const path = '/src/lib/db.ts'; const db = await import(path); await db.dbService.saveTracks([track]);
  }, track);
  await page.reload();
  await page.locator('#nav-library').click();
  await page.locator('#library-view').getByRole('tab', { name: 'Songs', exact: true }).click();
  await expect(page.locator('#library-view').getByText(track.title, { exact: true })).toBeVisible();
}
async function state(page: any) {
  return page.evaluate(async id => {
    const path = '/src/lib/offline/OfflineManager.ts';
    const { offlineManager: m } = await import(path);
    return { state: m.getDownloadState(id), stored: !!await m.audioStorage.get(id) };
  }, track.id);
}
test('reported direct transfer advances before headers, finalizing stays below 100, native file validates and saves', async ({ page }) => {
  await setup(page);
  let release!: () => void; const headers = new Promise<void>(resolve => { release = resolve; });
  let phase = 'fetching', polls = 0;
  await page.route('**/api/ytmusic/download-status/**', route => { polls++; return route.fulfill({ json: { phase, progress: 47, recordedSeconds: 0, sourceDuration: 3, downloadedBytes: 1024, totalBytes: 2048 } }); });
  await page.route('**/api/ytmusic/download/**', async route => {
    expect(new URL(route.request().url()).searchParams.get('requestId')).toMatch(/^[\da-f-]{36}$/);
    await headers;
    await route.fulfill({ body: readFileSync(new URL('./fixtures/offline-complete.webm', import.meta.url)), headers: { 'content-type': 'audio/webm' } });
  });
  await page.evaluate(async track => { const p = '/src/lib/offline/OfflineManager.ts'; await (await import(p)).offlineManager.downloadTrack(track); }, track);
  await expect.poll(async () => (await state(page)).state?.progress).toBe(47);
  const row = page.locator("#library-view").locator(`[id="track-row-${track.id}"]`).first();
  await expect(row.getByRole('status')).toContainText('Downloading audio file');
  await expect(row.getByRole('status')).toContainText('1.0 KB / 2.0 KB');
  await expect(row.getByRole('button', { name: 'Cancel download' })).toContainText('47%');
  expect((await state(page)).stored).toBe(false);
  phase = 'finalizing';
  await expect.poll(async () => (await state(page)).state?.phase).toBe('finalizing');
  expect((await state(page)).state?.progress).toBeLessThan(100);
  release();
  await expect.poll(async () => (await state(page)).state?.status).toBe('completed');
  expect((await state(page)).stored).toBe(true);
  const stoppedAt = polls; await page.waitForTimeout(1100); expect(polls).toBe(stoppedAt);
});
test('download completes when secure-context randomUUID is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  await setup(page);
  let requestId: string | null = null;
  await page.route('**/api/ytmusic/download-status/**', route => route.fulfill({ json: { phase: 'finalizing', progress: 95, recordedSeconds: 3, sourceDuration: 3 } }));
  await page.route('**/api/ytmusic/download/**', route => {
    requestId = new URL(route.request().url()).searchParams.get('requestId');
    return route.fulfill({ body: readFileSync(new URL('./fixtures/offline-complete.webm', import.meta.url)), headers: { 'content-type': 'audio/webm' } });
  });
  await page.locator(`[id="track-row-${track.id}"]`).first().getByTitle('Download for offline playback').click();
  await expect.poll(async () => (await state(page)).state?.status).toBe('completed');
  expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect((await state(page)).stored).toBe(true);
});

test('cancel at zero clears polling and does not save', async ({ page }) => {
  await setup(page);
  let polls = 0;
  await page.route('**/api/ytmusic/download-status/**', route => { polls++; return route.fulfill({ json: { phase: 'preparing', progress: 0, recordedSeconds: 0, sourceDuration: 0 } }); });
  await page.route('**/api/ytmusic/download/**', async route => { await new Promise(resolve => setTimeout(resolve, 2000)); await route.abort().catch(() => {}); });
  await page.evaluate(async track => { const p = '/src/lib/offline/OfflineManager.ts'; await (await import(p)).offlineManager.downloadTrack(track); }, track);
  await expect.poll(() => polls).toBeGreaterThan(0);
  await page.locator(`[id="track-row-${track.id}"]`).first().getByRole('button', { name: 'Cancel download' }).click();
  await expect.poll(async () => (await state(page)).state).toBeUndefined();
  const stoppedAt = polls; await page.waitForTimeout(1100); expect(polls).toBe(stoppedAt);
  expect((await state(page)).stored).toBe(false);
});
