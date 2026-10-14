import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
const track = { id: 'ytm:abc-def_123', source: 'ytmusic', sourceId: 'abc-def_123', cloudKey: 'ytmusic://abc-def_123', title: 'Test', artist: 'Artist', album: 'Test', duration: 180, format: 'webm' };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: { user: null, authRequired: false, tracks: [], albums: [], artists: [] } }));
  await page.addInitScript(() => {
    const audios: any[] = [];
    (window as any).__audios = audios;
    class ControlledAudio extends EventTarget {
      src = ''; currentTime = 0; duration = Infinity; volume = 1; playbackRate = 1; preload = ''; paused = true; error: any = null;
      buffered = { length: 1, end: () => 6 };
      resolve!: () => void; reject!: (e: Error) => void;
      constructor() { super(); audios.push(this); }
      play() { this.paused = false; this.dispatchEvent(new Event('play')); return new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
      pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
      removeAttribute() { this.src = ''; }
      load() {}
    }
    (window as any).Audio = ControlledAudio;
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});

test('old media events and rejected play cannot damage a rapid replacement', async ({ page }) => {
  const result = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const { playerEngine: engine } = await import(path);
    void engine.playTrack(track as any);
    await Promise.resolve();
    const old = (window as any).__audios.at(-1);
    void engine.playTrack({ ...track, id: 'ytm:def-abc_123', sourceId: 'def-abc_123' } as any);
    await Promise.resolve();
    old.dispatchEvent(new Event('playing'));
    old.dispatchEvent(new Event('ended'));
    old.dispatchEvent(new Event('error'));
    old.reject(new DOMException('Interrupted', 'AbortError'));
    await Promise.resolve();
    return engine.getState();
  }, track);
  expect(result.currentTrack?.id).toBe('ytm:def-abc_123');
  expect(result.error).toBeNull();
  expect(result.isLoading).toBe(true);
  expect(result.isPlaying).toBe(false);
});

test('live seek replaces capture and maps local time without rewriting song duration', async ({ page }) => {
  const result = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const { playerEngine: engine } = await import(path);
    void engine.playTrack(track as any);
    await Promise.resolve();
    (window as any).__audios.at(-1).dispatchEvent(new Event('playing'));
    engine.seek(60);
    await Promise.resolve();
    const audio = (window as any).__audios.at(-1);
    const src = audio.src;
    audio.currentTime = 3;
    audio.duration = 8;
    audio.dispatchEvent(new Event('timeupdate'));
    audio.dispatchEvent(new Event('durationchange'));
    audio.dispatchEvent(new Event('progress'));
    return { src, state: engine.getState() };
  }, track);
  expect(result.src).toContain('start=60');
  expect(result.state.currentTime).toBe(63);
  expect(result.state.bufferedTime).toBe(66);
  expect(result.state.duration).toBe(180);
  expect(result.state.currentTrack?.duration).toBe(180);
});

test('paused live seek does not start a capture or autoplay', async ({ page }) => {
  const result = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const { playerEngine: engine } = await import(path);
    void engine.playTrack(track as any);
    await Promise.resolve();
    engine.pause();
    const count = (window as any).__audios.length;
    engine.seek(90);
    return { count, after: (window as any).__audios.length, state: engine.getState() };
  }, track);
  expect(result.after).toBe(result.count);
  expect(result.state.isLoading).toBe(false);
  expect(result.state.isPlaying).toBe(false);
  expect(result.state.currentTime).toBe(90);
});

test('a stalled startup exits loading with a retryable visible error', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    void (await import(path)).playerEngine.playTrack(track);
  }, track);
  await page.clock.fastForward(30_001);
  const result = await page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    return (await import(path)).playerEngine.getState();
  });
  expect(result.isLoading).toBe(false);
  expect(result.isPlaying).toBe(false);
  expect(result.error).toContain('timed out');
  await expect(page.getByRole('alert')).toContainText('timed out');
});

