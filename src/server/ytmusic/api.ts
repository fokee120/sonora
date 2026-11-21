import { sendAudioPrefix } from '../bridge/AudioPrefix.js';
import {directStream} from '../bridge/DirectStream.js';
import { Mp3Ranges } from '../bridge/Mp3Ranges.js';
import {isRoutineAudioCancellation} from '../bridge/AudioCancellation.js';
import {searchYoutubeVideos} from './youtubeSearch.js';
import express from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'node:fs';
import { youtubeMusicClient } from './YoutubeMusicClient.js';
import { matchingUploads } from './matchingUploads.js';
import { audioBackendService } from './AudioBackendService.js';
import { directDownloader } from '../bridge/DirectDownloader.js';
import { TransferSlots } from './transferSlots.js';

import { beginDownloadJob, readDownloadJob, reportDownloadJob, updateDownloadJob, validDownloadRequestId } from '../bridge/DownloadJobs.js';

const app = express();
const streamSources=new Map<string,{videoId:string;source:string}>();
app.get('/api/ytmusic/bridge/stream-source',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({enabled:true,...streamSources.get(getSessionId(req))});});
app.use(express.json());
let timingReports = 0;
let startupReports = 0;
app.post('/api/ytmusic/bridge/playback-timing', (req, res) => {
  const { trace, event, elapsedMs, readyState, networkState, bufferedSeconds, mediaError } = req.body || {};
  const startupReport = event === 'startup_fallback' || event === 'startup_timeout'
    || (event === 'playing' && typeof elapsedMs === 'number' && elapsedMs >= 2_500);
  const ios = /iPhone|iPad|iPod|Macintosh.*Mobile/.test(req.get('User-Agent') || '');
  if (process.env.SONORA_DEBUG_PLAYBACK !== 'true' && !(startupReport && ios)) return res.sendStatus(204);
  if (typeof trace !== 'string' || !/^[a-z0-9]{1,48}$/i.test(trace)
    || (!startupReport && !['load_start','assign_src','loadstart','loadedmetadata','canplay','playing','waiting','stalled','error'].includes(event))
    || !Number.isFinite(elapsedMs) || elapsedMs < 0) return res.sendStatus(400);
  const allowed = (number: unknown, max: number) => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= max ? number : undefined;
  if (startupReport ? startupReports++ < 120 : timingReports++ < 2000) {
    console.log(startupReport ? '[playback startup]' : '[playback timing]', JSON.stringify({
      time: new Date().toISOString(), side: 'phone', trace, event, elapsedMs,
      readyState: allowed(readyState, 4), networkState: allowed(networkState, 3),
      bufferedSeconds: allowed(bufferedSeconds, 86400), mediaError: allowed(mediaError, 4),
    }));
  }
  res.sendStatus(204);
});

const VALID_YT_VIDEO_ID = /^[\w-]{11}$/;
const DEBUG_PERF = process.env.SONORA_DEBUG_PERF === 'true';
// One process-wide pool, independent of optional progress IDs or browser sessions.
// Bound simultaneous extractors and encoders while keeping bulk requests queued.
// Hold slots through finalization, response streaming, and artifact disposal.
const MAX_CONCURRENT_DIRECT_DOWNLOADS = 4;
const transferSlots = new TransferSlots(4);
const directSlots = new TransferSlots(MAX_CONCURRENT_DIRECT_DOWNLOADS,64);
const streamSlots=new TransferSlots(6,32);
const mp3Ranges = new Mp3Ranges(streamSlots);

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

