import express from 'express';
import { accountStore } from '../accounts/AccountStore.js';

/**
 * Playlist import endpoints (persistent host only; Vercel
 * serverless functions cannot hold the account store file, and
 * Spotify client credentials live on the host, not in the client).
 *
 *  POST /api/import/spotify  { id }  -> Spotify playlist payload
 *    Requires SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET on the
 *    host. Without them: 501 with a setup message, never a
 *    fabricated track list.
 *  POST /api/import/ytmusic  { id }  -> { title, raw }
 *    Public YouTube Music / YouTube playlists via InnerTube
 *    browse (same unauthenticated WEB_REMIX client as search).
 *    The client parses `raw` with parseYtmPlaylistResponse().
 *  POST /api/accounts/sync   { profile, preferences }
 *  GET  /api/accounts/:uid
 */

const app = express();
app.use(express.json());

const INNERTUBE_HOST = 'https://music.youtube.com';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_42DE';

app.post('/api/accounts/sync', (req, res) => {
  const { profile, preferences } = req.body || {};
  if (!profile?.uid) return res.status(400).json({ error: 'profile.uid is required' });
  const record = accountStore.sync(profile.uid, profile, preferences);
  res.json({ ok: true, record });
});

app.get('/api/accounts/:uid', (req, res) => {
  const record = accountStore.get(req.params.uid);
  if (!record) return res.status(404).json({ error: 'No Sonora account record for this uid yet' });
  res.json(record);
});

async function spotifyAccessToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw Object.assign(new Error('Spotify import is not configured on this host: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.'), { status: 501 });
  }
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  const data: any = await res.json();
  if (!data.access_token) throw new Error('Spotify did not return an access token');
  return data.access_token;
}

app.post('/api/import/spotify', async (req, res) => {
  const id = String(req.body?.id || '').trim();
  if (!/^[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: 'A Spotify playlist id is required' });
  try {
    const token = await spotifyAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const metaRes = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=name,tracks(total)`, { headers });
    if (!metaRes.ok) {
      return res.status(metaRes.status === 404 ? 404 : 502).json({ error: 'Spotify playlist not found or not public', details: `Spotify returned ${metaRes.status}` });
    }
    const meta: any = await metaRes.json();
    const total = Math.min(meta?.tracks?.total || 0, 300);
    const items: any[] = [];
    for (let offset = 0; offset < total; offset += 100) {
      const pageRes = await fetch(
        `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&offset=${offset}&fields=items(track(name,artists(name),album(name),duration_ms))`,
        { headers }
      );
      if (!pageRes.ok) return res.status(502).json({ error: 'Spotify track fetch failed', details: `Spotify returned ${pageRes.status}` });
      const page: any = await pageRes.json();
      items.push(...(page.items || []));
    }
    res.json({ name: meta?.name || 'Spotify playlist', tracks: { items } });
  } catch (err: any) {
    const status = err?.status || 502;
    res.status(status).json({ error: 'Spotify import failed', details: err?.message || String(err) });
  }
});

app.post('/api/import/ytmusic', async (req, res) => {
  const id = String(req.body?.id || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'A YouTube Music playlist id is required' });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${INNERTUBE_HOST}/youtubei/v1/browse?key=${INNERTUBE_KEY}&prettyPrint=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Origin: INNERTUBE_HOST,
          Referer: `${INNERTUBE_HOST}/`,
        },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240401.01.00', hl: 'en', gl: 'US' } },
          browseId: `VL${id}`,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`YouTube Music returned HTTP ${response.status}`);
      const raw: any = await response.json();
      const title =
        raw?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text ||
        raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.title ||
        'YouTube Music playlist';
      res.json({ title, raw });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    const message = err?.name === 'AbortError' ? 'YouTube Music playlist fetch timed out' : err?.message || 'YouTube Music playlist fetch failed';
    res.status(502).json({ error: 'YouTube Music import failed', details: message });
  }
});

export default app;
