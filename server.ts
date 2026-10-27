import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import youtubeApi from './src/server/ytmusic/api.js';
import importRoutes from './src/server/import/importRoutes.js';
import { chromiumBridge } from './src/server/bridge/ChromiumBridge.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(express.json());

// Temporary bounded diagnostic output for iOS PWA controls. Accept only known,
// non-personal fields; keep at most 100 entries per server run.
let controlReports = 0;
app.post('/api/player-controls-diagnostic', (req, res) => {
  const { build, event, details, standalone } = req.body || {};
  if (!['track-controls-3', 'track-controls-4'].includes(build) || !['registered', 'command', 'unavailable', 'ended', 'play-error', 'playing', 'prepared', 'handoff', 'prepare-failed'].includes(event)) return res.sendStatus(400);
  const allowedKeys = ['play', 'pause', 'seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'action', 'queued', 'error', 'source', 'visibility', 'prepared'];
  const clean = Object.fromEntries(Object.entries(details || {}).filter(([key, value]) => allowedKeys.includes(key) && typeof value === 'string' && /^[a-zA-Z]{1,40}$/.test(value)));
  if (controlReports++ < 100) console.log('[player-controls]', JSON.stringify({ time: new Date().toISOString(), build, event, standalone: standalone === true, details: clean }));
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
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
  // Prepare one clean, unassigned player while the UI starts. A user adopts it
  // exclusively; no dummy song or personal browser profile is involved.
  void chromiumBridge.warmup().catch(error => console.warn('[bridge] Startup warmup failed:', error.message));
  if (process.env.NODE_ENV !== 'production') {
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
    console.log(`Music Player server listening at http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
