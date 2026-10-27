import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import app from '../src/server/ytmusic/api.js';
import { directDownloader } from '../src/server/bridge/DirectDownloader.js';
import type { DownloadArtifact } from '../src/server/bridge/DownloadArtifact.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const outcome of ['success', 'error', 'cancel'] as const) test(`shared download admission without requestId recovers after ${outcome}`, async () => {
  const original = directDownloader.download;
  const root = await mkdtemp(resolve('.sonora/admission-test-'));
  const path = join(root, 'audio.webm');
  await writeFile(path, 'fixture');
  const pending: Array<ReturnType<typeof deferred<DownloadArtifact>>> = [];
  const entered = Array.from({ length: 21 }, () => deferred());
  const disposed = deferred(), allowDispose = deferred();
  let probingCapacity = false;
  directDownloader.download = async (_id, signal) => {
    if (probingCapacity) throw new Error('unbounded admission invoked downloader');
    const slot = deferred<DownloadArtifact>();
    const index = pending.push(slot) - 1;
    signal.addEventListener('abort', () => slot.reject(new Error('fixture cancelled')), { once: true });
    entered[index]?.resolve();
    return slot.promise;
  };
  const artifact = (blockDispose = false): DownloadArtifact => ({ path, duration: 1, size: 7, dispose: async () => {
    if (blockDispose) { disposed.resolve(); await allowDispose.promise; }
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/ytmusic/download/abcdefghijk`;
  const controller = new AbortController();
  const first = fetch(url, { signal: controller.signal }).then(async response => ({ status: response.status, body: await response.text() }), () => ({ status: 0, body: '' }));
  await entered[0].promise;
  // A progress-bearing request shares the same pool as anonymous downloads.
  const second = fetch(`${url}?session=admission&requestId=12345678-1234-4234-8234-${outcome === 'success' ? '111111111111' : outcome === 'error' ? '222222222222' : '333333333333'}`);
  await entered[1].promise;
  const extra = Array.from({ length: 18 }, () => fetch(url));
  await Promise.all(entered.slice(2, 20).map(item => item.promise));
  try {
    probingCapacity = true;
    const rejected = await fetch(url);
    probingCapacity = false;
    assert.equal(rejected.status, 503);
    await rejected.text();
    assert.equal(pending.length, 20, 'capacity rejection must not invoke the downloader');
    if (outcome === 'success') {
      pending[0].resolve(artifact(true));
      assert.equal((await first).status, 200);
      await disposed.promise;
      const stillFull = await fetch(url);
      assert.equal(stillFull.status, 503, 'retain admission until artifact cleanup finishes');
      await stillFull.text();
      allowDispose.resolve();
    } else if (outcome === 'error') {
      pending[0].reject(new Error('fixture download failure'));
      assert.equal((await first).status, 502);
    } else {
      controller.abort();
      await first;
    }
    // The cancellation/finally continuation may run after the client observes close.
    let recovered: Response | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      const responsePromise = fetch(url);
      const result = await Promise.race([entered[20].promise.then(() => 'admitted' as const), responsePromise]);
      if (result === 'admitted') {
        pending[20].resolve(artifact());
        recovered = await responsePromise;
        break;
      }
      assert.equal(result.status, 503); await result.text();
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(recovered, 'released slot must admit another request');
    assert.equal(recovered.status, 200); await recovered.text();
  } finally {
    allowDispose.resolve();
    for (const slot of pending) slot.resolve(artifact());
    await first;
    const response = await second; await response.text();
    for (const response of await Promise.all(extra)) await response.text();
    await new Promise<void>(resolve => server.close(() => resolve()));
    directDownloader.download = original;
    await rm(root, { recursive: true, force: true });
  }
});

test('download admission remains occupied during response streaming and releases on disconnect', async () => {
  const original = directDownloader.download;
  const root = await mkdtemp(resolve('.sonora/admission-stream-'));
  const path = join(root, 'audio.webm');
  const file = await open(path, 'w');
  const size = 64 * 1024 * 1024;
  await file.truncate(size); await file.close();
  const disposed = deferred();
  let calls = 0;
  directDownloader.download = async () => {
    calls++;
    return { path, size, duration: 1, dispose: async () => { disposed.resolve(); } };
  };
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/ytmusic/download/abcdefghijk`;
  const clients: ReturnType<typeof get>[] = [];
  let waitingResponses = 0;
  try {
    for (let index = 0; index < 4; index++) {
      await new Promise<void>((resolve, reject) => {
        const client = get(url, response => { response.pause(); resolve(); });
        client.on('error', reject); clients.push(client);
      });
    }
    for (let index = 0; index < 16; index++) {
      const client = get(url, response => { waitingResponses++; response.pause(); });
      client.on('error', () => {}); clients.push(client);
    }
    for (let attempt = 0; calls < 20 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 20, 'all twenty downloads can prepare while only four are transferring');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(waitingResponses, 0, 'no fifth transfer may start while four are active');
    const full = await fetch(url);
    assert.equal(full.status, 503); await full.text();
    assert.equal(calls, 20, 'completed provider work must not release a still-streaming slot');
    clients[0].destroy();
    await disposed.promise;
    for (let attempt = 0; waitingResponses === 0 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(waitingResponses > 0, 'a waiting transfer starts when a slot is released');
    for (const client of clients.slice(1)) client.destroy();
    const recovered = await fetch(url);
    assert.equal(recovered.status, 200);
    await recovered.arrayBuffer();
  } finally {
    for (const client of clients) client.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    directDownloader.download = original;
    await rm(root, { recursive: true, force: true });
  }
});
