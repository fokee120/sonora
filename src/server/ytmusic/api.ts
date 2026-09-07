import express from 'express';
import { Readable } from 'stream';
import { youtubeMusicClient } from './YoutubeMusicClient.js';
import { downloaderService } from './DownloaderService.js';

const app = express();
app.use(express.json());

const VALID_YT_VIDEO_ID = /^[\w-]{11}$/;

// Proxy a resolved media URL to the client with HTTP Range (scrubbing) support.
async function proxyMediaResponse(
  res: express.Response,
  mediaUrl: string,
  rangeHeader: string | undefined,
  fallbackMime = 'audio/mp4'
): Promise<void> {
  const upstreamHeaders: Record<string, string> = {};
  if (rangeHeader) {
    upstreamHeaders['Range'] = rangeHeader;
  }

  const upstream = await fetch(mediaUrl, { headers: upstreamHeaders });
  if (!upstream.ok && upstream.status !== 206) {
    const detail = await upstream.text().catch(() => '');
    throw Object.assign(new Error(`Upstream media error (${upstream.status}) ${detail.slice(0, 200)}`), {
      status: upstream.status === 403 ? 502 : upstream.status,
    });
  }

  const contentType = upstream.headers.get('content-type');
  if (contentType && /text\/|application\/(json|xml)/i.test(contentType)) {
    await upstream.body?.cancel();
    throw new Error('Audio provider returned a page or error instead of audio. Check the downloader configuration.');
  }
  res.status(upstream.status);
  res.setHeader('Content-Type', contentType && !contentType.includes('text/html') ? contentType : fallbackMime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  for (const key of ['content-range', 'content-length']) {
    const value = upstream.headers.get(key);
    if (value) res.setHeader(key, value);
  }

  if (upstream.body) {
    // @ts-ignore - Node web streams interop
    const stream = Readable.fromWeb ? Readable.fromWeb(upstream.body as any) : Readable.from(upstream.body as any);
    stream.pipe(res);
  } else {
    res.end();
  }
}

// YT Music integration status (search availability + downloader config)
app.get('/api/ytmusic/status', (req, res) => {
  const downloader = downloaderService.getConfig();
  res.json({
    searchAvailable: true,
    downloader: {
      enabled: downloader.enabled,
      configured: downloaderService.isConfigured(),
      hasApiKey: Boolean(downloader.apiKey),
      audioFormat: downloader.audioFormat,
      // Mask instance URL for display
      url: downloader.url ? downloader.url : null,
    },
  });
});

// Update downloader configuration at runtime (takes precedence over env)
app.post('/api/ytmusic/downloader-config', (req, res) => {
  const { enabled, url, apiKey, audioFormat } = req.body || {};
  const config = downloaderService.setConfig({
    enabled: typeof enabled === 'boolean' ? enabled : undefined,
    url: typeof url === 'string' ? url : undefined,
    apiKey: typeof apiKey === 'string' ? apiKey : undefined,
    audioFormat,
  });
  res.json({
    success: true,
    downloader: {
      ...config,
      configured: downloaderService.isConfigured(),
      hasApiKey: Boolean(config.apiKey),
    },
  });
});

// Verify the configured third-party downloader responds like a
// Cobalt-compatible API (reachability + response shape).
app.post('/api/ytmusic/downloader-test', async (req, res) => {
  try {
    if (!downloaderService.isConfigured()) {
      return res.json({ ok: false, message: 'No downloader URL configured.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const cfg = downloaderService.getConfig();
    if (cfg.apiKey) headers.Authorization = `Api-Key ${cfg.apiKey}`;

    try {
      const testRes = await fetch(cfg.url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          downloadMode: 'audio',
          audioFormat: cfg.audioFormat,
          audioBitrate: '128',
          filenameStyle: 'basic',
          localProcessing: 'disabled',
        }),
      });
      const data = await testRes.json().catch(() => null);

      if (!testRes.ok) {
        const code =
          typeof data?.error === 'string'
            ? data.error
            : data?.error?.code || `HTTP ${testRes.status}`;
        return res.json({
          ok: false,
          message: `Instance reachable but rejected the request (${code}). Check API key / instance settings.`,
        });
      }

      if (data?.status === 'tunnel' || data?.status === 'redirect' || data?.url) {
        return res.json({
          ok: true,
          message: `Downloader works — returned a media URL (${data.status}).`,
        });
      }
      if (data?.status === 'error') {
        const code = typeof data.error === 'string' ? data.error : data.error?.code;
        return res.json({
          ok: false,
          message: `Instance replied with an error (${code || 'unknown'}). It may not support YouTube audio.`,
        });
      }
      if (data?.status) {
        return res.json({
          ok: true,
          message: `Instance responded with status "${data.status}" — recognized as Cobalt-compatible.`,
        });
      }
      return res.json({
        ok: false,
        message: 'Instance responded but not with a Cobalt-compatible JSON shape.',
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    const message =
      err?.name === 'AbortError'
        ? 'Instance did not respond within 15s.'
        : err?.message || 'Could not reach the downloader instance.';
    res.json({ ok: false, message });
  }
});

// Search the YouTube Music catalog
app.get('/api/ytmusic/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const filterRaw = String(req.query.filter || 'songs');
    const filter = (['songs', 'videos', 'albums', 'artists'].includes(filterRaw)
      ? filterRaw
      : 'songs') as 'songs' | 'videos' | 'albums' | 'artists';

    if (!query) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }

    const result = await youtubeMusicClient.search(query, filter);
    res.json(result);
  } catch (err: any) {
    console.error('YT Music search error:', err);
    res.status(502).json({
      error: 'YouTube Music search failed',
      details: err?.message || String(err),
    });
  }
});

// Single track metadata
app.get('/api/ytmusic/track/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!VALID_YT_VIDEO_ID.test(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }
    const track = await youtubeMusicClient.getTrack(videoId);
    res.json(track);
  } catch (err: any) {
    console.error('YT Music track lookup error:', err);
    res.status(502).json({ error: 'Track lookup failed', details: err?.message });
  }
});

// Native-player streaming and offline downloads share the same resolver. Preference order:
//   1. Configured third-party downloader (Cobalt-compatible API)
//   2. Built-in InnerTube audio stream proxy (fallback)
app.get(['/api/ytmusic/stream/:videoId', '/api/ytmusic/download/:videoId'], async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!VALID_YT_VIDEO_ID.test(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }

    let mediaUrl: string | undefined;
    let mimeType = 'audio/mp4';
    let via = 'innertube-fallback';

    if (downloaderService.isConfigured()) {
      const dlResult = await downloaderService.resolveAudioUrl(videoId);
      if (dlResult.ok && dlResult.url) {
        mediaUrl = dlResult.url;
        if (downloaderService.getConfig().audioFormat === 'mp3') mimeType = 'audio/mpeg';
        else if (downloaderService.getConfig().audioFormat === 'opus') mimeType = 'audio/opus';
        via = 'downloader';
      } else {
        console.warn(`Third-party downloader failed (${dlResult.error}); falling back to direct stream.`);
      }
    }

    if (!mediaUrl) {
      const resolved = await youtubeMusicClient.resolveAudioStream(videoId);
      mediaUrl = resolved.url;
      mimeType = resolved.mimeType;
    }

    res.setHeader('X-Download-Via', via);
    await proxyMediaResponse(res, mediaUrl, req.headers.range, mimeType);
  } catch (err: any) {
    console.error('YT Music download error:', err);
    if (!res.headersSent) {
      res.status(err?.status || 502).json({
        error: 'Could not download this track',
        details: err?.message,
      });
    }
  }
});


export default app;
