import 'dotenv/config';

export interface AudioBackendConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
}

export interface AudioBackendStatus {
  configured: boolean;
  hasApiKey: boolean;
  url: string | null;
}

export class AudioBackendError extends Error {
  public status: number;
  public code: string;

  constructor(message: string, status = 502, code = 'audio_backend_error') {
    super(message);
    this.name = 'AudioBackendError';
    this.status = status;
    this.code = code;
  }
}

class AudioBackendService {
  private config: AudioBackendConfig;

  constructor() {
    this.config = {
      enabled: Boolean(process.env.SONORA_AUDIO_API_URL || process.env.AUDIO_SERVICE_URL),
      url: (process.env.SONORA_AUDIO_API_URL || process.env.AUDIO_SERVICE_URL || '').replace(/\/+$/, ''),
      apiKey: process.env.SONORA_AUDIO_API_KEY || process.env.AUDIO_SERVICE_API_KEY || '',
    };
  }

  public getConfig(): AudioBackendConfig {
    return { ...this.config };
  }

  public setConfig(patch: Partial<AudioBackendConfig>): AudioBackendConfig {
    if (typeof patch.enabled === 'boolean') this.config.enabled = patch.enabled;
    if (typeof patch.url === 'string') this.config.url = patch.url.trim().replace(/\/+$/, '');
    if (typeof patch.apiKey === 'string') this.config.apiKey = patch.apiKey.trim();
    return this.getConfig();
  }

  public getStatus(): AudioBackendStatus {
    return {
      configured: this.isConfigured(),
      hasApiKey: Boolean(this.config.apiKey),
      url: this.config.url || null,
    };
  }

  public isConfigured(): boolean {
    return this.config.enabled && /^https?:\/\//.test(this.config.url);
  }

  public async fetchAudio(videoId: string, signal?: AbortSignal): Promise<Response> {
    if (!this.isConfigured()) {
      throw new AudioBackendError('Sonora Audio Service is not configured.', 503, 'audio_backend_unconfigured');
    }

    const headers: Record<string, string> = { Accept: 'audio/mpeg, application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

    let response: Response;
    try {
      response = await fetch(`${this.config.url}/audio/${encodeURIComponent(videoId)}`, {
        headers,
        signal,
      });
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new AudioBackendError(
        timedOut ? 'Sonora Audio Service request timed out.' : 'Could not reach Sonora Audio Service.',
        timedOut ? 504 : 502,
        timedOut ? 'audio_timeout' : 'audio_backend_unreachable'
      );
    }

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const message = data?.message || data?.details || data?.error || `Sonora Audio Service returned HTTP ${response.status}.`;
      const code = typeof data?.error === 'string' ? data.error : 'audio_backend_error';
      await response.body?.cancel().catch(() => {});
      throw new AudioBackendError(message, response.status === 429 ? 429 : 502, code);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!/^audio\/mpeg\b/i.test(contentType)) {
      await response.body?.cancel().catch(() => {});
      throw new AudioBackendError('Sonora Audio Service returned a non-MP3 response.', 502, 'invalid_audio_type');
    }

    if (!response.body) {
      throw new AudioBackendError('Sonora Audio Service returned no audio data.', 502, 'empty_audio');
    }

    return response;
  }

  public async health(signal?: AbortSignal): Promise<{ ok: boolean; details?: unknown }> {
    if (!this.isConfigured()) return { ok: false, details: 'not_configured' };
    try {
      const response = await fetch(`${this.config.url}/health`, {
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
        signal,
      });
      return { ok: response.ok, details: await response.json().catch(() => ({ status: response.status })) };
    } catch (err: any) {
      return { ok: false, details: err?.message || String(err) };
    }
  }
}

export const audioBackendService = new AudioBackendService();
