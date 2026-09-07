import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.VERCEL = '1';
const { default: app } = await import('../server.js');
const { downloaderService } = await import('../src/server/ytmusic/DownloaderService.js');
test('native stream uses configured downloader and forwards ranges; rejects HTML', async () => {
  const originalFetch = globalThis.fetch;
  downloaderService.setConfig({ enabled: true, url: 'https://audio-provider.test', audioFormat: 'm4a' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  let html = false;
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url) === 'https://audio-provider.test') {
      assert.equal(JSON.parse(options.body).downloadMode, 'audio');
      assert.equal(JSON.parse(options.body).audioFormat, 'mp3');
      return Response.json({ status: 'tunnel', url: 'https://media.test/audio' });
    }
    assert.equal(String(url), 'https://media.test/audio');
    assert.equal(options.headers.Range, 'bytes=0-3');
    return html ? new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } })
      : new Response(new Uint8Array([1,2,3,4]), { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-3/100', 'content-length': '4' } });
  }) as typeof fetch;
  try {
    const url = `http://127.0.0.1:${address.port}/api/ytmusic/stream/abc-def_123`;
    const response = await originalFetch(url, { headers: { Range: 'bytes=0-3' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
    assert.equal((await response.arrayBuffer()).byteLength, 4);
    html = true;
    const bad = await originalFetch(url, { headers: { Range: 'bytes=0-3' } });
    assert.equal(bad.status, 502);
    assert.match((await bad.json()).details, /instead of audio/);
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
