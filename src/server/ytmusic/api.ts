import express from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { youtubeMusicClient } from './YoutubeMusicClient.js';
import { downloaderService } from './DownloaderService.js';

const app = express();
app.use(express.json());

const VALID_YT_VIDEO_ID = /^[\w-]{11}$/;

// Await the entire transfer: unhandled upstream stream errors can crash a function.
async function proxyMediaResponse(
  res: express.Response,
  mediaUrl: string,
  rangeHeader: string | undefined,
  fallbackMime = 'audio/mpeg'
): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.on('close', cancel);
  const timeout = setTimeout(cancel, 120000);
  try {
    const upstream = await fetch(mediaUrl, {
      headers: rangeHeader ? { Range: rangeHeader } : {},
      signal: controller.signal,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw Object.assign(new Error('Cobalt audio transfer failed (HTTP ' + upstream.status + '). Retry the track; if it persists, check the Cobalt log.'), { status: 502 });
    }
    const contentType = upstream.headers.get('content-type') || fallbackMime;
    if (/text\/|application\/(json|xml)/i.test(contentType)) {
      await upstream.body?.cancel();
      throw new Error('Audio provider returned a page or error instead of audio. Check the downloader configuration.');
    }
    if (!upstream.body) throw new Error('Cobalt returned no audio data.');
    const reader = upstream.body.getReader();
    const first = await reader.read();
    if (first.done) {
      throw new Error('Cobalt returned an empty audio stream. Check the Cobalt terminal for this track.');
    }
    async function* chunks() {
      try {
        yield first.value;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          yield chunk.value;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    // Transcoded Cobalt MP3s are chunked and often ignore Range. Do not promise seeking.
    if (upstream.status === 206 || upstream.headers.get('accept-ranges') === 'bytes') {
      res.setHeader('Accept-Ranges', 'bytes');
    }
    for (const key of ['content-range', 'content-length', 'estimated-content-length']) {
      const value = upstream.headers.get(key);
      if (value) res.setHeader(key, value);
    }
    await pipeline(Readable.from(chunks()), res);
  } finally {
    clearTimeout(timeout);
    res.off('close', cancel);
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
      enabled: config.enabled,
      url: config.url,
      audioFormat: config.audioFormat,
      configured: downloaderService.isConfigured(),
      hasApiKey: Boolean(config.apiKey),
    },
  });
});

// Exercise the same resolver as playback and verify that it actually delivers bytes.
app.post('/api/ytmusic/downloader-test', async (req, res) => {
  try {
    const result = await downloaderService.resolveAudioUrl('dQw4w9WgXcQ');
    if (!result.ok || !result.url) return res.json({ ok: false, message: result.error || 'Cobalt returned no audio URL.' });
    const response = await fetch(result.url, { signal: AbortSignal.timeout(30000) });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || /text\/|application\/(json|xml)/i.test(type)) {
      await response.body?.cancel();
      return res.json({ ok: false, message: 'Cobalt resolved the track, but audio delivery failed (HTTP ' + response.status + ').' });
    }
    const reader = response.body?.getReader();
    const first = await reader?.read();
    await reader?.cancel();
    if (!first?.value?.length) return res.json({ ok: false, message: 'Cobalt returned an empty audio stream. Check its terminal and extractor configuration.' });
    return res.json({ ok: true, message: 'Cobalt delivered audio successfully. Sonora can play and download this test track.' });
  } catch (err: any) {
    return res.json({ ok: false, message: err?.message || 'Cobalt audio transfer failed.' });
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
        throw new Error(dlResult.error || 'Cobalt could not resolve this audio.');
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
        error: 'Could not load Cobalt audio',
        details: err?.message,
      });
    }
  }
});


export default app;
