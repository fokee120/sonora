import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioStream } from '../src/server/bridge/AudioStream.js';

test('stream drains final bytes and then ends', async () => {
  const stream = new AudioStream(1, 16);
  stream.push(Buffer.from('header')); stream.end();
  assert.equal((await stream.next())?.toString(), 'header');
  assert.equal(await stream.next(), null);
});

test('slow consumers fail bounded rather than dropping container bytes', async () => {
  const stream = new AudioStream(1, 4);
  stream.push(Buffer.from('1234')); stream.push(Buffer.from('5'));
  await assert.rejects(stream.next(), /consumer.*slow/i);
  assert.equal(stream.bufferedBytes, 0);
});

test('capture readiness fails immediately when a generation ends before bytes', async () => {
  const stream = new AudioStream(1);
  const waiting = stream.waitForBytes();
  stream.end();
  await assert.rejects(waiting, /ended.*before.*bytes/i);
});

test('ending a replaced generation wakes its reader without touching replacement', async () => {
  const old = new AudioStream(1); const fresh = new AudioStream(2);
  const pending = old.next(); old.end();
  fresh.push(Buffer.from('new'));
  assert.equal(await pending, null);
  assert.equal((await fresh.next())?.toString(), 'new');
});
