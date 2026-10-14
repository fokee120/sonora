import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { parseBuffer } from 'music-metadata';
import { readdir } from 'node:fs/promises';
import app from '../src/server/ytmusic/api.js';
import { chromiumBridge } from '../src/server/bridge/ChromiumBridge.js';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { beginDownloadJob, updateDownloadJob } from '../src/server/bridge/DownloadJobs.js';

// Explicit rollback/capture seam, NOT the production direct-download route.
// Retains the complete real Chromium capture regression and scoped progress checks.
app.get('/capture/:videoId', async (req, res) => {
  const controller = new AbortController();
  const requestId = typeof req.query.requestId === 'string' ? req.query.requestId : undefined;
  const cancel = () => { if (!res.writableFinished) { controller.abort(); if (requestId) updateDownloadJob(requestId, 'cancelled'); } };
  res.on('close', cancel);
  try {
    if (requestId) beginDownloadJob(requestId, String(req.query.session));
    const artifact = await chromiumBridge.download(req.params.videoId, controller.signal, 'webm', (phase, position, duration) => {
      if (requestId) updateDownloadJob(requestId, phase, position, duration);
    });
    try {
      if (requestId) updateDownloadJob(requestId, 'transferring');
      res.setHeader('X-Audio-Complete', 'true');
      res.setHeader('X-Audio-Duration', String(artifact.duration));
      res.setHeader('Content-Length', String(artifact.size));
      await pipeline(createReadStream(artifact.path), res, { signal: controller.signal });
    } finally { await artifact.dispose(); }
  } catch (error: any) {
    if (!controller.signal.aborted && !res.headersSent) res.status(error.status ?? 502).json({ details: error.message });
  } finally { res.off('close', cancel); }
});

function wave(seconds = 3): Buffer {
  const rate = 24000, samples = Math.floor(rate * seconds), data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) data.writeInt16LE(Math.round(Math.sin(n * 2 * Math.PI * 440 / rate) * 8000), 44 + n * 2);
  return data;
}
const track = () => randomBytes(8).toString('base64url').slice(0, 11);

