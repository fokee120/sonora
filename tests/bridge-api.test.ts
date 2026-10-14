import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import app from '../src/server/ytmusic/api.js';
import { chromiumBridge } from '../src/server/bridge/ChromiumBridge.js';

// HTTP contract tests inject the bridge seam; real media tests live separately.
test('bridge HTTP contract validates start, prepares once per request, and reports pre-byte errors as JSON', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const originalPrepare = chromiumBridge.prepare, originalPlay = chromiumBridge.play;
  const id = randomBytes(8).toString('base64url').slice(0, 11);
  const calls: unknown[][] = [];
  chromiumBridge.prepare = async session => { calls.push(['prepare', session]); };
  chromiumBridge.play = async function* (...args) { calls.push(args); yield Buffer.from('contract fixture'); };
  try {
    const prepared = await fetch(`${base}/api/ytmusic/bridge/prepare?session=contract`, { method: 'POST' });
    assert.equal(prepared.status, 200); assert.equal((await prepared.json()).ok, true);
    assert.deepEqual(calls.shift(), ['prepare', 'contract']);
    for (const invalid of ['NaN', '-1', '', 'Infinity', '1&start=2']) {
      const response = await fetch(`${base}/api/ytmusic/stream/${id}?start=${invalid}`);
      assert.equal(response.status, 400, `start=${invalid}`); await response.text();
    }
    const response = await fetch(`${base}/api/ytmusic/stream/${id}?session=contract&start=42.5`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-audio-start'), '42.5');
    assert.equal(await response.text(), 'contract fixture');
    assert.equal(calls[0][0], 'contract'); assert.equal(calls[0][1], id); assert.equal(calls[0][4], 42.5);
    chromiumBridge.play = async function* () { throw new Error('fixture upstream unavailable'); yield Buffer.alloc(0); };
    const failed = await fetch(`${base}/api/ytmusic/stream/${id}`);
    assert.equal(failed.status, 502);
    assert.match(failed.headers.get('content-type')!, /application\/json/);
    assert.match((await failed.json()).details, /fixture upstream unavailable/);
  } finally {
    chromiumBridge.prepare = originalPrepare; chromiumBridge.play = originalPlay;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
