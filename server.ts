import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServer as createViteServer } from 'vite';
import { GCSStorageProvider } from './src/server/storage/GCSStorageProvider.js';
import {
  LibraryIndexer,
  DEMO_FALLBACK_TRACKS,
  DEMO_STREAM_FALLBACKS,
} from './src/server/libraryIndexer.js';
import { DriveMusicService } from './src/server/drive/DriveMusicService.js';
import { driveSessionStore } from './src/server/drive/DriveSessionStore.js';
import { Readable } from 'stream';

dotenv.config();

const PORT = 3000;
const app = express();

app.use(express.json());

// Initialize Google Cloud Storage & Indexer
const gcsProvider = new GCSStorageProvider();
const libraryIndexer = new LibraryIndexer(gcsProvider);
const driveMusicService = new DriveMusicService();

// Parse authorized emails from environment
const rawAuthorizedEmails = process.env.AUTHORIZED_EMAILS || 'fokee83@gmail.com';
const authorizedEmails = rawAuthorizedEmails
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const authSecret = process.env.AUTH_SECRET || process.env.SESSION_SECRET;

type AuthUserSession = { email: string; name: string; expiresAt: number };

// In-memory sessions (token -> user email). Used as a fallback when AUTH_SECRET is not configured.
const sessions = new Map<string, AuthUserSession>();

function signAuthPayload(payload: string) {
  if (!authSecret) return null;
  return createHmac('sha256', authSecret).update(payload).digest('base64url');
}

function createAuthToken(session: AuthUserSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = signAuthPayload(payload);
  if (signature) {
    return `tok_${payload}.${signature}`;
  }

  const token = 'tok_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  sessions.set(token, session);
  return token;
}

function verifySignedAuthToken(token: string): AuthUserSession | null {
  if (!authSecret || !token.startsWith('tok_')) return null;

  const [payload, signature] = token.slice(4).split('.');
  if (!payload || !signature) return null;

  const expectedSignature = signAuthPayload(payload);
  if (!expectedSignature) return null;

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as AuthUserSession;
    if (!session.email || !session.name || Date.now() > session.expiresAt) return null;
    if (authorizedEmails.length > 0 && !authorizedEmails.includes(session.email.toLowerCase())) return null;
    return session;
  } catch {
    return null;
  }
}

function verifyInMemoryAuthToken(token: string): AuthUserSession | null {
  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  if (authorizedEmails.length > 0 && !authorizedEmails.includes(session.email.toLowerCase())) {
    sessions.delete(token);
    return null;
  }

  return session;
}

// Simple auth middleware helper
function getAuthenticatedUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return verifySignedAuthToken(token) || verifyInMemoryAuthToken(token);
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    gcsConfigured: gcsProvider.isConfigured(),
    r2Configured: gcsProvider.isConfigured(), // Backward compatibility
  });
});

