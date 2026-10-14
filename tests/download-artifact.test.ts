import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseBuffer } from 'music-metadata';
import { finalizeDownload } from '../src/server/bridge/DownloadArtifact.js';

const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'webm', 'pipe:1']);
assert.equal(generated.status, 0, generated.stderr.toString());
async function* tone() { yield generated.stdout; }

test('decoded sample duration rejects a falsely complete short container', async () => {
  await assert.rejects(finalizeDownload(tone(), { expectedDuration: 4, complete: true }, 'webm', new AbortController().signal), /Incomplete audio duration/);
});
test('capture failure after bytes is never finalized as normal success', async () => {
  async function* broken() { yield generated.stdout; throw new Error('capture superseded'); }
  await assert.rejects(finalizeDownload(broken(), { expectedDuration: 1, complete: true }, 'webm', new AbortController().signal), /superseded/);
});
test('offline MP3 is finalized with independently validated full duration', async () => {
  const file = await finalizeDownload(tone(), { expectedDuration: 1, complete: true }, 'mp3', new AbortController().signal);
  try {
    assert.ok(Math.abs(file.duration - 1) < 0.1);
    const metadata = await parseBuffer(await readFile(file.path), { mimeType: 'audio/mpeg' }, { duration: true });
    assert.ok(Math.abs(metadata.format.duration! - 1) < 0.15);
  } finally { await file.dispose(); }
});
