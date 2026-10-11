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

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

// In-page capture script: finds the media element, captures its stream,
// encodes via MediaRecorder, and sends chunks back to Node.
const CAPTURE_SCRIPT = `
(() => {
  if (window.__sonoraCapture) return;
  window.__sonoraCapture = true;
  window.__sonoraChunks = [];
  window.__sonoraRecording = false;

  window.__sonoraStartCapture = () => {
    // YouTube Music uses a <video> element for audio playback
    const media = document.querySelector('video');
    if (!media) {
      window.__sonoraCaptureError = 'no media element found';
      return false;
    }
    try {
      const stream = media.captureStream();
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        window.__sonoraCaptureError = 'no audio tracks in captured stream';
        return false;
      }
      const audioOnly = new MediaStream(audioTracks);
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(audioOnly, { mimeType, audioBitsPerSecond: 128000 });
      window.__sonoraMimeType = mimeType;
      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          const buf = await e.data.arrayBuffer();
          window.__sonoraSendChunk(Array.from(new Uint8Array(buf)));
        }
      };
      recorder.onstop = () => { window.__sonoraRecording = false; };
      recorder.start(1000); // 1-second chunks for low-latency streaming
      window.__sonoraRecorder = recorder;
      window.__sonoraRecording = true;
      window.__sonoraCaptureError = null;
      return true;
    } catch (err) {
      window.__sonoraCaptureError = String(err?.message || err);
      return false;
    }
  };

  window.__sonoraStopCapture = () => {
    try { window.__sonoraRecorder?.stop(); } catch {}
    window.__sonoraRecording = false;
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
  chunkQueue: Buffer[];
  chunkResolvers: Array<(chunk: Buffer | null) => void>;
  streamEnded: boolean;
  lastActive: number;
}

const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
const MAX_SESSIONS = 10;
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 min

export class ChromiumBridge extends EventEmitter {
  private browser: Browser | null = null;
  private sessions = new Map<string, Session>();
  private initPromise: Promise<void> | null = null;
  private ffmpegAvailable: boolean | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  /** Launch the shared browser (one per server, sessions are isolated contexts) */
  async ensureReady(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init();
    return this.initPromise;
  }

  private async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
    });
    // Periodic cleanup of idle sessions
    this.cleanupTimer = setInterval(() => this.cleanupIdleSessions(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  /** Get or create an isolated session for a user */
  private async getSession(sessionId: string): Promise<Session> {
    await this.ensureReady();
    let session = this.sessions.get(sessionId);
    if (session) {
      session.lastActive = Date.now();
      return session;
    }
    // Enforce max sessions — evict the oldest idle one
    if (this.sessions.size >= MAX_SESSIONS) {
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [id, s] of this.sessions) {
        if (s.lastActive < oldestTime) { oldestTime = s.lastActive; oldest = id; }
      }
      if (oldest) await this.closeSession(oldest);
    }
    const context = await this.browser!.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    // Each session's page gets its own chunk handler bound to its session
    await page.exposeFunction('__sonoraSendChunk', (bytes: number[]) => {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      const buf = Buffer.from(bytes);
      if (s.chunkResolvers.length > 0) {
        s.chunkResolvers.shift()!(buf);
      } else {
        s.chunkQueue.push(buf);
      }
    });
    await page.addInitScript(CAPTURE_SCRIPT);
    await page.goto('https://music.youtube.com/', { waitUntil: 'domcontentloaded' });

    session = {
      context, page,
      currentVideoId: null,
      chunkQueue: [], chunkResolvers: [],
      streamEnded: false,
      lastActive: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.streamEnded = true;
    for (const resolve of session.chunkResolvers) resolve(null);
    await session.context.close().catch(() => {});
    this.sessions.delete(sessionId);
  }

  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActive > SESSION_IDLE_TIMEOUT_MS) {
        this.closeSession(id).catch(() => {});
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
    signal?: AbortSignal
  ): AsyncGenerator<Buffer> {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-f', 'mp3',
      '-acodec', 'libmp3lame',
      '-ab', '128k',
      '-ar', '44100',
      'pipe:1',
    ]);
    const abort = () => ffmpeg.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    (async () => {
      try {
        for await (const chunk of chunks) {
          if (signal?.aborted) break;
          if (!ffmpeg.stdin.write(chunk)) {
            await new Promise((r) => ffmpeg.stdin.once('drain', r));
          }
        }
      } catch {}
      ffmpeg.stdin.end();
    })();
    try {
      for await (const chunk of ffmpeg.stdout) {
        if (signal?.aborted) break;
        yield chunk as Buffer;
      }
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
    format: 'webm' | 'mp3' = 'webm'
  ): AsyncGenerator<Buffer> {
    const useMp3 = format === 'mp3' && (await this.checkFfmpeg());
    const rawChunks = this.playRaw(sessionId, videoId, signal);
    if (useMp3) {
      yield* this.transcodeToMp3(rawChunks, signal);
    } else {
      yield* rawChunks;
    }
  }

  private async *playRaw(
    sessionId: string,
    videoId: string,
    signal?: AbortSignal
  ): AsyncGenerator<Buffer> {
    const session = await this.getSession(sessionId);
    const page = session.page;

    session.chunkQueue = [];
    session.chunkResolvers = [];
    session.streamEnded = false;
    session.currentVideoId = videoId;
    session.lastActive = Date.now();

    const abort = () => {
      session.streamEnded = true;
      for (const resolve of session.chunkResolvers) resolve(null);
      session.chunkResolvers = [];
    };
    signal?.addEventListener('abort', abort, { once: true });

    try {
      await page.goto(`https://music.youtube.com/watch?v=${videoId}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('video', { timeout: 15000 });
      const captureOk = await page.evaluate(() => (window as any).__sonoraStartCapture());
      if (!captureOk) {
        const err = await page.evaluate(() => (window as any).__sonoraCaptureError);
        throw new Error(`Audio capture failed: ${err || 'unknown'}`);
      }
      await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement;
        if (video && video.paused) video.play().catch(() => {});
      });
      while (!session.streamEnded) {
        const chunk = await this.nextChunk(session, signal);
        if (chunk === null) break;
        session.lastActive = Date.now();
        yield chunk;
      }
    } finally {
      signal?.removeEventListener('abort', abort);
      await page.evaluate(() => (window as any).__sonoraStopCapture?.()).catch(() => {});
    }
  }

  private nextChunk(session: Session, signal?: AbortSignal): Promise<Buffer | null> {
    if (session.chunkQueue.length > 0) {
      return Promise.resolve(session.chunkQueue.shift()!);
    }
    if (session.streamEnded) return Promise.resolve(null);
    return new Promise((resolve) => {
      const onAbort = () => resolve(null);
      signal?.addEventListener('abort', onAbort, { once: true });
      session.chunkResolvers.push((chunk) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(chunk);
      });
    });
  }

  async pause(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastActive = Date.now();
    await session.page.evaluate(() => {
      (document.querySelector('video') as HTMLVideoElement)?.pause();
    });
  }

  async resume(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastActive = Date.now();
    await session.page.evaluate(() => {
      (document.querySelector('video') as HTMLVideoElement)?.play().catch(() => {});
    });
  }

  async seek(sessionId: string, position: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastActive = Date.now();
    await session.page.evaluate((pos) => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (video && Number.isFinite(video.duration)) {
        video.currentTime = Math.max(0, Math.min(pos, video.duration));
      }
    }, position);
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
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    await this.browser?.close();
    this.browser = null;
    this.initPromise = null;
  }
}

// Singleton — one browser, isolated sessions per user
export const chromiumBridge = new ChromiumBridge();
