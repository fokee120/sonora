/**
 * ChromiumBridge — hidden YouTube Music player (multi-user)
 *
 * Runs the REAL music.youtube.com in headless Chromium, controlled via
 * Playwright. Each user session gets its own isolated BrowserContext,
 * so multiple people can play different songs simultaneously without
 * interfering with each other.
 *
 * Audio is captured directly from each page's media element
 * (captureStream + MediaRecorder), so there's no dependency on system audio.
 *
 * Why this doesn't break: it's the genuine web client. BotGuard mints PO
 * tokens natively, the real player speaks SABR, n-sig is solved by YouTube's
 * own JS. No spoofed clients, no token providers, no version pinning.
 *
 * The user never sees Chromium. Sonora's UI is the only interface.
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AudioStream } from './AudioStream.js';
import { randomUUID } from 'node:crypto';
import { finalizeDownload, type CaptureReceipt, type DownloadArtifact } from './DownloadArtifact.js';

// In-page capture script: finds the media element, captures its stream,
// encodes via MediaRecorder, and sends chunks back to Node.
const CAPTURE_SCRIPT = `
(() => {
  if (window.__sonoraCapture) return;
  window.__sonoraCapture = true;
  window.__sonoraRecording = false;
  window.__sonoraStopCapture = (generation) => {
    const recorder = window.__sonoraRecorder;
    if (generation !== undefined && recorder?.generation !== generation) return;
    window.__sonoraRecorder = null;
    window.__sonoraRecording = false;
    try { if (recorder?.state !== 'inactive') recorder?.stop(); } catch {}
    recorder?.cleanup?.();
  };
  window.__sonoraStartCapture = (generation = 0) => {
    window.__sonoraStopCapture();
    const media = document.querySelector('video');
    if (!media) { window.__sonoraCaptureError = 'no media element found'; return false; }
    try {
      const stream = media.captureStream();
      const tracks = stream.getAudioTracks();
      if (!tracks.length) throw new Error('no audio tracks in captured stream');
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, audioBitsPerSecond: 128000 });
      recorder.generation = generation;
      window.__sonoraMimeType = mimeType;
      window.__sonoraCaptureBytes = 0;
      let delivery = Promise.resolve();
      let finishing = false;
      const source = media.currentSrc;
      const srcObject = media.srcObject;
      const active = () => window.__sonoraRecorder === recorder;
      const finish = (reason) => {
        if (finishing || !active()) return;
        finishing = true;
        recorder.reason = reason;
        recorder.endPosition = media.currentTime;
        recorder.endDuration = media.duration;
        try { recorder.stop(); } catch {}
      };
      const ended = () => finish('ended');
      const changed = () => { if (media.currentSrc !== source || media.srcObject !== srcObject) finish('source_changed'); };
      const emptied = () => finish('source_changed');
      media.addEventListener('ended', ended);
      media.addEventListener('loadedmetadata', changed);
      media.addEventListener('emptied', emptied);
      const monitor = setInterval(() => {
        if (document.querySelector('video') !== media) finish('source_changed');
        else changed();
      }, 250);
      recorder.cleanup = () => {
        clearInterval(monitor);
        media.removeEventListener('ended', ended);
        media.removeEventListener('loadedmetadata', changed);
        media.removeEventListener('emptied', emptied);
        // captureStream may return the original srcObject tracks. Stopping them
        // would kill the player itself and make replacement capture impossible.
      };
      recorder.ondataavailable = (event) => {
        if (!event.data?.size || !active()) return;
        const position = media.currentTime, duration = media.duration;
        delivery = delivery.then(async () => {
          if (!active()) return;
          const bytes = Array.from(new Uint8Array(await event.data.arrayBuffer()));
          await window.__sonoraSendChunk(bytes, generation, position, duration);
          if (active()) window.__sonoraCaptureBytes += bytes.length;
        }).catch(() => finish('delivery_failed'));
      };
      recorder.onstop = () => {
        recorder.cleanup();
        if (!active()) return;
        window.__sonoraRecording = false;
        delivery.then(() => window.__sonoraCaptureEnded?.(generation, recorder.reason || 'recorder_stopped', recorder.endPosition, recorder.endDuration));
      };
      recorder.onerror = () => finish('recorder_error');
      window.__sonoraRecorder = recorder;
      recorder.start(200);
      window.__sonoraRecording = true;
      window.__sonoraCaptureError = null;
      return true;
    } catch (error) {
      window.__sonoraCaptureError = String(error?.message || error);
      return false;
    }
  };
})();
`;

export interface NowPlaying {
  videoId: string;
  title: string;
  artist: string;
  artwork: string | null;
  duration: number;
  position: number;
  isPlaying: boolean;
}

interface Session {
  context: BrowserContext;
  page: Page;
  currentVideoId: string | null;
  lastActive: number;
  generation: number;
  active?: AudioStream;
  setup: Promise<void>;
}

const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
const MAX_SESSIONS = 10;
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 min

export class ChromiumBridge extends EventEmitter {
  private extensionDir: string | null = null;
  private sessions = new Map<string, Session>();
  private pendingSessions = new Map<string, Promise<Session>>();
  private initPromise: Promise<void> | null = null;
  private ffmpegAvailable: boolean | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  // One anonymous, never-used profile. Ownership transfers once; never recycle user profiles.
  private spareSession: Promise<Session> | null = null;
  private warmupEnabled = false;
  private closed = false;

  /** Validate configuration once; each session launches its own temporary profile. */
  async ensureReady(): Promise<void> {
    if (this.closed) throw new Error('Chromium bridge is closed');
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init().catch(error => {
      this.initPromise = null;
      throw error;
    });
    return this.initPromise;
  }

  private async init(): Promise<void> {
    if (process.env.SONORA_ADBLOCK !== 'false') {
      const extensionDir = resolve(process.env.SONORA_ADBLOCK_EXTENSION_DIR || '.sonora/extensions/ublock-origin-lite');
      try {
        const manifest = JSON.parse(await readFile(resolve(extensionDir, 'manifest.json'), 'utf8'));
        if (manifest.manifest_version !== 3 || !manifest.background?.service_worker) {
          throw new Error('Expected a Manifest V3 extension with a background service worker');
        }
        this.extensionDir = extensionDir;
      } catch (cause) {
        throw new Error(`Sonora adblock extension manifest unavailable or invalid at ${extensionDir}. Install uBlock Origin Lite there, set SONORA_ADBLOCK_EXTENSION_DIR, or explicitly set SONORA_ADBLOCK=false to disable protection.`, { cause });
      }
    }
    // Periodic cleanup of idle sessions
    this.cleanupTimer = setInterval(() => this.cleanupIdleSessions(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  /** Configure the installed uBOL API from a trusted extension page, not YTM. */
  private async initializeAdblock(context: BrowserContext): Promise<void> {
    let setupPage: Page | undefined;
    try {
      const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'))
        || await context.waitForEvent('serviceworker', { timeout: 15000 });
      // URL.origin is "null" for chrome-extension in Node, so retain the host explicitly.
      const extensionURL = `chrome-extension://${new URL(worker.url()).host}`;
      setupPage = await context.newPage();
      await setupPage.goto(`${extensionURL}/dashboard.html`, { waitUntil: 'domcontentloaded' });
      await setupPage.waitForFunction(async () => {
        try {
          const chrome = (globalThis as any).chrome;
          return typeof await chrome.runtime.sendMessage({ what: 'getFilteringMode', hostname: 'music.youtube.com' }) === 'number';
        } catch { return false; }
      }, undefined, { timeout: 20000 });
      const state = await setupPage.evaluate(async () => {
        const chrome = (globalThis as any).chrome;
        // Official 2026.1012.1545 manifest already grants <all_urls> at install.
        // Do not silently degrade if a future/custom package lacks that permission.
        if (!await chrome.permissions.contains({ origins: ['<all_urls>'] })) {
          throw new Error('uBOL requires its declared <all_urls> host permission for Complete filtering');
        }
        await chrome.runtime.sendMessage({ what: 'setFilteringMode', hostname: 'youtube.com', level: 3 });
        const level = await chrome.runtime.sendMessage({ what: 'getFilteringMode', hostname: 'music.youtube.com' });
        const rulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
        const scripts = await chrome.scripting.getRegisteredContentScripts();
        return { level, rulesets, scripts: scripts.length };
      });
      if (state.level !== 3 || state.rulesets.length === 0 || state.scripts === 0) {
        throw new Error(`uBOL protection not ready: ${JSON.stringify(state)}`);
      }
    } catch (cause) {
      throw new Error('Sonora adblock initialization failed; refusing to open YouTube Music unprotected. Set SONORA_ADBLOCK=false only for explicit opt-out.', { cause });
    } finally {
      await setupPage?.close().catch(() => {});
    }
  }

  /** Session creation is single-flight, including browser + extension initialization. */
  private async getSession(sessionId: string, initialVideoId?: string): Promise<Session> {
    await this.ensureReady();
    const existing = this.sessions.get(sessionId);
    if (existing) { existing.lastActive = Date.now(); return existing; }
    const pending = this.pendingSessions.get(sessionId);
    if (pending) return pending;
    if (this.closed) throw new Error('Chromium bridge is closed');
    if (this.sessions.size + this.pendingSessions.size >= MAX_SESSIONS) {
      throw new Error('Chromium session capacity reached; retry later');
    }
    // Claim even an in-flight spare atomically before yielding. Its cookies/profile
    // now belong exclusively to this session, and can never return to the pool.
    const spare = this.spareSession;
    this.spareSession = null;
    const creation = (spare || this.createSession(sessionId)).then(async session => {
      if (this.closed) {
        await session.context.close().catch(() => {});
        throw new Error('Chromium bridge is closed');
      }
      session.lastActive = Date.now();
      this.sessions.set(sessionId, session);
      if (spare) this.timing('spare-adopted', Date.now(), { sessionId });
      return session;
    });
    this.pendingSessions.set(sessionId, creation);
    try { return await creation; }
    finally {
      this.pendingSessions.delete(sessionId);
      this.replenishSpare();
    }
  }

  /** Explicit startup hook: one bounded clean home/player session, no song selected.
   * Await for startup readiness, or catch rejection when invoking in background.
   * Subsequent calls share the same preparation. At capacity this is a no-op. */
  async warmup(): Promise<void> {
    await this.ensureReady();
    if (this.closed) throw new Error('Chromium bridge is closed');
    this.warmupEnabled = true;
    if (!this.spareSession) {
      if (this.sessions.size + this.pendingSessions.size >= MAX_SESSIONS) return;
      const preparation = this.createSession('unassigned-spare').then(async session => {
        if (this.closed) {
          await session.context.close().catch(() => {});
          throw new Error('Chromium bridge is closed');
        }
        return session;
      });
      this.spareSession = preparation;
      preparation.catch(() => {
        if (this.spareSession === preparation) this.spareSession = null;
      });
    }
    await this.spareSession;
  }

  private replenishSpare(): void {
    if (!this.warmupEnabled || this.closed) return;
    void this.warmup().catch(error => {
      if (!this.closed) console.warn('[bridge] Spare warmup failed:', error.message);
    });
  }

  /** Warm browser, uBOL and the application, without selecting or playing a track. */
  async prepare(sessionId: string): Promise<void> {
    const started = Date.now();
    await this.waitForSession(sessionId);
    this.timing('prepared', started, { sessionId });
  }

  private async waitForSession(sessionId: string, videoId?: string, signal?: AbortSignal): Promise<Session | undefined> {
    if (signal?.aborted) return;
    let cancelWait: (() => void) | undefined;
    let timeout: NodeJS.Timeout | undefined;
    const cancelled = new Promise<undefined>((resolve, reject) => {
      cancelWait = () => resolve(undefined);
      signal?.addEventListener('abort', cancelWait, { once: true });
      timeout = setTimeout(() => reject(new Error('Chromium session startup timed out (35s)')), 35000);
      timeout.unref();
    });
    try { return await Promise.race([this.getSession(sessionId, videoId), cancelled]); }
    finally {
      if (cancelWait) signal?.removeEventListener('abort', cancelWait);
      clearTimeout(timeout);
    }
  }

  private timing(stage: string, started: number, extra: Record<string, unknown>): void {
    const diagnostic = { stage, elapsedMs: Date.now() - started, ...extra };
    this.emit('timing', diagnostic);
    if (process.env.SONORA_DEBUG_PERF === 'true') console.log('[bridge]', JSON.stringify(diagnostic));
  }

  private async createSession(sessionId: string): Promise<Session> {
    const started = Date.now();
    // Empty userDataDir asks Playwright for a unique temporary profile.
    // Extensions require a persistent context, but no personal profile is used.
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--mute-audio',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--window-position=-32000,-32000',
        ...(this.extensionDir ? [
          `--disable-extensions-except=${this.extensionDir}`,
          `--load-extension=${this.extensionDir}`,
        ] : []),
      ],
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    try {
      if (this.extensionDir) await this.initializeAdblock(context);
      const page = context.pages()[0] || await context.newPage();
      const session: Session = {
        context, page, currentVideoId: null,
        lastActive: Date.now(), generation: 0, setup: Promise.resolve(),
      };
      await page.exposeFunction('__sonoraSendChunk', (bytes: number[], generation: number, position: number, duration: number) => {
        const stream = session.active;
        if (!stream || stream.generation !== generation) return;
        stream.push(Buffer.from(bytes));
        if (!stream.ended && Number.isFinite(position) && Number.isFinite(duration) && duration > 0) stream.onRecorded?.(position, duration);
        session.lastActive = Date.now();
      });
      await page.exposeFunction('__sonoraCaptureEnded', (generation: number, reason: string, position: number, duration: number) => {
        if (session.active?.generation !== generation) return;
        session.active.naturalEnd = reason === 'ended' && Number.isFinite(duration) && duration > 0 && position >= duration - 0.25;
        session.active.end(reason === 'ended' ? undefined : new Error(`Audio capture ${reason}; reconnect with start=<position>`));
      });
      await page.addInitScript(CAPTURE_SCRIPT);
      this.timing('browser-and-adblock', started, { sessionId });
      // Live evidence: cold watch navigation spends ~15s loading, whereas the
      // empty home shell prepares in ~5s. Load home then use the real player API.
      await page.goto('https://music.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForFunction(() => {
        const player = document.querySelector('#movie_player') as any;
        return typeof player?.loadVideoById === 'function';
      }, undefined, { timeout: 12000 });
      this.timing('application-loaded', started, { sessionId });
      return session;
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.active?.end(new Error('Audio session closed before completion'));
    this.sessions.delete(sessionId);
    await session.context.close().catch(() => {});
  }

  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActive > SESSION_IDLE_TIMEOUT_MS) {
        this.closeSession(id).then(() => this.replenishSpare()).catch(() => {});
      }
    }
  }

  /**
   * Check if ffmpeg is available for MP3 transcoding.
   * iOS Safari/PWA cannot play WebM/Opus — it needs MP3.
   */
  private async checkFfmpeg(): Promise<boolean> {
    if (this.ffmpegAvailable !== null) return this.ffmpegAvailable;
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', ['-version']);
      proc.on('error', () => { this.ffmpegAvailable = false; resolve(false); });
      proc.on('exit', (code) => { this.ffmpegAvailable = code === 0; resolve(code === 0); });
      setTimeout(() => {
        if (this.ffmpegAvailable === null) {
          this.ffmpegAvailable = false; proc.kill(); resolve(false);
        }
      }, 3000);
    });
  }

  /**
   * Transcode WebM/Opus chunks to MP3 on the fly via ffmpeg.
   * Used when the client needs MP3 (iOS Safari/PWA).
   */
  private async *transcodeToMp3(
    chunks: AsyncGenerator<Buffer>,
    signal?: AbortSignal,
    cancelSource?: () => void,
  ): AsyncGenerator<Buffer> {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-f', 'mp3', '-acodec', 'libmp3lame', '-ab', '128k', '-ar', '44100', 'pipe:1',
    ]);
    let stderr = '';
    let sourceError: unknown;
    let processError: Error | undefined;
    ffmpeg.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4096); });
    const exited = new Promise<number | null>(resolve => {
      ffmpeg.on('error', error => { processError = error; cancelSource?.(); resolve(null); });
      ffmpeg.on('close', code => { cancelSource?.(); resolve(code); });
    });
    const abort = () => { ffmpeg.kill('SIGKILL'); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const input = pipeline(Readable.from(chunks, { highWaterMark: 1 }), ffmpeg.stdin).catch(error => {
      sourceError = error;
      ffmpeg.kill('SIGKILL');
    });
    try {
      for await (const chunk of ffmpeg.stdout) {
        if (signal?.aborted) return;
        yield chunk as Buffer;
      }
      await input;
      const code = await exited;
      if (signal?.aborted) return;
      if (sourceError) throw sourceError;
      if (processError) throw processError;
      if (code !== 0) throw new Error(`MP3 transcoding failed (${code}): ${stderr}`);
    } finally {
      signal?.removeEventListener('abort', abort);
      ffmpeg.kill('SIGKILL');
    }
  }

  /**
   * Play a song by video ID in a user's isolated session.
   * Multiple sessions play independently — no interference.
   */
  async *play(
    sessionId: string,
    videoId: string,
    signal?: AbortSignal,
    format: 'webm' | 'mp3' = 'webm',
    initialPosition = 0
  ): AsyncGenerator<Buffer> {
    if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID');
    if (!Number.isFinite(initialPosition) || initialPosition < 0) throw new Error('Invalid start position');
    if (signal?.aborted) return;
    const useMp3 = format === 'mp3';
    if (useMp3 && !await this.checkFfmpeg()) throw new Error('MP3 playback requires ffmpeg; no WebM fallback is safe for this client');
    const sourceController = new AbortController();
    const sourceSignal = signal ? AbortSignal.any([signal, sourceController.signal]) : sourceController.signal;
    const rawChunks = this.playRaw(sessionId, videoId, sourceSignal, initialPosition);
    try {
      if (useMp3) yield* this.transcodeToMp3(rawChunks, signal, () => sourceController.abort());
      else yield* rawChunks;
    } finally {
      sourceController.abort();
      await rawChunks.return(undefined);
    }
  }

  /** Start once and wait for acknowledged bytes, not a recorder boolean or fixed sleep. */
  private async ensureCapture(page: Page, generation = 0, stream?: AudioStream): Promise<void> {
    const checkGeneration = () => { if (stream?.ended) throw new Error('Audio capture generation cancelled'); };
    checkGeneration();
    await page.waitForSelector('video', { state: 'attached', timeout: 12000 });
    checkGeneration();
    await page.evaluate(() => {
      const media = document.querySelector('video')!;
      (window as any).__sonoraPlayError = null;
      if (media.paused) void media.play().catch(error => { (window as any).__sonoraPlayError = String(error); });
    });
    checkGeneration();
    await page.waitForFunction(() => {
      const media = document.querySelector('video');
      if ((window as any).__sonoraPlayError) throw new Error((window as any).__sonoraPlayError);
      return media && media.readyState >= 2 && !media.paused;
    }, undefined, { timeout: 12000 });
    checkGeneration();
    const ok = await page.evaluate(gen => (window as any).__sonoraStartCapture(gen), generation);
    if (!ok) throw new Error(`Audio capture failed: ${await page.evaluate(() => (window as any).__sonoraCaptureError)}`);
    if (stream) {
      await stream.waitForBytes();
      return;
    }
    await page.waitForFunction(gen => {
      const w = window as any;
      return w.__sonoraRecorder?.generation === gen && w.__sonoraCaptureBytes > 0;
    }, generation, { timeout: 8000, polling: 25 });
  }

  private async selectTrack(page: Page, videoId: string): Promise<void> {
    const reused = await page.evaluate(id => {
      const player = document.querySelector('#movie_player') as any;
      if (!player?.loadVideoById) return false;
      player.loadVideoById(id);
      return true;
    }, videoId).catch(() => false);
    if (reused) {
      try {
        await page.waitForFunction(id => {
          const player = document.querySelector('#movie_player') as any;
          return player?.getVideoData?.().video_id === id;
        }, videoId, { timeout: 5000 });
        return;
      } catch { /* Unsupported internal API: bounded document navigation fallback. */ }
    }
    await page.goto(`https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      waitUntil: 'domcontentloaded', timeout: 20000,
    });
  }

  private async *playRaw(
    sessionId: string, videoId: string, signal?: AbortSignal, initialPosition = 0, receipt?: CaptureReceipt,
  ): AsyncGenerator<Buffer> {
    const started = Date.now();
    const session = await this.waitForSession(sessionId, videoId, signal);
    if (!session || signal?.aborted) return;
    const page = session.page;
    session.active?.end(Object.assign(new Error('Audio capture superseded by a new stream'),{code:'AUDIO_STREAM_SUPERSEDED'}));
    const stream = new AudioStream(++session.generation);
    session.active = stream;
    stream.onRecorded = receipt?.onRecorded;
    const current = () => session.active === stream && !stream.ended;
    const abort = () => stream.end();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    // Serialize page mutation; superseded setups may finish awaiting Playwright but
    // must never start a recorder or stop the replacement's recorder.
    const setup = session.setup.catch(() => {}).then(async () => {
      if (!current()) return;
      await page.evaluate(() => {
        (window as any).__sonoraStopCapture?.();
        document.querySelector('video')?.pause();
      });
      if (!current()) return;
      if (session.currentVideoId !== videoId) {
        await this.selectTrack(page, videoId);
        if (!current()) return;
        session.currentVideoId = videoId;
      }
      await page.waitForSelector('video', { state: 'attached', timeout: 12000 });
      await page.waitForFunction(() => {
        const media = document.querySelector('video');
        const player = document.querySelector('#movie_player');
        return media && media.readyState >= 1 && !player?.classList.contains('ad-showing');
      }, undefined, { timeout: 15000 });
      if (!current()) return;
      await page.evaluate(position => {
        const media = document.querySelector('video')!;
        if (Number.isFinite(media.duration) && position >= media.duration) {
          throw new Error('Start position exceeds track duration');
        }
        media.currentTime = position;
      }, initialPosition);
      await page.waitForFunction(position => {
        const media = document.querySelector('video');
        return media && !media.seeking && Math.abs(media.currentTime - position) < 0.25;
      }, initialPosition, { timeout: 5000, polling: 25 });
      if (!current()) return;
      if (receipt) receipt.expectedDuration = await page.evaluate(() => document.querySelector('video')!.duration);
      await this.ensureCapture(page, stream.generation, stream);
      this.timing('capture-first-byte', started, { sessionId, videoId, generation: stream.generation, initialPosition });
    });
    session.setup = setup.finally(async () => {
      if (current()) return;
      // An abort can finish the generator while ensureCapture is still awaiting
      // Chromium. Clean up again after that await, before the next setup runs.
      await page.evaluate(gen => {
        const w = window as any;
        if (w.__sonoraRecorder && w.__sonoraRecorder.generation !== gen) return;
        w.__sonoraStopCapture(gen);
        document.querySelector('video')?.pause();
      }, stream.generation).catch(() => {});
    });
    session.setup.catch(() => {});
    // A failed/stalled capture terminates this container. Never append a restarted
    // recorder's EBML header to an existing HTTP response.
    let checking = false;
    const watchdog = setInterval(async () => {
      if (!current() || checking) return;
      checking = true;
      try {
        const state = await page.evaluate(() => {
          const media = document.querySelector('video');
          return { paused: media?.paused, ended: media?.ended, recording: (window as any).__sonoraRecording };
        });
        if (!current()) return;
        if (state.ended && Date.now() - stream.lastChunkAt > 3000) stream.end(new Error('Audio end notification lost'));
        else if (!state.ended && stream.receivedBytes > 0 && !state.recording) stream.end(new Error('Audio capture stopped; reconnect with start=<position>'));
        else if (!state.paused && Date.now() - stream.lastChunkAt > 10000) stream.end(new Error('Audio capture stalled; reconnect with start=<position>'));
      } catch { if (current()) stream.end(new Error('Audio capture document lost; reconnect with start=<position>')); }
      finally { checking = false; }
    }, 1000);
    watchdog.unref();
    const startupTimeout = setTimeout(() => stream.end(new Error('Audio capture startup timed out')), 30000);
    startupTimeout.unref();
    try {
      // Race setup against cancellation/error without leaking an unhandled rejection.
      setup.catch(error => stream.end(error instanceof Error ? error : new Error(String(error))));
      let first = true;
      while (true) {
        const chunk = await stream.next();
        if (!chunk) break;
        if (first) { first = false; clearTimeout(startupTimeout); }
        yield chunk;
      }
      if (receipt) receipt.complete = stream.naturalEnd && !signal?.aborted;
    } finally {
      clearInterval(watchdog); clearTimeout(startupTimeout);
      signal?.removeEventListener('abort', abort);
      stream.end();
      if (session.active === stream) {
        // This page-side generation check is atomic even if replacement setup raced.
        await page.evaluate(gen => {
          const w = window as any;
          if (w.__sonoraRecorder?.generation !== gen) return;
          w.__sonoraStopCapture(gen);
          document.querySelector('video')?.pause();
        }, stream.generation).catch(() => {});
      }
    }
  }

  /** Downloads never accept client session identifiers or source offsets. */
  async download(videoId: string, signal: AbortSignal, format: 'webm' | 'mp3' = 'webm', onProgress?: (phase: 'recording' | 'finalizing', position?: number, duration?: number) => void): Promise<DownloadArtifact> {
    if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID');
    signal.throwIfAborted();
    const sessionId = `download-${randomUUID()}`;
    const receipt: CaptureReceipt = { expectedDuration: 0, complete: false, onRecorded: (position, duration) => onProgress?.('recording', position, duration), onFinalizing: () => onProgress?.('finalizing') };
    try {
      return await finalizeDownload(this.playRaw(sessionId, videoId, signal, 0, receipt), receipt, format, signal);
    } finally {
      // Startup can finish after cancellation: release that pending profile too.
      await this.pendingSessions.get(sessionId)?.catch(() => {});
      await this.closeSession(sessionId);
      this.replenishSpare();
    }
  }

  async pause(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastActive = Date.now();
    await session.page.evaluate(() => {
      (document.querySelector('video') as HTMLVideoElement)?.pause();
      const recorder = (window as any).__sonoraRecorder as MediaRecorder | undefined;
      if (recorder?.state === 'recording') recorder.pause();
    });
  }

  async resume(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastActive = Date.now();
    await session.page.evaluate(() => {
      const recorder = (window as any).__sonoraRecorder as MediaRecorder | undefined;
      if (recorder?.state === 'paused') recorder.resume();
      (window as any).__sonoraPlayError = null;
      void document.querySelector('video')?.play().catch(error => { (window as any).__sonoraPlayError = String(error); });
    });
    await session.page.waitForFunction(() => {
      if ((window as any).__sonoraPlayError) throw new Error((window as any).__sonoraPlayError);
      return document.querySelector('video')?.paused === false;
    }, undefined, { timeout: 8000 });
  }

  async seek(sessionId: string, position: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastActive = Date.now();
    if (!Number.isFinite(position) || position < 0) throw new Error('Invalid position');
    // Seeking inside a live container cannot reset the frontend timeline. Require
    // a new response; legacy callers receive an explicit actionable error.
    throw new Error('Seek requires a fresh stream request with start=<seconds>');
  }

  async nowPlaying(sessionId: string): Promise<NowPlaying | null> {
    const session = this.sessions.get(sessionId);
    if (!session?.currentVideoId) return null;
    session.lastActive = Date.now();
    return session.page.evaluate((videoId) => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      const titleEl = document.querySelector('.title.ytmusic-player-bar');
      const artistEl = document.querySelector('.byline.ytmusic-player-bar');
      const artworkEl = document.querySelector('#song-image img') as HTMLImageElement;
      return {
        videoId,
        title: titleEl?.textContent?.trim() || '',
        artist: artistEl?.textContent?.trim() || '',
        artwork: artworkEl?.src || null,
        duration: video.duration || 0,
        position: video.currentTime || 0,
        isPlaying: !video.paused,
      };
    }, session.currentVideoId);
  }

  async getMimeType(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) return 'audio/webm';
    return session.page.evaluate(() => (window as any).__sonoraMimeType || 'audio/webm');
  }

  /** Active session count (for monitoring) */
  get sessionCount(): number {
    return this.sessions.size;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.warmupEnabled = false;
    const spare = this.spareSession;
    this.spareSession = null;
    await this.initPromise?.catch(() => {});
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.allSettled([...this.pendingSessions.values(), ...(spare ? [spare.then(session => session.context.close())] : [])]);
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    this.cleanupTimer = null;
    this.extensionDir = null;
    this.initPromise = null;
  }
}

// Singleton — isolated temporary Chromium profile per session
export const chromiumBridge = new ChromiumBridge();
