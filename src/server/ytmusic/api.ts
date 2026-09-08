import express from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { youtubeMusicClient } from './YoutubeMusicClient.js';
import { matchingUploads } from './matchingUploads.js';
import { audioBackendService } from './AudioBackendService.js';

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

// Native-player streaming and offline downloads share the same MP3 backend.
app.get(['/api/ytmusic/stream/:videoId', '/api/ytmusic/download/:videoId'], async (req, res) => {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.on('close', cancel);
  const timeout = setTimeout(cancel, 300000);
  try {
    const { videoId } = req.params;
    if (!VALID_YT_VIDEO_ID.test(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }

    res.setHeader('X-Download-Via', 'sonora-audio-service');
    try {
      await proxyAudioBackendResponse(res, videoId, controller.signal);
    } catch (error: any) {
      // Retry only before any bytes are sent, and only for the known empty-upload failure.
      if (error?.code !== 'EMPTY_AUDIO' || res.headersSent || res.destroyed) throw error;
      const title = typeof req.query.title === 'string' ? req.query.title.slice(0, 300).trim() : '';
      const artist = typeof req.query.artist === 'string' ? req.query.artist.slice(0, 200).trim() : '';
      const durationSeconds = Number(req.query.duration);
      if (!title || !artist || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw error;
      const original = { videoId, title, artist, durationSeconds };
      const results = await youtubeMusicClient.search(`${artist} ${title}`, 'videos');
      for (const candidate of matchingUploads(original, results.songs).slice(0, 2)) {
        if (res.destroyed) return;
        try {
          res.setHeader('X-Audio-Video-Id', candidate.videoId);
          await proxyAudioBackendResponse(res, candidate.videoId, controller.signal);
          return;
        } catch (retryError: any) {
          if (res.headersSent || res.destroyed) throw retryError;
          res.removeHeader('X-Audio-Video-Id');
        }
      }
      throw new Error('Sonora Audio Service returned empty audio and no matching playable upload was found. Try another search result.');
    }
  } catch (err: any) {
    console.error('YT Music download error:', err);
    if (!res.headersSent) {
      res.status(err?.status || 502).json({
        error: err?.code || 'youtube_audio_backend_failed',
        details: err?.message,
      });
    }
  } finally {
    clearTimeout(timeout);
    res.off('close', cancel);
  }
});


export default app;
