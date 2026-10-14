import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { ChromiumBridge } from '../src/server/bridge/ChromiumBridge.js';

function wave(seconds = 1.6): Buffer {
  const rate = 24000, samples = Math.floor(rate * seconds);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) data.writeInt16LE(Math.round(Math.sin(n * 2 * Math.PI * 440 / rate) * 8000), 44 + n * 2);
  return data;
}
const track = () => randomBytes(8).toString('base64url').slice(0, 11);

test('closing an old context cannot delete a replacement session created during close', async () => {
  const bridge = new ChromiumBridge() as any;
  let release!: () => void;
  const closed = new Promise<void>(resolve => { release = resolve; });
  bridge.sessions.set('same', { context: { close: () => closed } });
  const closing = bridge.closeSession('same');
  const replacement = { marker: 'replacement' };
  bridge.sessions.set('same', replacement);
  release(); await closing;
  assert.equal(bridge.sessions.get('same'), replacement);
});

test('abort while session is launching returns promptly instead of waiting for Chromium', async () => {
  const bridge = new ChromiumBridge();
  (bridge as any).getSession = () => new Promise(() => {});
  const controller = new AbortController();
  const pending = bridge.play('launching', track(), controller.signal).next();
  controller.abort();
  const result = await Promise.race([pending, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('abort blocked behind browser launch')), 150))]);
  assert.equal(result.done, true);
});

