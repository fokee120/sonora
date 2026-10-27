import { parseYtmPlaylistResponse } from '../../lib/playlistImport.js';
import express from 'express';
import { spotifyIntegration, fetchSpotifyPlaylist, fetchPublicSpotifyPlaylist } from './spotify.js';

/**
 * Playlist import endpoints (persistent host only; Vercel
 * serverless functions cannot hold the account store file, and
 * Spotify client credentials live on the host, not in the client).
 *
 *  POST /api/import/spotify  { id }  -> Spotify playlist payload
 *    Requires the browser's connected Spotify session (PKCE).
 *    App setup uses a client ID and exact redirect URI; no secret.
 *  POST /api/import/ytmusic  { id }  -> { title, raw }
 *    Public YouTube Music / YouTube playlists via InnerTube
 *    browse (same unauthenticated WEB_REMIX client as search).
 *    The client parses `raw` with parseYtmPlaylistResponse().
 *  POST /api/accounts/sync   { profile, preferences }
 *  GET  /api/accounts/:uid
 */

const app = express();
app.use(express.json());
app.use(spotifyIntegration.router);

const INNERTUBE_HOST = 'https://music.youtube.com';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_42DE';

app.post('/api/import/spotify', async (req, res) => {
  const id = String(req.body?.id || '').trim();
  if (!/^[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: 'A Spotify playlist id is required' });
  try {
    try {
      const token = await spotifyIntegration.getAccessToken(req);
      return res.json(await fetchSpotifyPlaylist(id, token));
    } catch (error: any) {
      if (![401, 403, 404].includes(error.status)) throw error;
      // Only public metadata is read here; private API access is never assumed.
      return res.json(await fetchPublicSpotifyPlaylist(id));
    }
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
    const timeout = setTimeout(() => controller.abort(), 120000);
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
      const pages:any[]=[raw];
      const continuation=(node:any):string|undefined=>{if(!node||typeof node!=='object')return; const token=node.nextContinuationData?.continuation||node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;if(token)return token; for(const value of Object.values(node)){const found=continuation(value);if(found)return found;}};
      let token=continuation(raw);const visited=new Set<string>();
      while(token){if(visited.has(token))throw Error('YouTube repeated a playlist page; retry the sync');if(visited.size>=500)throw Error('Playlist exceeds the supported pagination window');visited.add(token);const next=await fetch(`${INNERTUBE_HOST}/youtubei/v1/browse?key=${INNERTUBE_KEY}&prettyPrint=false`,{method:'POST',headers:{'Content-Type':'application/json',Origin:INNERTUBE_HOST,Referer:`${INNERTUBE_HOST}/`,'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36'},body:JSON.stringify({context:{client:{clientName:'WEB_REMIX',clientVersion:'1.20240401.01.00',hl:'en',gl:'US'}},continuation:token}),signal:controller.signal});if(!next.ok)throw Error(`YouTube continuation failed (${next.status})`);const page=await next.json();pages.push(page);token=continuation(page);}
      const title =
        raw?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text ||
        raw?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.title ||
        'YouTube Music playlist';
      res.json({ title, tracks: parseYtmPlaylistResponse(pages,id).tracks });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    const message = err?.name === 'AbortError' ? 'YouTube Music playlist fetch timed out' : err?.message || 'YouTube Music playlist fetch failed';
    res.status(502).json({ error: 'YouTube Music import failed', details: message });
  }
});

export default app;
