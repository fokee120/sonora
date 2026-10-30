import express, { type Request } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type Session = { accessToken: string; refreshToken: string; expiresAt: number; validUntil: number };
type Pending = { verifier: string; expiresAt: number };
const cookie = (req: Request, name: string) => req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
const fail = (message: string, status = 502) => Object.assign(new Error(message), { status });
const configuration = () => ({ id: process.env.SPOTIFY_CLIENT_ID?.trim(), redirect: process.env.SPOTIFY_REDIRECT_URI?.trim() });

// PKCE needs a client ID, never a client secret. OAuth tokens stay on the host;
// this browser receives only a random, HttpOnly session cookie.
export function createSpotifyIntegration(options: { fetcher?: typeof fetch; storePath?: string } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const storePath = options.storePath ?? path.join(process.cwd(), '.sonora', 'spotify-sessions.json');
  const sessions = new Map<string, Session>();
  const pending = new Map<string, Pending>();
  const refreshes = new Map<string, Promise<string>>();
  try {
    const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    for (const [id, session] of Object.entries(saved) as [string, Session][]) {
      if (session.validUntil > Date.now() && session.refreshToken) sessions.set(id, session);
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') console.warn('Could not restore Spotify sessions. Reconnect Spotify.');
  }
  const persist = () => {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const temporary = `${storePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
    fs.renameSync(temporary, storePath);
  };
  const tokenRequest = async (parameters: Record<string, string>) => {
    const response = await fetcher('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json() as any;
    if (!response.ok || !data.access_token) throw fail('Spotify connection expired or was refused. Connect Spotify again.', 401);
    return data;
  };
  const getAccessToken = async (req: Request): Promise<string> => {
    const sid = cookie(req, 'sonora_spotify');
    const session = sid ? sessions.get(sid) : undefined;
    if (!sid || !session || session.validUntil < Date.now()) throw fail('Connect Spotify in the import window before importing a Spotify playlist.', 401);
    if (session.expiresAt > Date.now() + 60000) return session.accessToken;
    if (!refreshes.has(sid)) {
      const refresh = async () => {
        const config = configuration();
        if (!config.id) throw fail('Spotify connection is not configured on this Sonora host.', 503);
        const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: config.id });
        session.accessToken = data.access_token;
        session.refreshToken = data.refresh_token || session.refreshToken;
        session.expiresAt = Date.now() + Number(data.expires_in ?? 3600) * 1000;
        persist();
        return session.accessToken;
      };
      refreshes.set(sid, refresh().finally(() => refreshes.delete(sid)));
    }
    return refreshes.get(sid)!;
  };
  const router = express.Router();
  router.use('/api/spotify', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/api/spotify/status', (req, res) => {
    const config = configuration();
    const session = sessions.get(cookie(req, 'sonora_spotify') || '');
    res.json({ configured: Boolean(config.id && config.redirect), connected: Boolean(session && session.validUntil > Date.now()) });
  });
  router.get('/api/spotify/login', (req, res) => {
    const config = configuration();
    if (!config.id || !config.redirect) return res.status(503).json({ error: 'Spotify connection needs host setup: SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI. A client secret is not required.' });
    let redirect: URL;
    try { redirect = new URL(config.redirect); } catch { return res.status(503).json({ error: 'Spotify redirect address is invalid.' }); }
    if (redirect.protocol !== 'https:' && !['127.0.0.1', '[::1]'].includes(redirect.hostname)) return res.status(503).json({ error: 'Spotify requires HTTPS or a loopback redirect address.' });
    if (req.get('host') !== redirect.host) return res.status(400).json({ error: `Open Sonora at ${redirect.origin} to connect Spotify.` });
    for (const [key, value] of pending) if (value.expiresAt < Date.now()) pending.delete(key);
    const state = randomBytes(32).toString('hex'), verifier = randomBytes(64).toString('base64url');
    pending.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.cookie('sonora_spotify_state', state, { httpOnly: true, secure: redirect.protocol === 'https:', sameSite: 'lax', path: '/api/spotify', maxAge: 600000 });
    const authorization = new URL('https://accounts.spotify.com/authorize');
    authorization.search = new URLSearchParams({ client_id: config.id, response_type: 'code', redirect_uri: config.redirect,
      scope: 'playlist-read-private playlist-read-collaborative', state,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    res.redirect(authorization.href);
  });
  router.get('/api/spotify/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const request = pending.get(state);
    const config = configuration();
    if (!request || request.expiresAt < Date.now() || cookie(req, 'sonora_spotify_state') !== state) return res.status(400).send('Spotify sign-in expired or could not be verified. Return to Sonora and connect again.');
    pending.delete(state);
    res.clearCookie('sonora_spotify_state', { path: '/api/spotify' });
    if (req.query.error || typeof req.query.code !== 'string') return res.redirect('/?spotify=cancelled');
    try {
      if (!config.id || !config.redirect) throw fail('Spotify host configuration is missing.', 503);
      const data = await tokenRequest({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: config.redirect,
        client_id: config.id, code_verifier: request.verifier });
      if (!data.refresh_token) throw fail('Spotify did not supply a renewable connection. Connect again.');
      const sid = randomBytes(32).toString('hex');
      sessions.set(sid, { accessToken: data.access_token, refreshToken: data.refresh_token,
        expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000, validUntil: Date.now() + 30 * 86400000 });
      persist();
      res.cookie('sonora_spotify', sid, { httpOnly: true, secure: new URL(config.redirect).protocol === 'https:', sameSite: 'lax', path: '/api', maxAge: 30 * 86400000 });
      res.redirect('/?spotify=connected');
    } catch (error: any) { res.status(error.status || 502).send('Could not connect Spotify. Return to Sonora and try again.'); }
  });
  return { router, getAccessToken };
}

export const spotifyIntegration = createSpotifyIntegration();

// Read only metadata published in Spotify's public embed. This is a preview,
// not the authenticated playlist API, and must never be labelled complete.
export function parsePublicSpotifyPlaylist(html: string, id: string) {
  const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  let entity: any;
  try { entity = JSON.parse(script?.[1] || '').props?.pageProps?.state?.data?.entity; } catch {}
  if (entity?.type !== 'playlist' || entity.id !== id || !Array.isArray(entity.trackList)) {
    throw fail('Spotify could not provide a public playlist preview. Check the link and make sure the playlist is public.', 422);
  }
  const items = entity.trackList.filter((track: any) => typeof track.title === 'string' && track.title.trim() && String(track.uri).startsWith('spotify:track:'))
    .map((track: any) => ({ item: { name: track.title, album:{name:track.album?.name||track.albumName||undefined}, artists: [{ name: track.subtitle || 'Unknown Artist' }], duration_ms: track.duration } }));
  if (!items.length) throw fail('This Spotify public preview contains no songs. Private playlists need a connected Spotify account.', 422);
  return { name: entity.title || entity.name || 'Spotify playlist', items: { items },
    warning: `Spotify's public preview supplied ${items.length} songs. This may be only part of the playlist; check the count before matching. No Spotify login or Premium is needed for this preview.` };
}

export async function fetchPublicSpotifyPlaylist(id: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`https://open.spotify.com/embed/playlist/${id}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw fail('Spotify could not load this public playlist preview. Check the link or try again later.', response.status === 404 ? 404 : 502);
  return parsePublicSpotifyPlaylist(await response.text(), id);
}

export async function fetchSpotifyPlaylist(id: string, token: string, fetcher: typeof fetch = fetch) {
  const get = async (endpoint: string) => {
    const response = await fetcher(`https://api.spotify.com/v1/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const message = response.status === 403 ? 'Spotify allows this app to read playlists you own or collaborate on. Check that your account is allowed in the Spotify app dashboard.'
        : response.status === 404 ? 'Spotify playlist not found or not accessible to your connected account.'
        : response.status === 401 ? 'Spotify connection expired. Connect Spotify again.'
        : response.status === 429 ? 'Spotify is busy. Please wait a little before importing again.' : 'Spotify could not load this playlist. Try again.';
      throw fail(message, [401, 403, 404, 429].includes(response.status) ? response.status : 502);
    }
    return await response.json() as any;
  };
  const meta = await get(`playlists/${id}`);
  const collection = meta.items ?? meta.tracks;
  if (!collection || typeof collection.total !== 'number') throw fail('Spotify did not share this playlist’s songs. Import a playlist you own or collaborate on.', 403);
  if(!Number.isSafeInteger(collection.total)||collection.total<0)throw fail('Spotify returned an invalid playlist count.',502);
  const items: any[] = [];
  const endpoint = meta.items ? 'items' : 'tracks';
  for (let offset = 0; offset < collection.total; offset += 50) {
    const page = await get(`playlists/${id}/${endpoint}?limit=50&offset=${offset}`);
    if (!Array.isArray(page.items)) throw fail('Spotify returned an incomplete playlist. Please try again.');
    items.push(...page.items);
  }
  if (items.length < collection.total) throw fail('Spotify returned an incomplete playlist. Please try again.');
  return { name: meta.name || 'Spotify playlist', items: { items } };
}