// Ordinary YouTube uploads, separate from the music catalog.
app.get('/api/youtube/search', async (req,res)=>{
 const query=String(req.query.q||'').trim();
 if(!query||query.length>200)return res.status(400).json({error:'Enter a search of up to 200 characters.'});
 try{res.json({songs:await searchYoutubeVideos(query)});}catch{res.status(502).json({error:'YouTube search is unavailable. Please try again.'});}
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


// Artist profiles and album track lists, separate from the user's saved library.
app.get('/api/ytmusic/browse/:browseId', async (req,res)=>{
  const id=req.params.browseId,continuation=typeof req.query.continuation==='string'?req.query.continuation:undefined;
  if(!/^(UC|MPRE|VL|FEmusic)[A-Za-z0-9_-]{1,156}$/.test(id)||(continuation&&(!/^[A-Za-z0-9_=%-]+$/.test(continuation)||continuation.length>4096)))return res.status(400).json({error:'Invalid catalog page'});
  try{res.json(await youtubeMusicClient.browse(id,continuation));}catch(error){res.status(502).json({error:'Could not load this catalog page',details:error instanceof Error?error.message:String(error)});}
});

// Song-seeded YouTube Music radio; independent of all playback/bridge sessions.
app.get('/api/ytmusic/radio/:videoId', async (req,res)=>{
  const {videoId}=req.params;
  if(!VALID_YT_VIDEO_ID.test(videoId))return res.status(400).json({error:'Invalid YouTube video ID'});
  try{res.json({source:'youtube-music-radio',songs:await youtubeMusicClient.radio(videoId)});}
  catch{res.status(502).json({error:'YouTube Music radio is unavailable for this song'});}
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

function getDownloadSessionId(req: express.Request): string | undefined {
  const id = req.headers['x-session-id'] ?? req.query.session;
  return typeof id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(id) && id !== 'default' ? id : undefined;
}

app.get('/api/ytmusic/download-status/:requestId', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!validDownloadRequestId(req.params.requestId)) return res.status(400).json({ error: 'Invalid download request identifier' });
  const session = getDownloadSessionId(req);
  if (!session) return res.status(400).json({ error: 'Invalid download session' });
  const state = readDownloadJob(req.params.requestId, session);
  if (!state) return res.status(404).json({ error: 'Download not found' });
  res.json(state);
});

// Prepare only the beginning of the upstream audio for subsequent MP3 playback.
app.get('/api/ytmusic/prefix/:videoId', (req, res) => {
  if (!res.locals.account) return res.sendStatus(401);
  void sendAudioPrefix(req, res, req.params.videoId);
});

app.get(['/api/ytmusic/stream/:videoId', '/api/ytmusic/download/:videoId'], async (req, res) => {
  const startedAt = Date.now();
  const trace=typeof req.query.trace==='string'&&/^[a-z0-9]{1,48}$/i.test(req.query.trace)?req.query.trace:'untraced';
  const timing=(event:string,extra:Record<string,unknown>={})=>{if(process.env.SONORA_DEBUG_PLAYBACK==='true')console.log('[playback timing]',JSON.stringify({side:'server',trace,event,elapsedMs:Date.now()-startedAt,...extra}));};
  let sentBytes=0;timing('request_received',{range:req.headers.range||null,ios:/iPhone|iPad|iPod/.test(req.headers['user-agent']||'')});
  res.once('close', () => {
    const ranged = res.get('Accept-Ranges') === 'bytes';
    const bytes = ranged ? (res.writableFinished ? Number(res.get('Content-Length') || 0) : undefined) : sentBytes;
    timing('response_closed', { sentBytes: bytes, finished: res.writableFinished });
  });
  const controller = new AbortController();
  let jobId: string | undefined;
  let releaseDownload:(()=>void)|undefined;
  let clientDisconnected=false,timedOut=false;
  const cancel = () => {
    if (!res.writableFinished) {
      clientDisconnected=true;
      controller.abort();
      if (jobId) updateDownloadJob(jobId, 'cancelled');
    }
  };
  res.on('close', cancel);
  const timeout = setTimeout(()=>{
    timedOut=true;
    controller.abort(Object.assign(new Error('Audio request exceeded the 10 minute timeout'),{code:'AUDIO_TIMEOUT',status:504}));
  },600000);
  const isDownload = req.path.includes('/download/');
  try {
    const { videoId } = req.params;
    if (!VALID_YT_VIDEO_ID.test(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }

    const startRaw = req.query.start;
    const start = startRaw === undefined ? 0 : typeof startRaw === 'string' && startRaw.trim() !== '' ? Number(startRaw) : NaN;
    if (!Number.isFinite(start) || start < 0) {
      return res.status(400).json({ error: 'Invalid start position' });
    }
    if (isDownload && start !== 0) return res.status(400).json({ error: 'Downloads require the full track from position zero' });
    res.setHeader('X-Audio-Start', String(start));
    res.setHeader('X-Audio-Via', isDownload ? 'sonora-direct-download' : 'sonora-yt-dlp-stream');

    const sessionId = getSessionId(req);
    const sourceState={videoId,source:'Connecting…'};
    if(!isDownload){streamSources.set(sessionId,sourceState);if(streamSources.size>512)streamSources.delete(streamSources.keys().next().value!);}
    if (isDownload) {
      releaseDownload = await directSlots.acquire(controller.signal);
      controller.signal.throwIfAborted();
    }
    if (isDownload && req.query.requestId !== undefined) {
      if (!validDownloadRequestId(req.query.requestId)) return res.status(400).json({ error: 'Invalid download request identifier' });
      const downloadSession = getDownloadSessionId(req);
      if (!downloadSession) return res.status(400).json({ error: 'A valid session is required for download progress' });
      beginDownloadJob(req.query.requestId, downloadSession);
      jobId = req.query.requestId;
    }


    const isIOS = /iPad|iPhone|iPod|Macintosh.*Mobile/.test(req.get('User-Agent') || '');
    const format = isDownload && req.query.format !== 'mp3' && !isIOS ? 'webm' : 'mp3';
    const mimeType = format === 'mp3' ? 'audio/mpeg' : 'audio/webm';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Audio-Format', format);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (isDownload) {
      // Exact-upload direct transfer only; no real-time capture or alternate-song fallback.
            const artifact = await directDownloader.download(videoId, controller.signal, format, state => {
              if (jobId && !controller.signal.aborted) reportDownloadJob(jobId, state);
            });
      const title = typeof req.query.title === 'string' ? req.query.title.slice(0, 100).trim() : videoId;
      const safeTitle = title.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || videoId;
      const ext = format === 'mp3' ? 'mp3' : 'webm';
      try {
        controller.signal.throwIfAborted();
        if (jobId) updateDownloadJob(jobId, 'waiting_transfer');
        const releaseTransfer = await transferSlots.acquire(controller.signal);
        try {
        controller.signal.throwIfAborted();
        if (jobId) updateDownloadJob(jobId, 'transferring');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`);
        res.setHeader('X-Audio-Complete', 'true');
        res.setHeader('X-Audio-Duration', String(artifact.duration));
        res.setHeader('Content-Length', String(artifact.size));
        res.status(200);
        await pipeline(createReadStream(artifact.path), res, { signal: controller.signal });
        } finally { releaseTransfer(); }
      } finally { await artifact.dispose(); }
      if(jobId)updateDownloadJob(jobId,'completed');
      return;
    }

    if (isIOS) {
      const key = JSON.stringify([res.locals.account?.uid, sessionId, videoId, start, trace]);
      if (await mp3Ranges.serve(key, videoId, start, req, res, controller.signal, () => {
        res.locals.audioStarted?.();
        sourceState.source = 'yt-dlp';
        timing('first_response_bytes', { transport: 'range' });
      })) return;
      timing('mp3_ranges_unavailable');
    }

    // The encoder supplies a live MP3 byte stream of unknown length. Seeking
    // outside the player's buffer uses the start position on a fresh request.
    res.setHeader('Accept-Ranges', 'none');
    if (req.method === 'HEAD') return res.end();

    timing('queue_enter');
    const release = await streamSlots.acquire(controller.signal);
    timing('queue_acquired');
    const direct = directStream(videoId, controller.signal, start, trace);
    try {
      // Wait for audio before committing headers so startup errors can return JSON.
      const first = await direct.next();
      if (first.done || !first.value?.length) throw new Error('Empty direct stream');
      const initial = first.value;
      res.setHeader('X-Accel-Buffering', 'no');
      res.socket?.setNoDelay(true);
      res.locals.audioStarted?.();
      timing('first_response_bytes');
      sourceState.source = 'yt-dlp';
      res.status(200);
      async function* chunks() {
        sentBytes += initial.length;
        yield initial;
        let milestone = 65536;
        for await (const chunk of direct) {
          sentBytes += chunk.length;
          if (sentBytes >= milestone) {
            timing('delivery_progress', { sentBytes });
            milestone *= 4;
          }
          yield chunk;
        }
      }
      await pipeline(Readable.from(chunks()), res, { signal: controller.signal });
    } finally {
      try { await direct.return(undefined); } finally { release(); }
    }
  } catch (err: any) {
    const failure=timedOut?controller.signal.reason:err;
    const routine=isRoutineAudioCancellation(failure,clientDisconnected,timedOut);
    if (jobId) updateDownloadJob(jobId, routine ? 'cancelled' : 'failed');
    if(routine){
      if(!res.destroyed){if(res.headersSent)res.destroy();else res.status(409).json({error:'audio_cancelled',details:'Playback request was cancelled.'});}
      return;
    }
    if(failure?.code!=='download_capacity_reached')console.error('YT Music bridge error:', failure);
    if (!res.headersSent && !res.destroyed) {
      res.removeHeader('Content-Disposition');
      res.removeHeader('X-Audio-Format');
      res.removeHeader('X-Audio-Complete');
      res.removeHeader('X-Audio-Duration');
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Range');
      res.type('application/json');
      res.status(failure?.status || 502).json({
        error: failure?.code || (isDownload ? 'direct_download_failed' : 'direct_stream_failed'),
        details: failure?.message,
      });
    }
  } finally {
    releaseDownload?.();
    clearTimeout(timeout);
    res.off('close', cancel);
  }
});


export default app;
