import visualRoutes from './src/server/visualRoutes.js';
import {playbackRooms} from './src/server/accounts/PlaybackRooms.js';
import {playbackRouter} from './src/server/accounts/playbackRoutes.js';
import {VisitorAccess} from './src/server/admin/VisitorAccess.js';
import lyricsRoutes from './src/server/lyricsRoutes.js';
import express from 'express';
import googleLibrary,{requireAccount,authenticatedAccount} from './src/server/accounts/googleLibrary.js';
import path from 'path';
import dotenv from 'dotenv';
import youtubeApi from './src/server/ytmusic/api.js';
import { warmPlaybackWorker } from './src/server/bridge/YtDlpPool.js';
import { audioCacheGeneration } from './src/server/bridge/AudioPrefix.js';
import importRoutes from './src/server/import/importRoutes.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const app = express();
const visitorAccess = new VisitorAccess();
app.use('/api/presence',express.json({limit:'1kb'}));
// Record only failed or slow iOS starts. Capture requests rejected by account
// middleware too, and omit song IDs, cookies, session IDs, and signed URLs.
let audioStartupReports = 0;
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/ytmusic/stream/') || !/iPhone|iPad|iPod|Macintosh.*Mobile/.test(req.get('User-Agent') || '')) return next();
  const startedAt = Date.now();
  let firstByteMs: number | undefined;
  res.locals.audioStarted = () => { firstByteMs ??= Date.now() - startedAt; };
  res.once('close', () => {
    const elapsedMs = Date.now() - startedAt;
    if (audioStartupReports >= 120 || (res.statusCode < 400 && (firstByteMs ?? elapsedMs) < 2500)) return;
    const trace = typeof req.query.trace === 'string' && /^[a-z0-9]{1,48}$/i.test(req.query.trace) ? req.query.trace : undefined;
    const range = req.get('Range');
    audioStartupReports++;
    console.log('[playback startup]', JSON.stringify({
      time: new Date().toISOString(), trace, side: 'server',
      delivery: res.getHeader('Accept-Ranges') === 'bytes' ? 'mp3-ranged' : 'mp3',
      range: range && /^bytes=\d{0,12}-\d{0,12}$/.test(range) ? range : undefined,
      status: res.headersSent ? res.statusCode : undefined, firstByteMs, elapsedMs, completed: res.writableFinished,
    }));
  });
  next();
});
app.use(requireAccount);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/ytmusic/stream/')) return next();
  const account = res.locals.account as ReturnType<typeof authenticatedAccount>;
  if (!account) return res.sendStatus(401);
  const permitted = (current: ReturnType<typeof authenticatedAccount>) => {
    if (!current || current.uid !== account.uid) return false;
    if (!current.sharedPlayback) return true;
    const room = playbackRooms.room(account.uid);
    return room.owner === req.query.device && !room.transfer;
  };
  if (!permitted(account)) return res.status(409).json({ error: 'playback_on_another_device' });
  const timer = setInterval(() => { if (!permitted(authenticatedAccount(req))) res.destroy(); }, 1000);
  res.once('close', () => clearInterval(timer));
  next();
});
app.use(visitorAccess.middleware);
const adminApp = express();
adminApp.use(visitorAccess.adminRouter());
adminApp.listen(Number(process.env.SONORA_ADMIN_PORT || PORT + 2), '127.0.0.1');


app.use('/api/account',googleLibrary);
app.use('/api/playback',playbackRouter);
app.use(express.json());
app.use(lyricsRoutes);
app.use(visualRoutes);

// Temporary bounded diagnostic output for iOS PWA controls. Accept only known,
// non-personal fields; keep at most 100 entries per server run.
let controlReports = 0;
app.post('/api/player-controls-diagnostic', (req, res) => {
  const { build, event, details, standalone } = req.body || {};
  if (!['track-controls-3', 'track-controls-4', 'native-baseline-1', 'native-baseline-2'].includes(build) || !['registered', 'command', 'unavailable', 'ended', 'play-error', 'playing', 'prepared', 'handoff', 'prepare-failed'].includes(event)) return res.sendStatus(400);
  const allowedKeys = ['play', 'pause', 'seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'action', 'queued', 'error', 'source', 'visibility', 'prepared'];
  const clean = Object.fromEntries(Object.entries(details || {}).filter(([key, value]) => allowedKeys.includes(key) && typeof value === 'string' && /^[a-zA-Z]{1,40}$/.test(value)));
  if ((build.startsWith('native-baseline-') && controlReports++ < 400) || (!build.startsWith('native-baseline-') && controlReports++ < 100)) console.log('[player-controls]', JSON.stringify({ time: new Date().toISOString(), build, event, standalone: standalone === true, details: clean }));
  res.sendStatus(204);
});


app.get('/api/artwork', async (req, res) => {
  try {
    const url = new URL(String(req.query.url || ''));
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !/^((?:lh\d+|yt3)\.googleusercontent\.com|yt3\.ggpht\.com|i\.ytimg\.com)$/.test(url.hostname)) return res.sendStatus(400);
    const image = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!image.ok) return res.sendStatus(404);
    const type = image.headers.get('content-type') || '';
    if (!type.startsWith('image/') || Number(image.headers.get('content-length')) > 8 * 1024 * 1024) return res.sendStatus(415);
    const reader = image.body?.getReader();
    if (!reader) return res.sendStatus(502);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 8 * 1024 * 1024) { await reader.cancel(); return res.sendStatus(413); } chunks.push(part.value); }
    res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.concat(chunks));
  } catch { res.sendStatus(502); }
});


app.get('/api/library', (_req, res) => {
  res.json({ tracks: [], albums: [], artists: [], trackCount: 0 });
});

app.get('/api/native-resume-check', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(process.cwd(), 'public', 'native-audio-check.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    audioCacheGeneration,
    timestamp: new Date().toISOString(),
  });
});

// ----------------------------------------------------
// SONORA ACCOUNTS + PLAYLIST IMPORT ROUTES
// ----------------------------------------------------

app.use(importRoutes);

// ----------------------------------------------------
// YOUTUBE MUSIC INTEGRATION ROUTES
// ----------------------------------------------------

app.use(youtubeApi);

// ----------------------------------------------------
// VITE MIDDLEWARE & SERVER STARTUP
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // A new visit must see the current shell/worker. Versioned assets are precached
    // by the service worker, which also handles offline document navigation.
    app.use(express.static(distPath, {
      setHeaders(res, filePath) {
        if (/\.(?:html|webmanifest)$/.test(filePath) || /[\\/](?:sw|workbox-[^\\/]+)\.js$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
    // Missing API/asset/worker URLs must not receive HTML disguised as a success.
    app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
    app.get('*', (req, res) => {
      if (path.extname(req.path)) return res.sendStatus(404);
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    if (process.env.NODE_ENV === 'production') void warmPlaybackWorker();
    console.log(`Music Player server listening at http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
