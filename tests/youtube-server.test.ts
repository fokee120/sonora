import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server/ytmusic/api.js';
import { downloaderService } from '../src/server/ytmusic/DownloaderService.js';

test('Cobalt transfers complete, reject errors, and keep the server alive after a broken stream', async () => {
  const originalFetch = globalThis.fetch;
  downloaderService.setConfig({ enabled: true, url: 'https://audio-provider.test', audioFormat: 'm4a' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  let mode = 'range';
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url) === 'https://audio-provider.test') {
      const body = JSON.parse(options.body);
      assert.equal(body.downloadMode, 'audio');
      assert.equal(body.audioFormat, 'mp3');
      assert.equal(body.alwaysProxy, true);
      if (mode === 'resolve-error') return Response.json({ status: 'error', error: { code: 'error.api.fetch.fail' } }, { status: 400 });
      return Response.json({ status: 'tunnel', url: 'https://media.test/audio' });
    }
    assert.equal(String(url), 'https://media.test/audio'); // No hidden fallback to InnerTube.
    if (mode === 'empty') return new Response(new Uint8Array(), { headers: { 'content-type': 'audio/mpeg' } });
    if (mode === 'html') return new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } });
    if (mode === 'media-error') return new Response('upstream failed', { status: 500 });
    if (mode === 'broken') return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      setTimeout(() => controller.error(new Error('connection lost')), 30);
    } }), { headers: { 'content-type': 'audio/mpeg' } });
    if (mode === 'range') {
      assert.equal(options.headers.Range, 'bytes=0-3');
      return new Response(new Uint8Array([1,2,3,4]), { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-3/100', 'content-length': '4' } });
    }
    return new Response(new Uint8Array([1,2,3,4]), { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch;
  const url = `http://127.0.0.1:${port}/api/ytmusic/stream/abc-def_123`;
  try {
    const response = await originalFetch(url, { headers: { Range: 'bytes=0-3' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
    assert.equal((await response.arrayBuffer()).byteLength, 4);
    mode = 'chunked';
    const full = await originalFetch(url);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), null);
    assert.equal((await full.arrayBuffer()).byteLength, 4);
    for (const [failure, message] of [['empty', /empty audio stream/], ['html', /instead of audio/], ['resolve-error', /error.api.fetch.fail/], ['media-error', /HTTP 500/]] as const) {
      mode = failure;
      const bad = await originalFetch(url);
      assert.equal(bad.status, 502);
      assert.match((await bad.json()).details, message);
    }
    mode = 'broken';
    await assert.rejects(async () => { const broken = await originalFetch(url); await broken.arrayBuffer(); });
    mode = 'chunked';
    const next = await originalFetch(url.replace('/stream/', '/download/'));
    assert.equal(next.status, 200);
    assert.equal((await next.arrayBuffer()).byteLength, 4);
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
