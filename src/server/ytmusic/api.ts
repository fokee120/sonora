import express from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { youtubeMusicClient } from './YoutubeMusicClient.js';
import { matchingUploads } from './matchingUploads.js';
import { audioBackendService } from './AudioBackendService.js';
import { chromiumBridge } from '../bridge/ChromiumBridge.js';

const app = express();
app.use(express.json());

const VALID_YT_VIDEO_ID = /^[\w-]{11}$/;
const DEBUG_PERF = process.env.SONORA_DEBUG_PERF === 'true';

function logServerPerf(label: string, startedAt: number, extra?: Record<string, unknown>): void {
  if (!DEBUG_PERF) return;
  console.log(`[perf] ${label}: ${Date.now() - startedAt}ms`, extra || '');
}

// Await the entire transfer: unhandled upstream stream errors can crash a function.
async function proxyAudioBackendResponse(
  res: express.Response,
  videoId: string,
  signal?: AbortSignal
): Promise<void> {
  const startedAt = Date.now();
  const upstream = await audioBackendService.fetchAudio(videoId, signal);
  const reader = upstream.body!.getReader();
  const first = await reader.read();
  if (first.done || !first.value?.length) {
    throw Object.assign(new Error('Sonora Audio Service returned an empty audio stream for this upload.'), { code: 'EMPTY_AUDIO' });
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
  res.status(200);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  logServerPerf('audio proxy first byte', startedAt, { videoId });
  await pipeline(Readable.from(chunks()), res);
}

// YT Music integration status (search availability + downloader config)
app.get('/api/ytmusic/status', (req, res) => {
  res.json({
    searchAvailable: true,
    audioBackend: audioBackendService.getStatus(),
    bridge: { mode: 'chromium', description: 'Hidden Chromium drives the real YouTube Music web app' },
  });
});

app.post('/api/ytmusic/audio-backend-test', async (req, res) => {
  try {
    const response = await audioBackendService.fetchAudio('dQw4w9WgXcQ', AbortSignal.timeout(60000));
    const reader = response.body?.getReader();
    const first = await reader?.read();
    await reader?.cancel();
    if (!first?.value?.length) return res.json({ ok: false, message: 'Sonora Audio Service returned an empty audio stream.' });
    return res.json({ ok: true, message: 'Sonora Audio Service delivered MP3 bytes successfully.' });
  } catch (err: any) {
    return res.json({ ok: false, message: err?.message || 'Sonora Audio Service test failed.' });
  }
});

// Search the YouTube Music catalog
app.get('/api/ytmusic/search', async (req, res) => {
  const startedAt = Date.now();
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
    logServerPerf('ytmusic search', startedAt, { filter, resultCount: result.songs.length });
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

// Bridge playback controls — keeps each user's hidden Chromium session in sync
// with their frontend's <audio> element. Session ID isolates concurrent users:
// each gets their own browser context playing independently.
// Session comes from X-Session-Id header or ?session= query param
// (query param needed for <audio src> which can't set headers).
function getSessionId(req: express.Request): string {
  const fromHeader = req.headers['x-session-id'];
  const fromQuery = req.query.session;
  const id = (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader)
    || (typeof fromQuery === 'string' ? fromQuery : '')
    || 'default';
  // Sanitize: alphanumeric + dashes only, max 64 chars
  return id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) || 'default';
}

app.post('/api/ytmusic/bridge/pause', async (req, res) => {
  try {
    await chromiumBridge.pause(getSessionId(req));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err?.message });
  }
});

app.post('/api/ytmusic/bridge/resume', async (req, res) => {
  try {
    await chromiumBridge.resume(getSessionId(req));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err?.message });
  }
});

app.get('/api/ytmusic/bridge/now-playing', async (req, res) => {
  try {
    const state = await chromiumBridge.nowPlaying(getSessionId(req));
    res.json({ ok: true, nowPlaying: state });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err?.message });
  }
});

app.post('/api/ytmusic/bridge/seek', async (req, res) => {
  try {
    const position = Number(req.body?.position);
    if (!Number.isFinite(position) || position < 0) {
      return res.status(400).json({ ok: false, error: 'Invalid position' });
    }
    await chromiumBridge.seek(getSessionId(req), position);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err?.message });
  }
});

app.get('/api/ytmusic/bridge/sessions', async (req, res) => {
  res.json({ ok: true, activeSessions: chromiumBridge.sessionCount });
});

// Native-player streaming and offline downloads via the hidden Chromium bridge.
// The bridge plays the REAL music.youtube.com in a headless browser and captures
// audio directly from the page — no InnerTube spoofing, no PO tokens to manage.
app.get(['/api/ytmusic/stream/:videoId', '/api/ytmusic/download/:videoId'], async (req, res) => {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.on('close', cancel);
  const timeout = setTimeout(cancel, 600000); // 10 min max (long songs + capture overhead)
  const isDownload = req.path.includes('/download/');
  try {
    const { videoId } = req.params;
    if (!VALID_YT_VIDEO_ID.test(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }

    res.setHeader('X-Audio-Via', 'sonora-chromium-bridge');

    // Each user gets an isolated browser session (see getSessionId above).
    const sessionId = getSessionId(req);

    // iOS Safari/PWA cannot play WebM/Opus — serve MP3 (transcoded via ffmpeg).
    // Detect via User-Agent; also allow explicit ?format=mp3 override.
    const userAgent = req.headers['user-agent'] || '';
    const isIOS = /iPad|iPhone|iPod/.test(userAgent);
    const wantsMp3 = req.query.format === 'mp3' || isIOS;
    const format = wantsMp3 ? 'mp3' : 'webm';
    const mimeType = format === 'mp3' ? 'audio/mpeg' : await chromiumBridge.getMimeType(sessionId).catch(() => 'audio/webm');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Audio-Format', format);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (isDownload) {
      // For downloads, accumulate the full stream then serve as a file.
      // Note: capture is real-time, so this takes as long as the song.
      const title = typeof req.query.title === 'string' ? req.query.title.slice(0, 100).trim() : videoId;
      const safeTitle = title.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || videoId;
      const ext = format === 'mp3' ? 'mp3' : 'webm';
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`);
    }

    res.status(200);

    // Pipe bridge audio chunks directly to the HTTP response
    async function* chunks() {
      try {
        for await (const chunk of chromiumBridge.play(sessionId, videoId, controller.signal, format)) {
          yield chunk;
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        throw err;
      }
    }

    logServerPerf('chromium bridge first byte', Date.now(), { videoId, isDownload, format, sessionId });
    await pipeline(Readable.from(chunks()), res);
  } catch (err: any) {
    console.error('YT Music bridge error:', err);
    if (!res.headersSent) {
      res.status(err?.status || 502).json({
        error: err?.code || 'chromium_bridge_failed',
        details: err?.message,
      });
    }
  } finally {
    clearTimeout(timeout);
    res.off('close', cancel);
  }
});


export default app;