test('only one network recovery retains position and decode failure is terminal', async ({ page }) => {
  const result = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const engine = (await import(path)).playerEngine;
    void engine.playTrack(track);
    await Promise.resolve();
    let audio = (window as any).__audios.at(-1);
    audio.dispatchEvent(new Event('playing'));
    audio.currentTime = 12;
    audio.dispatchEvent(new Event('timeupdate'));
    audio.error = { code: 2 };
    audio.dispatchEvent(new Event('error'));
    await Promise.resolve();
    audio = (window as any).__audios.at(-1);
    const recoverySrc = audio.src;
    audio.error = { code: 2 };
    audio.dispatchEvent(new Event('error'));
    await Promise.resolve();
    return { recoverySrc, state: engine.getState() };
  }, track);
  expect(result.recoverySrc).toContain('start=12');
  expect(result.state.isLoading).toBe(false);
  expect(result.state.error).toBeTruthy();
});

test('paused loading never resumes from a late playing event', async ({ page }) => {
  const result = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const engine = (await import(path)).playerEngine;
    void engine.playTrack(track);
    await Promise.resolve();
    engine.pause();
    const audio = (window as any).__audios.at(-1);
    audio.dispatchEvent(new Event('playing'));
    audio.resolve();
    await Promise.resolve();
    return { paused: audio.paused, state: engine.getState() };
  }, track);
  expect(result.paused).toBe(true);
  expect(result.state.isPlaying).toBe(false);
});

test('prepare is deduplicated and never assigns an audio stream', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/src/lib/audio/audioSource.ts';
    const source = await import(path);
    const before = (window as any).__audios.map((audio: any) => audio.src);
    let requests = 0;
    let headers: any;
    const original = window.fetch;
    window.fetch = (async (_input: any, init: any) => {
      requests++;
      headers = init.headers;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      await Promise.all([source.prepareYoutubeBridge(), source.prepareYoutubeBridge(), source.prepareYoutubeBridge()]);
      await source.prepareYoutubeBridge();
      return { requests, headers, session: source.getBridgeSessionId(), before, after: (window as any).__audios.map((audio: any) => audio.src) };
    } finally { window.fetch = original; }
  });
  expect(result.requests).toBe(1);
  expect(result.headers['X-Session-Id']).toBe(result.session);
  expect(result.after).toEqual(result.before);
});

test('buffering remains cancellable from the player controls', async ({ page }) => {
  await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    void (await import(path)).playerEngine.playTrack(track);
  }, track);
  const cancel = page.locator('#bottom-player-bar').getByRole('button', { name: 'Cancel loading' });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  const result = await page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    return (await import(path)).playerEngine.getState();
  });
  expect(result.isLoading).toBe(false);
  expect(result.isPlaying).toBe(false);
});

test('decode errors do not retry and natural end clears playing at queue end', async ({ page }) => {
  const result = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const engine = (await import(path)).playerEngine;
    void engine.playTrack(track);
    await Promise.resolve();
    let audio = (window as any).__audios.at(-1);
    const count = (window as any).__audios.length;
    audio.error = { code: 3 };
    audio.dispatchEvent(new Event('error'));
    const error = engine.getState();
    const after = (window as any).__audios.length;
    void engine.playTrack(track);
    await Promise.resolve();
    audio = (window as any).__audios.at(-1);
    audio.dispatchEvent(new Event('playing'));
    audio.dispatchEvent(new Event('ended'));
    return { count, after, error, ended: engine.getState() };
  }, track);
  expect(result.after).toBe(result.count);
  expect(result.error.error).toBeTruthy();
  expect(result.error.isLoading).toBe(false);
  expect(result.ended.isPlaying).toBe(false);
  expect(result.ended.isLoading).toBe(false);
});

