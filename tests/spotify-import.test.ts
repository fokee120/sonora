import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { createSpotifyIntegration, fetchSpotifyPlaylist, parsePublicSpotifyPlaylist } from '../src/server/import/spotify.js';
import { parseSpotifyPlaylistResponse } from '../src/lib/playlistImport.js';

test('Spotify PKCE rejects forged callbacks, isolates browsers, and refreshes after a host restart', async () => {
  const previous = { id: process.env.SPOTIFY_CLIENT_ID, redirect: process.env.SPOTIFY_REDIRECT_URI };
  const storePath = path.join(mkdtempSync(path.join(tmpdir(), 'sonora-spotify-test-')), 'sessions.json');
  let challenge = '', tokenCalls = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    tokenCalls++;
    const body = new URLSearchParams(String(options?.body));
    assert.equal(body.get('client_id'), 'test-client');
    assert.equal(body.has('client_secret'), false);
    if (body.get('grant_type') === 'authorization_code') {
      assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), challenge);
      assert.equal(body.get('code'), 'test-code');
      return Response.json({ access_token: 'expired-fixture', refresh_token: 'refresh-fixture', expires_in: 0 });
    }
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'refresh-fixture');
    return Response.json({ access_token: 'renewed-fixture', expires_in: 3600 });
  };
  let integration = createSpotifyIntegration({ storePath, fetcher });
  const app = express();
  app.use((req, res, next) => integration.router(req, res, next));
  app.get('/api/test-token', async (req, res) => {
    try { res.json({ token: await integration.getAccessToken(req) }); }
    catch (error: any) { res.status(error.status || 500).json({ error: error.message }); }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.SPOTIFY_CLIENT_ID = 'test-client';
  process.env.SPOTIFY_REDIRECT_URI = `${base}/api/spotify/callback`;
  try {
    const login = await fetch(`${base}/api/spotify/login`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    const authorization = new URL(login.headers.get('location')!);
    assert.equal(authorization.origin, 'https://accounts.spotify.com');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('scope'), 'playlist-read-private playlist-read-collaborative');
    challenge = authorization.searchParams.get('code_challenge')!;
    const state = authorization.searchParams.get('state')!;
    const stateCookie = login.headers.get('set-cookie')!.split(';')[0];
    const callback = `${base}/api/spotify/callback?state=${state}&code=test-code`;
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(tokenCalls, 0);
    const accepted = await fetch(callback, { redirect: 'manual', headers: { cookie: stateCookie } });
    assert.equal(accepted.status, 302);
    assert.equal(accepted.headers.get('location'), '/?spotify=connected');
    const cookies = accepted.headers.getSetCookie();
    const sessionHeader = cookies.find(value => value.startsWith('sonora_spotify='))!;
    assert.match(sessionHeader, /HttpOnly/i);
    assert.match(sessionHeader, /SameSite=Lax/i);
    assert.doesNotMatch(sessionHeader, /expired-fixture|refresh-fixture/);
    const sessionCookie = sessionHeader.split(';')[0];
    assert.equal((await fetch(callback, { headers: { cookie: stateCookie } })).status, 400);
    assert.equal((await fetch(`${base}/api/test-token`)).status, 401);
    integration = createSpotifyIntegration({ storePath, fetcher });
    const renewed = await fetch(`${base}/api/test-token`, { headers: { cookie: sessionCookie } });
    assert.deepEqual(await renewed.json(), { token: 'renewed-fixture' });
    assert.equal(tokenCalls, 2);
    const status = await fetch(`${base}/api/spotify/status`, { headers: { cookie: sessionCookie } });
    assert.deepEqual(await status.json(), { configured: true, connected: true });
    assert.equal(status.headers.get('cache-control'), 'no-store');
  } finally {
    if (previous.id === undefined) delete process.env.SPOTIFY_CLIENT_ID; else process.env.SPOTIFY_CLIENT_ID = previous.id;
    if (previous.redirect === undefined) delete process.env.SPOTIFY_REDIRECT_URI; else process.env.SPOTIFY_REDIRECT_URI = previous.redirect;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Spotify imports renamed items, paginates all entries, and reads legacy payloads', async () => {
  for (const modern of [true, false]) {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input, options) => {
      const url = String(input); urls.push(url);
      assert.equal((options?.headers as any).Authorization, 'Bearer fixture');
      if (!url.includes('?')) return Response.json({ name: 'My playlist', [modern ? 'items' : 'tracks']: { total: 51 } });
      const count = new URL(url).searchParams.get('offset') === '0' ? 50 : 1;
      return Response.json({ items: Array.from({ length: count }, () => ({ [modern ? 'item' : 'track']: {
        name: 'Feather', artists: [{ name: 'Nujabes' }], duration_ms: 180000,
      } })) });
    };
    const playlist = parseSpotifyPlaylistResponse(await fetchSpotifyPlaylist('abc', 'fixture', fetcher), 'abc');
    assert.equal(playlist.tracks.length, 51);
    assert.equal(playlist.tracks[50].title, 'Feather');
    assert.equal(playlist.tracks[50].artist, 'Nujabes');
    assert.match(urls[1], modern ? /\/items\?/ : /\/tracks\?/);
    assert.match(urls[2], /offset=50/);
  }
});

