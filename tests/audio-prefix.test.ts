import { Mp3Ranges } from '../src/server/bridge/Mp3Ranges.js';
import { TransferSlots } from '../src/server/ytmusic/transferSlots.js';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { readProgressiveAudio, rememberProgressivePrefix, type ProgressiveAudioSource } from '../src/server/bridge/ProgressiveAudio.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedPrefixLength } from '../src/server/bridge/AudioPrefix.js';

test('timed prefix uses each segment byte/time ratio and rejects incomplete indexes', () => {
  const index = Buffer.alloc(56);
  index.writeUInt32BE(index.length);
  index.write('sidx', 4);
  index.writeUInt32BE(1000, 16);
  index.writeUInt16BE(2, 30);
  index.writeUInt32BE(120_000, 32);
  index.writeUInt32BE(10_000, 36);
  index.writeUInt32BE(200_000, 44);
  index.writeUInt32BE(10_000, 48);
  assert.equal(indexedPrefixLength(index), index.length + 120_000 + 100_000);
  assert.equal(indexedPrefixLength(index, 5), index.length + 60_000);
  assert.equal(indexedPrefixLength(index.subarray(0, 55)), undefined);
  assert.equal(indexedPrefixLength(index, 21), undefined);
});

test('the encoder receives cached bytes first and reads only the exact upstream remainder', async () => {
  const full = Buffer.from(Uint8Array.from({ length: 2 * 1024 * 1024 + 500 }, (_, i) => i % 251));
  const requested: string[] = [];
  const app = express();
  app.get('/original', (req, res) => {
    const range = req.headers.range!;
    requested.push(range);
    const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    res.status(206).set('Content-Range', 'bytes ' + first + '-' + last + '/' + full.length)
      .send(full.subarray(+first, +last + 1));
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const source: ProgressiveAudioSource = {
    url: new URL('http://127.0.0.1:' + (server.address() as AddressInfo).port + '/original'),
    duration: 200, format: 'm4a', expires: Date.now() + 60_000, size: full.length,
  };
  const prefix = full.subarray(0, 200);
  rememberProgressivePrefix(source, prefix);
  try {
    const stream = readProgressiveAudio(source, AbortSignal.timeout(5_000));
    const first = await stream.next();
    assert.equal(first.done, false);
    assert.deepEqual(first.value, prefix);
    assert.deepEqual(requested, []);
    const chunks = [prefix];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), full);
    assert.deepEqual(requested, ['bytes=200-2097351', 'bytes=2097352-2097651']);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});


test('Safari probes and concurrent range reads share a single encoder and an exact byte length', async () => {
  const full = Buffer.from(Uint8Array.from({ length: 2_000 }, (_, i) => i % 251));
  let prepared = 0;
  let encoders = 0;
  let continuation = 0;
  const ranged = new Mp3Ranges(new TransferSlots(1), async () => {
    prepared++;
    return { size: full.length, async *stream() {
      encoders++;
      yield full.subarray(0, 384);
      continuation++;
      yield full.subarray(384, 700);
      yield full.subarray(700);
    } };
  });
  const app = express();
  app.get('/play', async (req, res, next) => {
    res.type('audio/mpeg');
    try {
      if (!await ranged.serve('one-play', 'fixture', 0, req, res, AbortSignal.timeout(4_000), () => {})) res.sendStatus(502);
    } catch (error) { next(error); }
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/play';
  try {
    const probe = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    assert.equal(probe.status, 206);
    assert.equal(probe.headers.get('Content-Range'), 'bytes 0-1/2000');
    assert.equal(probe.headers.get('Content-Length'), '2');
    assert.deepEqual(Buffer.from(await probe.arrayBuffer()), full.subarray(0, 2));
    assert.equal(continuation, 0);

    const [followup, seek, whole] = await Promise.all([
      fetch(url, { headers: { Range: 'bytes=2-' } }),
      fetch(url, { headers: { Range: 'bytes=600-659' } }),
      fetch(url),
    ]);
    for (const [response, expectedStatus, first, last] of [
      [followup, 206, 2, 1999], [seek, 206, 600, 659], [whole, 200, 0, 1999],
    ] as const) {
      assert.equal(response.status, expectedStatus);
      assert.equal(response.headers.get('Content-Length'), String(last - first + 1));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), full.subarray(first, last + 1));
    }
    const tail = await fetch(url, { headers: { Range: 'bytes=-20' } });
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), full.subarray(-20));
    const invalid = await fetch(url, { headers: { Range: 'bytes=2000-' } });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('Content-Range'), 'bytes */2000');
    assert.equal(prepared, 1);
    assert.equal(encoders, 1);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('long MP3 source bytes wrap cleanly and evicted seeks reconstruct the expected slice', async () => {
  const size = 820_000;
  const bytes = (first: number, last: number) => Buffer.from(Uint8Array.from({ length: last - first }, (_, i) => (first + i) % 251));
  let encoders = 0;
  const ranged = new Mp3Ranges(new TransferSlots(1), async () => ({
    size,
    async *stream() {
      encoders++;
      for (let first = 0; first < size; first += 37_163) {
        yield bytes(first, Math.min(size, first + 37_163));
      }
    },
  }));
  const app = express();
  app.get('/play', async (req, res, next) => {
    try {
      if (!await ranged.serve('long-play', 'fixture', 0, req, res, AbortSignal.timeout(4_000), () => {})) res.sendStatus(502);
    } catch (error) { next(error); }
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/play';
  try {
    const whole = await fetch(url);
    assert.equal(whole.headers.get('Content-Length'), String(size));
    assert.deepEqual(Buffer.from(await whole.arrayBuffer()), bytes(0, size));
    const prefix = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    const tail = await fetch(url, { headers: { Range: 'bytes=-20' } });
    assert.deepEqual(Buffer.from(await prefix.arrayBuffer()), bytes(0, 2));
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes(size - 20, size));
    assert.equal(encoders, 1);
    const beforeWindow = await fetch(url, { headers: { Range: 'bytes=150000-151000' } });
    assert.equal(beforeWindow.status, 206);
    assert.deepEqual(Buffer.from(await beforeWindow.arrayBuffer()), bytes(150000, 151001));
    assert.equal(encoders, 2);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