// Storage & GCS Config Status
app.get('/api/storage/status', async (req, res) => {
  try {
    const status = await gcsProvider.getStatus();
    const lastScanTime = libraryIndexer.getLastScanTime();
    const cachedResult = libraryIndexer.getCachedResult();

    res.json({
      gcsConfigured: status.isConfigured,
      r2Configured: status.isConfigured, // Backward compatibility alias
      provider: status.provider,
      bucket: status.bucketName,
      projectId: status.projectId,
      clientEmail: status.clientEmail,
      hasPrivateKey: status.hasPrivateKey,
      connected: status.connected,
      error: status.error,
      lastScanTime,
      trackCount: cachedResult ? cachedResult.trackCount : (status.isConfigured ? 0 : DEMO_FALLBACK_TRACKS.length),
      authorizedEmailsCount: authorizedEmails.length,
      authRequired: authorizedEmails.length > 0,
      corsConfig: {
        allowedOrigins: ['http://localhost:3000', 'https://*.vercel.app', '*'],
        allowedMethods: ['GET', 'HEAD'],
        responseHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type'],
        maxAgeSeconds: 3600,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve storage status', details: err?.message });
  }
});

// Rescan library endpoint
app.post('/api/storage/rescan', async (req, res) => {
  try {
    const prefix = typeof req.body?.prefix === 'string' ? req.body.prefix : 'music/';
    const result = await libraryIndexer.scanLibrary(prefix);
    res.json({
      success: true,
      message: 'Library rescanned successfully',
      result,
    });
  } catch (err: any) {
    console.error('Error in manual library rescan:', err);
    res.status(500).json({ error: 'Rescan failed', details: err?.message });
  }
});

// Programmatic CORS config endpoint
app.post('/api/storage/configure-cors', async (req, res) => {
  try {
    const result = await gcsProvider.configureCors();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message });
  }
});

// Auth endpoints
app.get('/api/auth/session', (req, res) => {
  const user = getAuthenticatedUser(req);
  res.json({
    user: user ? { email: user.email, name: user.name } : null,
    isAuthenticated: Boolean(user),
    authRequired: authorizedEmails.length > 0,
    authorizedEmails,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, name } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // If authorized emails are set, verify access
  if (authorizedEmails.length > 0 && !authorizedEmails.includes(normalizedEmail)) {
    return res.status(403).json({
      error: `Access denied. Email '${normalizedEmail}' is not in the AUTHORIZED_EMAILS list.`,
    });
  }

  const session = {
    email: normalizedEmail,
    name: name || normalizedEmail.split('@')[0],
    expiresAt: Date.now() + AUTH_SESSION_TTL_MS,
  };

  res.json({
    token: createAuthToken(session),
    user: {
      email: session.email,
      name: session.name,
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    sessions.delete(token);
  }
  res.json({ success: true });
});

// Library listing endpoint
app.get('/api/library', async (req, res) => {
  try {
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : 'music/';
    const result = await libraryIndexer.scanLibrary(prefix);
    res.json(result);
  } catch (err: any) {
    console.error('Error fetching library:', err);
    res.status(500).json({ error: 'Failed to scan music library', details: err?.message });
  }
});

// Signed stream URL endpoint
app.get('/api/tracks/:id/stream-url', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Track ID is required' });
    }

    // Decode ID (base64url) or check demo tracks
    let cloudKey = '';
    try {
      cloudKey = Buffer.from(id, 'base64url').toString('utf-8');
    } catch {
      cloudKey = '';
    }

    const demoTrack = DEMO_FALLBACK_TRACKS.find((t) => t.id === id || t.cloudKey === cloudKey);
    if (demoTrack) {
      cloudKey = demoTrack.cloudKey;
    }

    // Check if Google Drive track
    if (id.startsWith('gdrive:') || cloudKey.startsWith('gdrive://') || req.query.source === 'drive') {
      const driveFileId = cloudKey.startsWith('gdrive://')
        ? cloudKey.replace(/^gdrive:\/\//, '').split('/')[0]
        : id.replace(/^gdrive:/, '');
      const driveToken =
        (req.query.token as string) ||
        req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ||
        driveSessionStore.getAccessToken();

      return res.json({
        streamUrl: `/api/drive/stream/${encodeURIComponent(driveFileId)}${
          driveToken ? `?token=${encodeURIComponent(driveToken)}` : ''
        }`,
        cloudKey: cloudKey || `gdrive://${driveFileId}`,
        expiresInSeconds: 3600,
        expiresAt: Date.now() + 3600 * 1000,
        source: 'google_drive',
      });
    }

    if (!cloudKey) {
      return res.status(404).json({ error: 'Track not found' });
    }

    // Check if GCS is configured and generate real V4 signed GET URL
    if (gcsProvider.isConfigured()) {
      try {
        // V4 signed URL with 45 minutes expiry (between 30-60 mins as requested)
        const streamUrl = await gcsProvider.getSignedStreamUrl(cloudKey, 2700);
        return res.json({
          streamUrl,
          cloudKey,
          expiresInSeconds: 2700,
          expiresAt: Date.now() + 2700 * 1000,
          source: 'gcs',
        });
      } catch (gcsErr: any) {
        console.warn(`GCS signing failed for ${cloudKey}:`, gcsErr.message);
        // Fallback to demo audio if available
        if (DEMO_STREAM_FALLBACKS[cloudKey]) {
          return res.json({
            streamUrl: DEMO_STREAM_FALLBACKS[cloudKey],
            cloudKey,
            expiresInSeconds: 86400,
            expiresAt: Date.now() + 86400 * 1000,
            source: 'fallback',
          });
        }
        return res.status(500).json({ error: 'Failed to generate signed URL', details: gcsErr.message });
      }
    }

    // If GCS not yet configured, serve the high-fidelity demo track URL (e.g. real M4A or MP3)
    const fallbackUrl = DEMO_STREAM_FALLBACKS[cloudKey];
    if (fallbackUrl) {
      return res.json({
        streamUrl: fallbackUrl,
        cloudKey,
        expiresInSeconds: 86400,
        expiresAt: Date.now() + 86400 * 1000,
        source: 'fallback-demo',
      });
    }

    // If no fallback found
    res.status(404).json({
      error: 'Audio stream URL could not be resolved. Configure Google Cloud Storage credentials in Settings.',
    });
  } catch (err: any) {
    console.error('Error generating stream URL:', err);
    res.status(500).json({ error: 'Server error generating audio URL', details: err?.message });
  }
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

// Artwork signing / redirect endpoint
app.get('/api/artwork', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key || typeof key !== 'string') {
      return res.redirect('/icon.svg');
    }

    if (gcsProvider.isConfigured()) {
      try {
        const signedUrl = await gcsProvider.getSignedArtworkUrl(key, 3600);
        return res.redirect(signedUrl);
      } catch (err) {
        console.warn('Artwork signing error:', err);
      }
    }

    res.redirect('/icon.svg');
  } catch {
    res.redirect('/icon.svg');
  }
});

// ----------------------------------------------------
// VITE MIDDLEWARE & SERVER STARTUP
// ----------------------------------------------------
async function startServer() {
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
