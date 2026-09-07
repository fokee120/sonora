import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server/ytmusic/api.js';
import { youtubeMusicClient } from '../src/server/ytmusic/YoutubeMusicClient.js';
import { matchingUploads } from '../src/server/ytmusic/matchingUploads.js';
import { downloaderService } from '../src/server/ytmusic/DownloaderService.js';

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

test('playback and downloads recover an empty Cobalt upload using matching Cobalt audio', async () => {
  const realFetch = globalThis.fetch;
  const realSearch = youtubeMusicClient.search;
  downloaderService.setConfig({ enabled: true, url: 'https://cobalt.test', audioFormat: 'mp3' });
  youtubeMusicClient.search = async () => ({ query: '', filter: 'videos', songs: [candidate] });
  const resolved: string[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url) === 'https://cobalt.test') {
      const id = new URL(JSON.parse(options.body).url).searchParams.get('v')!;
      resolved.push(id);
      return Response.json({ status: 'tunnel', url: 'https://media.test/' + id });
    }
    assert.ok(String(url).startsWith('https://media.test/'));
    return new Response(String(url).endsWith(original.videoId) ? new Uint8Array() : new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'audio/mpeg' } });
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
