import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChromiumBridge } from '../src/server/bridge/ChromiumBridge.js';

test('MP3 transcoding propagates capture errors instead of silently returning EOF', async () => {
  const bridge = new ChromiumBridge();
  async function* broken() { throw new Error('fixture capture failed'); yield Buffer.alloc(0); }
  await assert.rejects(async () => {
    for await (const _chunk of (bridge as any).transcodeToMp3(broken())) { /* drain */ }
  }, /fixture capture failed/);
});
