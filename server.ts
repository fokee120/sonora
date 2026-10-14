import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { DriveMusicService } from './src/server/drive/DriveMusicService.js';
import { driveSessionStore } from './src/server/drive/DriveSessionStore.js';
import youtubeApi from './src/server/ytmusic/api.js';
import { chromiumBridge } from './src/server/bridge/ChromiumBridge.js';
import { Readable } from 'stream';

dotenv.config();

const PORT = 3000;
const app = express();

app.use(express.json());

const driveMusicService = new DriveMusicService();

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
// GOOGLE DRIVE AUDIO INTEGRATION ROUTES & SERVER-SIDE LOGIN
// ----------------------------------------------------

// Get active server-side Google Drive login session
app.get('/api/drive/session', (req, res) => {
  const session = driveSessionStore.getSession();
  if (session && session.accessToken) {
    res.json({
      connected: true,
      user: session.user,
      connectedAt: session.connectedAt,
      lastUsedAt: session.lastUsedAt,
    });
  } else {
    res.json({
      connected: false,
      user: null,
    });
  }
});

// Save or persist Google Drive login session on the server
app.post('/api/drive/session', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader?.replace(/^Bearer\s+/i, '').trim();
    const accessToken = req.body?.accessToken || tokenFromHeader;
    const user = req.body?.user;

    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required to establish server session' });
    }

    const session = driveSessionStore.saveSession(accessToken, user);
    res.json({
      success: true,
      connected: true,
      user: session.user,
      connectedAt: session.connectedAt,
    });
  } catch (err: any) {
    console.error('Error saving drive session on server:', err);
    res.status(500).json({ error: 'Failed to save drive session on server', details: err?.message });
  }
});

// Remove or disconnect Google Drive session from the server
app.delete('/api/drive/session', (req, res) => {
  driveSessionStore.clearSession();
  res.json({
    success: true,
    connected: false,
  });
});

// Scan Google Drive audio files and extract metadata
app.post('/api/drive/scan', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader?.replace(/^Bearer\s+/i, '').trim();
    const accessToken =
      req.body?.accessToken ||
      tokenFromHeader ||
      driveSessionStore.getAccessToken();
    const folderId = req.body?.folderId;

    if (!accessToken) {
      return res.status(401).json({
        error: 'Google Drive access token is required. Please sign in with Google.',
      });
    }

    const result = await driveMusicService.scanDriveMusic(accessToken, folderId);
    res.json(result);
  } catch (err: any) {
    console.error('Error scanning Google Drive:', err);
    res.status(500).json({
      error: 'Failed to scan Google Drive audio files',
      details: err?.message || String(err),
    });
  }
});

// Stream audio from Google Drive with full HTTP Range / scrubbing support
app.get('/api/drive/stream/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const token =
      (req.query.token as string) ||
      req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ||
      driveSessionStore.getAccessToken();

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }
    if (!token) {
      return res.status(401).json({ error: 'Access token required for Google Drive streaming' });
    }

    const rangeHeader = req.headers.range;
    const driveHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (rangeHeader) {
      driveHeaders['Range'] = rangeHeader;
    }

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: driveHeaders }
    );

    if (!driveRes.ok && driveRes.status !== 206) {
      const errText = await driveRes.text();
      return res.status(driveRes.status).send(errText);
    }

    res.status(driveRes.status);
    const forwardHeaders = [
      'content-range',
      'content-length',
      'content-type',
      'accept-ranges',
      'content-disposition',
    ];
    for (const [k, v] of driveRes.headers.entries()) {
      if (forwardHeaders.includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    }
    if (!res.getHeader('accept-ranges')) {
      res.setHeader('accept-ranges', 'bytes');
    }

    if (driveRes.body) {
      // @ts-ignore
      const stream = Readable.fromWeb ? Readable.fromWeb(driveRes.body as any) : Readable.from(driveRes.body as any);
      stream.pipe(res);
    } else {
      res.end();
    }
  } catch (err: any) {
    console.error('Error streaming from Google Drive:', err);
    res.status(500).json({ error: 'Failed to stream from Google Drive', details: err?.message });
  }
});

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
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
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
