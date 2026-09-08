import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server/ytmusic/api.js';
import { youtubeMusicClient } from '../src/server/ytmusic/YoutubeMusicClient.js';
import { matchingUploads } from '../src/server/ytmusic/matchingUploads.js';
import { audioBackendService } from '../src/server/ytmusic/AudioBackendService.js';

const original = { videoId: 'lYBUbBu4W08', title: 'Never Gonna Give You Up', artist: 'Rick Astley', durationSeconds: 214 };
const candidate = { ...original, videoId: 'dQw4w9WgXcQ' };
test('alternate upload matching rejects different artists, versions, and durations', () => {
  assert.deepEqual(matchingUploads(original, [
    original, candidate,
    { ...candidate, artist: 'Cover Artist' },
    { ...candidate, title: original.title + ' (Live)' },
    { ...candidate, title: original.title + ' (Remix)' },
    { ...candidate, durationSeconds: 35 },
    { ...candidate, durationSeconds: 0 },
  ]), [candidate]);
});

test('playback and downloads recover an empty backend upload using matching MP3 audio', async () => {
  const realFetch = globalThis.fetch;
  const realSearch = youtubeMusicClient.search;
  audioBackendService.setConfig({ enabled: true, url: 'https://audio.test' });
  youtubeMusicClient.search = async () => ({ query: '', filter: 'videos', songs: [candidate] });
  const resolved: string[] = [];
  globalThis.fetch = (async (url: any) => {
    assert.ok(String(url).startsWith('https://audio.test/audio/'));
    const id = String(url).split('/').pop()!;
    resolved.push(id);
    return new Response(id === original.videoId ? new Uint8Array() : new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  const query = new URLSearchParams({ title: original.title, artist: original.artist, duration: '214' });
  try {
    for (const kind of ['stream', 'download']) {
      const response = await realFetch(`http://127.0.0.1:${port}/api/ytmusic/${kind}/${original.videoId}?${query}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-audio-video-id'), candidate.videoId);
      assert.equal((await response.arrayBuffer()).byteLength, 4);
    }
    assert.deepEqual(resolved, [original.videoId, candidate.videoId, original.videoId, candidate.videoId]);
    youtubeMusicClient.search = async () => ({ query: '', filter: 'videos', songs: [{ ...candidate, artist: 'Wrong Artist' }] });
    const rejected = await realFetch(`http://127.0.0.1:${port}/api/ytmusic/stream/${original.videoId}?${query}`);
    assert.equal(rejected.status, 502);
    assert.match((await rejected.json()).details, /no matching playable upload/);
  } finally {
    globalThis.fetch = realFetch;
    youtubeMusicClient.search = realSearch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