// Real Chromium, actual HTML media decoder/capture/MediaRecorder and bridge queues.
// Only the remote YTM origin is replaced. No public catalog IDs or network needed.
test('prepared sessions are single-flight and real finite media ends without reloading on track changes', { timeout: 30000 }, async () => {
  const original = chromium.launchPersistentContext.bind(chromium);
  const previous = process.env.SONORA_ADBLOCK;
  process.env.SONORA_ADBLOCK = 'false';
  const bridge = new ChromiumBridge();
  let launches = 0, navigations = 0;
  chromium.launchPersistentContext = async (profile, options) => {
    launches++;
    const context = await original(profile, options);
    await context.route('https://music.youtube.com/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/fixture.wav') return route.fulfill({ contentType: 'audio/wav', body: wave() });
      navigations++;
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><video style="display:none"></video><div id="movie_player"></div><script>
        const video = document.querySelector('video'), player = document.querySelector('#movie_player');
        let id = new URL(location.href).searchParams.get('v') || '';
        player.getVideoData = () => ({video_id:id});
        player.loadVideoById = next => { id = next; video.src = '/fixture.wav?v=' + encodeURIComponent(next); video.play(); };
        if (id) player.loadVideoById(id);
      </script>` });
    });
    return context;
  };
  const timings: unknown[] = [];
  bridge.on('timing', value => timings.push(value));
  try {
    await Promise.all([bridge.warmup(), bridge.warmup(), bridge.warmup()]);
    assert.equal(launches, 1, 'startup has one clean spare, not one browser per user');
    const spare = await (bridge as any).spareSession;
    assert.equal(bridge.sessionCount, 0, 'unassigned spare is not a user session');
    assert.equal(spare.currentVideoId, null);
    await Promise.all([bridge.prepare('fixture'), bridge.prepare('fixture'), bridge.prepare('fixture')]);
    assert.equal(await (bridge as any).getSession('fixture'), spare, 'prepared profile is transferred intact once');
    await bridge.warmup(); // also waits for background replenishment
    const replenished = await (bridge as any).spareSession;
    assert.notEqual(replenished.context, spare.context);
    await spare.page.evaluate(() => { localStorage.setItem('pool-owner', 'fixture'); document.cookie = 'poolOwner=fixture; Secure; SameSite=Lax'; });
    assert.equal(await replenished.page.evaluate(() => localStorage.getItem('pool-owner')), null);
    assert.equal((await replenished.context.cookies()).some((cookie: any) => cookie.name === 'poolOwner'), false);
    assert.equal(launches, 2);
    assert.equal(navigations, 2);
    assert.equal(await bridge.nowPlaying('fixture'), null, 'prepare must not autoplay/select a song');
    for (let n = 0; n < 2; n++) {
      const started = performance.now();
      let bytes = 0;
      for await (const chunk of bridge.play('fixture', track())) bytes += chunk.length;
      assert.ok(bytes > 1000);
      console.log(`synthetic finite track ${n + 1}: ${bytes} bytes, ${(performance.now() - started).toFixed(1)}ms to EOF`);
    }
    assert.equal(navigations, 2, 'warm track transitions use the existing player');
    // Old abort and old generator finalization cannot kill replacement capture.
    const oldAbort = new AbortController();
    const old = bridge.play('fixture', track(), oldAbort.signal);
    assert.ok((await old.next()).value?.length);
    const fresh = bridge.play('fixture', track());
    assert.ok((await fresh.next()).value?.length);
    await assert.rejects(old.next(), /superseded/, 'replacement must not report successful EOF for the previous capture');
    oldAbort.abort(); await old.return(undefined);
    assert.ok((await fresh.next()).value?.length, 'old abort/finalizer must not stop new recorder');
    await fresh.return(undefined);
    const seeking = bridge.play('fixture', track(), undefined, 'webm', 0.7);
    const seekHeader = (await seeking.next()).value!;
    assert.equal(seekHeader.subarray(0, 4).toString('hex'), '1a45dfa3', 'seek/recovery starts a fresh WebM container');
    const position = (await bridge.nowPlaying('fixture'))!.position;
    assert.ok(position >= 0.65 && position < 1.5, `source position should include initial seek (50ms decoder tolerance), got ${position}`);
    await bridge.pause('fixture');
    assert.equal((await bridge.nowPlaying('fixture'))!.isPlaying, false);
    assert.equal(await (await (bridge as any).getSession('fixture')).page.evaluate(() => (window as any).__sonoraRecorder.state), 'paused', 'pause must stop encoding/buffering while preserving the container');
    await bridge.resume('fixture');
    assert.equal((await bridge.nowPlaying('fixture'))!.isPlaying, true);
    await seeking.return(undefined);
    const switching = bridge.play('fixture', track());
    await switching.next();
    const currentSession = await (bridge as any).getSession('fixture');
    await currentSession.page.evaluate(() => { document.querySelector('video')!.src = '/fixture.wav?changed=1'; });
    await assert.rejects(async () => { for await (const _chunk of switching) { /* drain until explicit error */ } }, /source_changed|stopped/);
    await assert.rejects(bridge.play('fixture', track(), undefined, 'webm', 9).next(), /start position.*duration/i);
    // Already aborted calls must not navigate, capture, or create another profile.
    const aborted = new AbortController(); aborted.abort();
    assert.equal((await bridge.play('unused', track(), aborted.signal).next()).done, true);
    assert.equal(launches, 2);
    // Cancellation while a browser await is in flight must not start an orphan recorder.
    const internal = bridge as any;
    const originalCapture = internal.ensureCapture.bind(bridge);
    let entered!: () => void, release!: () => void;
    const captureEntered = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    internal.ensureCapture = async (...args: unknown[]) => { entered(); await gate; return originalCapture(...args); };
    const startupAbort = new AbortController();
    const cancelled = bridge.play('fixture', track(), startupAbort.signal);
    const waiting = cancelled.next();
    await captureEntered;
    startupAbort.abort();
    assert.equal((await waiting).done, true);
    release();
    const session = await internal.getSession('fixture');
    await session.setup.catch(() => {});
    const orphan = await session.page.evaluate(() => ({ recording: (window as any).__sonoraRecording, paused: document.querySelector('video')?.paused }));
    assert.equal(orphan.recording, false, 'cancelled startup must not leave capture running');
    assert.equal(orphan.paused, true, 'cancelled startup must pause hidden player');
    internal.ensureCapture = originalCapture;
    console.log('bridge fixture timings:', JSON.stringify(timings));
  } finally {
    chromium.launchPersistentContext = original;
    await bridge.close();
    if (previous === undefined) delete process.env.SONORA_ADBLOCK; else process.env.SONORA_ADBLOCK = previous;
  }
});
