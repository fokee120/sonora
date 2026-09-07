import 'dotenv/config';

/**
 * Third-party downloader integration
 *
 * Supports any Cobalt-compatible downloader API (github.com/imputnet/cobalt).
 * The instance URL can be supplied via:
 *   - environment: COBALT_API_URL (+ optional COBALT_API_KEY)
 *   - runtime: POST /api/ytmusic/downloader-config (takes precedence)
 *
 * If no downloader is configured (or it fails), the caller can fall back to
 * the built-in InnerTube stream resolver in YoutubeMusicClient.
 */

export interface DownloaderConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  audioFormat: 'best' | 'm4a' | 'mp3' | 'opus';
}

export interface DownloaderResult {
  ok: boolean;
  /** Direct media URL to stream from (tunnel or redirect). */
  url?: string;
  /** Which mechanism produced the URL. */
  source: 'downloader' | 'innertube-fallback';
  mimeType?: string;
  error?: string;
}

interface CobaltResponse {
  status: 'tunnel' | 'redirect' | 'picker' | 'error' | 'local-processing' | string;
  url?: string;
  error?: { code?: string } | string;
  tunnel?: string[];
}

// Cobalt does not accept m4a. Migrate legacy settings to playable MP3.
export function normalizeDownloaderFormat(value: unknown): DownloaderConfig['audioFormat'] {
  return value === 'best' || value === 'opus' ? value : 'mp3';
}

class DownloaderService {
  private config: DownloaderConfig;

  constructor() {
    this.config = {
      enabled: Boolean(process.env.COBALT_API_URL || process.env.YT_DOWNLOADER_URL || process.env.YTMUSIC_DOWNLOADER_URL),
      url:
        process.env.COBALT_API_URL ||
        process.env.YT_DOWNLOADER_URL ||
        process.env.YTMUSIC_DOWNLOADER_URL ||
        '',
      apiKey: process.env.COBALT_API_KEY || process.env.YTMUSIC_DOWNLOADER_API_KEY || '',
      audioFormat: normalizeDownloaderFormat(process.env.YT_DOWNLOADER_AUDIO_FORMAT || process.env.YTMUSIC_AUDIO_FORMAT),
    };
  }

  public getConfig(): DownloaderConfig {
    return { ...this.config };
  }

  public setConfig(patch: Partial<DownloaderConfig>): DownloaderConfig {
    if (typeof patch.enabled === 'boolean') this.config.enabled = patch.enabled;
    if (typeof patch.url === 'string') this.config.url = patch.url.trim().replace(/\/+$/, '');
    if (typeof patch.apiKey === 'string') this.config.apiKey = patch.apiKey.trim();
    if (
      patch.audioFormat === 'best' ||
      patch.audioFormat === 'm4a' ||
      patch.audioFormat === 'mp3' ||
      patch.audioFormat === 'opus'
    ) {
      this.config.audioFormat = normalizeDownloaderFormat(patch.audioFormat);
    }
    return this.getConfig();
  }

  public isConfigured(): boolean {
    return this.config.enabled && /^https?:\/\//.test(this.config.url);
  }

  /**
   * Ask the configured Cobalt-compatible instance for a direct audio URL
   * for the given YouTube video.
   */
  public async resolveAudioUrl(videoId: string): Promise<DownloaderResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        source: 'downloader',
        error: 'No third-party downloader configured',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (this.config.apiKey) {
        headers.Authorization = `Api-Key ${this.config.apiKey}`;
      }

      const res = await fetch(this.config.url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${videoId}`,
          downloadMode: 'audio',
          alwaysProxy: true,
          audioFormat: this.config.audioFormat,
          audioBitrate: '128',
          filenameStyle: 'basic',
          localProcessing: 'disabled',
        }),
      });

      const data = (await res.json().catch(() => null)) as CobaltResponse | null;

      if (!res.ok || !data) {
        const code =
          typeof data?.error === 'string' ? data.error : data?.error?.code || `HTTP ${res.status}`;
        return { ok: false, source: 'downloader', error: `Downloader error: ${code}` };
      }

      if (data.status === 'tunnel' || data.status === 'redirect') {
        const url = data.url || (Array.isArray(data.tunnel) ? data.tunnel[0] : undefined);
        if (url) {
          return { ok: true, url, source: 'downloader' };
        }
        return { ok: false, source: 'downloader', error: 'Downloader returned no media URL' };
      }

      if (data.status === 'error') {
        const code = typeof data.error === 'string' ? data.error : data.error?.code || 'unknown';
        return { ok: false, source: 'downloader', error: `Downloader error: ${code}` };
      }

      return {
        ok: false,
        source: 'downloader',
        error: `Unsupported downloader response status: ${data.status}`,
      };
    } catch (err: any) {
      const message =
        err?.name === 'AbortError'
          ? 'Downloader request timed out'
          : 'Could not reach the configured Cobalt instance. Keep Cobalt and its tunnel running.';
      return { ok: false, source: 'downloader', error: message };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const downloaderService = new DownloaderService();