test('finite download remains full and seekable during same-client playback replacement and controls; false EOF fails before headers', { timeout: 60000 }, async () => {
  const original = chromium.launchPersistentContext.bind(chromium), previous = process.env.SONORA_ADBLOCK;
  process.env.SONORA_ADBLOCK = 'false';
  chromium.launchPersistentContext = async (profile, options) => {
    const context = await original(profile, options);
    await context.route('https://music.youtube.com/**', async route => {
      if (new URL(route.request().url()).pathname === '/fixture.wav') return route.fulfill({ contentType: 'audio/wav', body: wave() });
      await route.fulfill({ contentType: 'text/html', body: `<video style="display:none"></video><div id="movie_player"></div><script>
        const video=document.querySelector('video'),player=document.querySelector('#movie_player'); let id='';
        player.getVideoData=()=>({video_id:id}); player.loadVideoById=next=>{id=next;video.src='/fixture.wav?v='+next;video.play();};
      </script>` });
    });
    return context;
  };
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const internal = chromiumBridge as any;
  try {
    let first!: () => void;
    const capturing = new Promise<void>(resolve => { first = resolve; });
    const listener = () => first(); chromiumBridge.once('timing', listener);
    const requestId = '11111111-1111-4111-8111-111111111111';
    let headersReturned = false;
    const download = fetch(`${base}/capture/${track()}?session=shared&requestId=${requestId}`).then(response => { headersReturned = true; return response; });
    // Wait for actual download capture, rather than a navigation timing event.
    await capturing;
    while (![...internal.sessions.values()].some((s: any) => s.active?.receivedBytes > 0)) await new Promise(resolve => setTimeout(resolve, 25));
    const statusUrl = `${base}/api/ytmusic/download-status/${requestId}?session=shared`;
    let progress: any;
    for (let i = 0; i < 30; i++) {
      const response = await fetch(statusUrl);
      assert.equal(response.status, 200, 'capture progress available before audio headers');
      progress = await response.json();
      if (progress.progress > 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(headersReturned, false);
    assert.equal(progress.phase, 'recording');
    assert.ok(progress.recordedSeconds > 0 && progress.sourceDuration === 3);
    assert.ok(progress.progress > 0 && progress.progress <= 95);
    const captureSession = [...internal.sessions.entries()].find(([id]: any) => id.startsWith('download-'))![1] as any;
    const captureId = [...internal.sessions.entries()].find(([, s]: any) => s === captureSession)![0];
    await chromiumBridge.pause(captureId);
    await new Promise(resolve => setTimeout(resolve, 300));
    const pausedProgress = (await (await fetch(statusUrl)).json()).progress;
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal((await (await fetch(statusUrl)).json()).progress, pausedProgress, 'source pause does not invent ticking progress');
    await chromiumBridge.resume(captureId);
    assert.equal((await fetch(statusUrl.replace('session=shared', 'session=other'))).status, 404);
    assert.equal((await fetch(statusUrl.replace('session=shared', 'session=sha!red'))).status, 400);
    assert.equal((await fetch(`${base}/capture/${track()}?session=shared&requestId=${requestId}`)).status, 409);
    const playback = new AbortController();
    const stream = await fetch(`${base}/api/ytmusic/stream/${track()}?session=shared`, { signal: playback.signal });
    const reader = stream.body!.getReader(); await reader.read();
    for (const control of ['pause', 'resume']) assert.equal((await fetch(`${base}/api/ytmusic/bridge/${control}?session=shared`, { method: 'POST' })).status, 200);
    await fetch(`${base}/api/ytmusic/bridge/seek?session=shared`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ position: 1 }) });
    playback.abort(); await reader.cancel().catch(() => {});
    const replacement = new AbortController();
    const second = await fetch(`${base}/api/ytmusic/stream/${track()}?session=shared&start=0.5`, { signal: replacement.signal });
    await second.body!.getReader().read(); replacement.abort();
    const response = await download;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-audio-complete'), 'true');
    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = await parseBuffer(bytes, { mimeType: 'audio/webm' }, { duration: true });
    assert.ok(Math.abs(metadata.format.duration! - 3) < 0.4, `full finite tone duration, got ${metadata.format.duration}`);
    assert.ok(Number(response.headers.get('x-audio-duration')) > 2.6);
    assert.equal(Number(response.headers.get('content-length')), bytes.length);
    const offline = await internal.sessions.get('shared').context.newPage();
    try {
      const duration = await offline.evaluate(async (data: number[]) => {
        const media = document.createElement('audio'); document.body.append(media);
        media.src = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'audio/webm' }));
        await new Promise<void>((resolve, reject) => { media.onloadedmetadata = () => resolve(); media.onerror = () => reject(new Error('offline decode failed')); });
        if (!Number.isFinite(media.duration)) throw new Error('offline WebM lacks finite duration');
        media.currentTime = 2.5;
        await new Promise<void>(resolve => { media.onseeked = () => resolve(); });
        if (Math.abs(media.currentTime - 2.5) > 0.1) throw new Error('offline seek failed');
        return media.duration;
      }, [...bytes]);
      assert.ok(Math.abs(duration - 3) < 0.4);
    } finally { await offline.close(); }
    assert.equal([...internal.sessions.keys()].some((id: string) => id.startsWith('download-')), false, 'download profile released');

    const failed = fetch(`${base}/capture/${track()}?session=shared`);
    let session: any;
    while (!(session = [...internal.sessions.entries()].find(([id, s]: any) => id.startsWith('download-') && s.active?.receivedBytes > 0)?.[1])) await new Promise(resolve => setTimeout(resolve, 25));
    await session.page.evaluate(() => document.querySelector('video')!.dispatchEvent(new Event('ended')));
    const partial = await failed;
    assert.equal(partial.status, 502, 'premature ended event is not successful EOF');
    assert.equal(partial.headers.get('x-audio-complete'), null);
    assert.match((await partial.json()).details, /incomplete|duration/i);
    assert.equal([...internal.sessions.keys()].some((id: string) => id.startsWith('download-')), false);
    const cancelled = new AbortController();
    const cancelId = '22222222-2222-4222-8222-222222222222';
    const cancelRequest = fetch(`${base}/capture/${track()}?session=shared&requestId=${cancelId}`, { signal: cancelled.signal });
    const cancelResult = cancelRequest.catch(error => error);
    while (![...internal.sessions.entries()].some(([id, s]: any) => id.startsWith('download-') && s.active?.receivedBytes > 0)) await new Promise(resolve => setTimeout(resolve, 25));
    cancelled.abort();
    assert.equal((await cancelResult).name, 'AbortError');
    while ([...internal.sessions.keys()].some((id: string) => id.startsWith('download-'))) await new Promise(resolve => setTimeout(resolve, 25));
    const cancelStatus = await (await fetch(`${base}/api/ytmusic/download-status/${cancelId}?session=shared`)).json();
    assert.equal(cancelStatus.phase, 'cancelled');
    assert.deepEqual((await readdir('.sonora/downloads')).filter(name => name.startsWith('download-')), []);
  } finally {
    chromium.launchPersistentContext = original;
    await chromiumBridge.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.SONORA_ADBLOCK; else process.env.SONORA_ADBLOCK = previous;
  }
});