test('cancelled startup can resume at the deferred seek without stale abort errors', async ({ page }) => {
  const result = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const engine = (await import(path)).playerEngine;
    void engine.playTrack(track);
    await Promise.resolve();
    const old = (window as any).__audios.at(-1);
    engine.pause();
    old.reject(new DOMException('User paused', 'AbortError'));
    await Promise.resolve();
    const cancelled = engine.getState();
    engine.seek(45);
    void engine.play();
    await Promise.resolve();
    return { cancelled, src: (window as any).__audios.at(-1).src, state: engine.getState() };
  }, track);
  expect(result.cancelled.error).toBeNull();
  expect(result.src).toContain('start=45');
  expect(result.state.isLoading).toBe(true);
});

test('native source retry uses native seek, not live-capture timeline offsets', async ({ page }) => {
  const result = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const engine = (await import(path)).playerEngine;
    const native = { ...track, id: 'gdrive:file', source: undefined, sourceId: undefined, cloudKey: 'gdrive://file' };
    const authPath = '/src/lib/googleAuth.ts';
    await (await import(authPath)).auth.authStateReady();
    localStorage.setItem('gdrive_access_token', 'test-only-token');
    const original = window.fetch;
    window.fetch = (async () => new Response(new Blob(['audio']))) as typeof fetch;
    try {
      void engine.playTrack(native);
      await new Promise(resolve => setTimeout(resolve, 10));
      let audio = (window as any).__audios.at(-1);
      audio.duration = 180;
      audio.dispatchEvent(new Event('loadedmetadata'));
      audio.dispatchEvent(new Event('playing'));
      audio.currentTime = 40;
      audio.dispatchEvent(new Event('timeupdate'));
      audio.error = { code: 3 };
      audio.dispatchEvent(new Event('error'));
      void engine.play();
      await new Promise(resolve => setTimeout(resolve, 10));
      audio = (window as any).__audios.at(-1);
      audio.duration = 180;
      audio.dispatchEvent(new Event('loadedmetadata'));
      const seeked = audio.currentTime;
      audio.currentTime = 41;
      audio.dispatchEvent(new Event('timeupdate'));
      return { seeked, state: engine.getState() };
    } finally { window.fetch = original; }
  }, track);
  expect(result.seeked).toBe(40);
  expect(result.state.currentTime).toBe(41);
});

test('playing a queued song updates the next-song cursor', async ({ page }) => {
  const selected = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const engine = (await import(path)).playerEngine;
    const second = { ...track, id: 'ytm:def-abc_123', sourceId: 'def-abc_123' };
    const third = { ...track, id: 'ytm:ghi-abc_123', sourceId: 'ghi-abc_123' };
    engine.setQueue([track, second, third], track);
    void engine.playTrack(second);
    engine.next();
    return engine.getState().currentTrack.id;
  }, track);
  expect(selected).toBe('ytm:ghi-abc_123');
});

test('seek control supports keyboard navigation on the live song timeline', async ({ page }) => {
  await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const engine = (await import(path)).playerEngine;
    void engine.playTrack(track);
    await Promise.resolve();
    (window as any).__audios.at(-1).dispatchEvent(new Event('playing'));
  }, track);
  const slider = page.locator('#bottom-player-bar').getByRole('slider', { name: 'Seek' });
  await slider.focus();
  await slider.press('ArrowRight');
  const src = await page.evaluate(() => (window as any).__audios.at(-1).src);
  expect(src).toContain('start=5');
});

test('loading remains honest through play and metadata until playing', async ({ page }) => {
  const state = await page.evaluate(async track => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const { playerEngine: engine } = await import(path);
    void engine.playTrack(track as any);
    await Promise.resolve();
    const audio = (window as any).__audios.at(-1);
    audio.dispatchEvent(new Event('loadedmetadata'));
    return engine.getState();
  }, track);
  expect(state.isLoading).toBe(true);
  expect(state.isPlaying).toBe(false);
  const playing = await page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    const { playerEngine: engine } = await import(path);
    (window as any).__audios.at(-1).dispatchEvent(new Event('playing'));
    return engine.getState();
  });
  expect(playing.isLoading).toBe(false);
  expect(playing.isPlaying).toBe(true);
});
