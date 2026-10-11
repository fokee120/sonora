/**
 * ChromiumBridge — hidden YouTube Music player
 *
 * Runs the REAL music.youtube.com in a headless Chromium, controlled via
 * Playwright. Audio is captured directly from the page's media element
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
import { spawn, ChildProcess } from 'child_process';
import { PassThrough, Readable } from 'stream';

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
          // Send to Node via the exposed binding
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

export class ChromiumBridge extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private currentVideoId: string | null = null;
  private chunkResolvers: Array<(chunk: Buffer | null) => void> = [];
  private chunkQueue: Buffer[] = [];
  private streamEnded = false;
  private initPromise: Promise<void> | null = null;
  private ffmpegAvailable: boolean | null = null;

  /**
   * Check if ffmpeg is available for MP3 transcoding.
   * iOS Safari/PWA cannot play WebM/Opus — it needs MP3.
   */
  private async checkFfmpeg(): Promise<boolean> {
    if (this.ffmpegAvailable !== null) return this.ffmpegAvailable;
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', ['-version']);
      proc.on('error', () => {
        this.ffmpegAvailable = false;
        resolve(false);
      });
      proc.on('exit', (code) => {
        this.ffmpegAvailable = code === 0;
        resolve(code === 0);
      });
      // Timeout after 3s
      setTimeout(() => {
        if (this.ffmpegAvailable === null) {
          this.ffmpegAvailable = false;
          proc.kill();
          resolve(false);
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
      '-i', 'pipe:0',           // input from stdin (webm/opus)
      '-f', 'mp3',              // output format
      '-acodec', 'libmp3lame',  // MP3 encoder
      '-ab', '128k',            // 128kbps bitrate
      '-ar', '44100',           // 44.1kHz sample rate
      'pipe:1',                 // output to stdout
    ]);

    const abort = () => ffmpeg.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });

    // Pipe chunks into ffmpeg's stdin
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

    // Yield MP3 chunks from ffmpeg's stdout
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
   * Launch hidden Chromium and navigate to YouTube Music.
   * Called lazily on first play — the user never triggers this manually.
   */
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
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    this.page = await this.context.newPage();

    // Expose a function the page can call to send audio chunks to Node
    await this.page.exposeFunction('__sonoraSendChunk', (bytes: number[]) => {
      const buf = Buffer.from(bytes);
      if (this.chunkResolvers.length > 0) {
        const resolve = this.chunkResolvers.shift()!;
        resolve(buf);
      } else {
        this.chunkQueue.push(buf);
      }
    });

    // Inject capture helpers into every page
    await this.page.addInitScript(CAPTURE_SCRIPT);

    // Go to YouTube Music (loads the player framework)
    await this.page.goto('https://music.youtube.com/', { waitUntil: 'domcontentloaded' });
  }

  /**
   * Play a song by video ID.
   * @param videoId YouTube video ID
   * @param signal AbortSignal for cancellation
   * @param format 'webm' (default, lower CPU) or 'mp3' (for iOS Safari/PWA compatibility)
   * @returns AsyncGenerator of audio chunks + the MIME type
   */
  async *play(
    videoId: string,
    signal?: AbortSignal,
    format: 'webm' | 'mp3' = 'webm'
  ): AsyncGenerator<Buffer> {
    // For MP3, we capture WebM then transcode via ffmpeg
    const useMp3 = format === 'mp3' && (await this.checkFfmpeg());
    const rawChunks = this.playRaw(videoId, signal);
    if (useMp3) {
      yield* this.transcodeToMp3(rawChunks, signal);
    } else {
      yield* rawChunks;
    }
  }

  /**
   * Raw WebM/Opus capture from the hidden Chromium.
   * Internal — use play() which handles format selection.
   */
  private async *playRaw(videoId: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    await this.ensureReady();
    const page = this.page!;

    // Reset chunk state for this playback
    this.chunkQueue = [];
    this.chunkResolvers = [];
    this.streamEnded = false;
    this.currentVideoId = videoId;

    const abort = () => {
      this.streamEnded = true;
      for (const resolve of this.chunkResolvers) resolve(null);
      this.chunkResolvers = [];
    };
    signal?.addEventListener('abort', abort, { once: true });

    try {
      // Navigate to the song. The real YT Music player handles auth, tokens, SABR.
      await page.goto(`https://music.youtube.com/watch?v=${videoId}`, {
        waitUntil: 'domcontentloaded',
      });

      // Wait for the media element to appear and start playing
      await page.waitForSelector('video', { timeout: 15000 });

      // Start audio capture
      const captureOk = await page.evaluate(() => {
        return (window as any).__sonoraStartCapture();
      });
      if (!captureOk) {
        const err = await page.evaluate(() => (window as any).__sonoraCaptureError);
        throw new Error(`Audio capture failed: ${err || 'unknown'}`);
      }

      // Ensure it's playing (click play if paused)
      await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement;
        if (video && video.paused) video.play().catch(() => {});
      });

      // Yield chunks as they arrive
      while (!this.streamEnded) {
        const chunk = await this.nextChunk(signal);
        if (chunk === null) break;
        yield chunk;
      }
    } finally {
      signal?.removeEventListener('abort', abort);
      // Stop capture but keep browser alive for next song
      await page.evaluate(() => (window as any).__sonoraStopCapture?.()).catch(() => {});
    }
  }

  private nextChunk(signal?: AbortSignal): Promise<Buffer | null> {
    if (this.chunkQueue.length > 0) {
      return Promise.resolve(this.chunkQueue.shift()!);
    }
    if (this.streamEnded) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const onAbort = () => resolve(null);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.chunkResolvers.push((chunk) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(chunk);
      });
    });
  }

  /** Pause playback */
  async pause(): Promise<void> {
    await this.ensureReady();
    await this.page!.evaluate(() => {
      (document.querySelector('video') as HTMLVideoElement)?.pause();
    });
  }

  /** Resume playback */
  async resume(): Promise<void> {
    await this.ensureReady();
    await this.page!.evaluate(() => {
      (document.querySelector('video') as HTMLVideoElement)?.play().catch(() => {});
    });
  }

  /** Get current playback state from the DOM */
  async nowPlaying(): Promise<NowPlaying | null> {
    if (!this.page || !this.currentVideoId) return null;
    return this.page.evaluate((videoId) => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video) return null;
      // Scrape title/artist from YT Music's DOM
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
    }, this.currentVideoId);
  }

  /** Get the MIME type of the captured audio (for Content-Type header) */
  async getMimeType(): Promise<string> {
    if (!this.page) return 'audio/webm';
    return this.page.evaluate(() => (window as any).__sonoraMimeType || 'audio/webm');
  }

  /** Seek the hidden player to a position (seconds) */
  async seek(position: number): Promise<void> {
    await this.ensureReady();
    await this.page!.evaluate((pos) => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (video && Number.isFinite(video.duration)) {
        video.currentTime = Math.max(0, Math.min(pos, video.duration));
      }
    }, position);
  }

  /** Shut down the browser (call on server exit) */
  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
    this.initPromise = null;
  }
}

// Singleton — one hidden browser for the whole server
export const chromiumBridge = new ChromiumBridge();