test('restricted and incomplete Spotify playlists are errors, never empty successful imports', async () => {
  await assert.rejects(fetchSpotifyPlaylist('abc', 'fixture', async () => Response.json({ name: 'Restricted' })), /own or collaborate/);
  await assert.rejects(fetchSpotifyPlaylist('abc', 'fixture', async () => Response.json({}, { status: 403 })), /account is allowed/);
  await assert.rejects(fetchSpotifyPlaylist('abc', 'fixture', async () => Response.json({ items: { total: -1 } })), /invalid playlist count/);
  await assert.rejects(fetchSpotifyPlaylist('abc', 'fixture', async url => Response.json(String(url).includes('?') ? { items: [] } : { items: { total: 2 } })), /incomplete/);
});

test('public Spotify preview needs no login, keeps the limit warning, and rejects other/private pages', () => {
  const html = (entity: any) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;
  const entity = { type: 'playlist', id: 'abc', title: 'Free import', trackList: [
    { uri: 'spotify:track:one', title: 'Feather', subtitle: 'Nujabes', duration: 180000 },
    { uri: 'spotify:episode:two', title: 'Podcast' },
  ] };
  const result = parseSpotifyPlaylistResponse(parsePublicSpotifyPlaylist(html(entity), 'abc'), 'abc');
  assert.equal(result.title, 'Free import');
  assert.deepEqual(result.tracks, [{ title: 'Feather', artist: 'Nujabes', album: undefined, durationSeconds: 180 }]);
  assert.match(result.warning!, /only part of the playlist/);
  assert.match(result.warning!, /No Spotify login or Premium/);
  assert.throws(() => parsePublicSpotifyPlaylist(html(entity), 'wrong-id'), /public playlist preview/);
  assert.throws(() => parsePublicSpotifyPlaylist('<html>Private playlist</html>', 'abc'), /public playlist preview/);
  assert.throws(() => parsePublicSpotifyPlaylist(html({ ...entity, trackList: [] }), 'abc'), /contains no songs/);
});

test('Spotify pagination imports all 1201 songs without a Sonora size cap',async()=>{const playlist=await fetchSpotifyPlaylist('large','fixture',async input=>{const url=new URL(String(input));if(!url.search)return Response.json({name:'Large playlist',items:{total:1201}});const offset=Number(url.searchParams.get('offset'));return Response.json({items:Array.from({length:Math.min(50,1201-offset)},(_,i)=>({item:{name:'Song '+(offset+i),artists:[{name:'Artist'}]}}))});});const parsed=parseSpotifyPlaylistResponse(playlist,'large');assert.equal(parsed.tracks.length,1201);assert.equal(parsed.tracks[1200].title,'Song 1200');});
