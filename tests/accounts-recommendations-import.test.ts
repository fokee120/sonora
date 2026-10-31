import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommaList, defaultPreferences, buildProfileFromFirebaseUser } from '../src/lib/accounts.js';
import { buildTaste } from '../src/lib/taste.js';
import { recommendFromLibrary, suggestedQueries, trackSimilarity, matchImportedTrack } from '../src/lib/recommendations.js';
import { parsePlaylistUrl, parseSpotifyPlaylistResponse, parseYtmPlaylistResponse } from '../src/lib/playlistImport.js';

test('accounts: comma lists dedupe and profile keeps createdAt', () => {
  assert.deepEqual(parseCommaList('jazz, soul, jazz , lo-fi'), ['jazz', 'soul', 'lo-fi']);
  const first = buildProfileFromFirebaseUser({ uid: 'u1', email: 'a@b.c', displayName: 'Enzo' });
  const second = buildProfileFromFirebaseUser({ uid: 'u1', email: 'a@b.c' }, first);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.displayName, 'Enzo');
  assert.equal(defaultPreferences().discovery, 'balanced');
});

test('taste: favorites outweigh plays, unknown artists are ignored', () => {
  const taste = buildTaste([
    { artist: 'Nujabes', source: 'play', playedAt: Date.now() },
    { artist: 'Nujabes', source: 'favorite' },
    { artist: 'Unknown Artist', source: 'favorite' },
    { artist: 'Khruangbin', source: 'playlist' },
  ]);
  assert.ok(taste.artistScores['Nujabes'] > taste.artistScores['Khruangbin']);
  assert.equal(taste.artistScores['Unknown Artist'], undefined);
  assert.equal(taste.topArtists[0].name, 'Nujabes');
});

test('recommendations: played tracks are excluded, liked artists rank first', () => {
  const tracks: any[] = [
    { id: 't1', title: 'A', artist: 'Nujabes', genre: 'jazz' },
    { id: 't2', title: 'B', artist: 'Khruangbin', genre: 'rock' },
    { id: 't3', title: 'C', artist: 'Someone Else', genre: 'pop' },
  ];
  const taste = buildTaste([{ artist: 'Nujabes', genre: 'jazz', source: 'favorite' }]);
  const recs = recommendFromLibrary(tracks, taste, {
    playedTrackIds: new Set(['t2']),
    favoriteTrackIds: new Set(),
  });
  assert.deepEqual(recs.map((r) => r.track.id), ['t1']);
  assert.ok(recs[0].reasons.join(' ').includes('Nujabes'));
  assert.deepEqual(suggestedQueries(taste, 2), ['Nujabes', 'jazz music']);
});

test('recommendations: import matching finds the right song, rejects wrong ones', () => {
  const candidates = [
    { title: 'Feather', artist: 'Nujabes' },
    { title: 'Aruarian Dance', artist: 'Nujabes' },
  ];
  assert.equal(matchImportedTrack({ title: 'Feather', artist: 'Nujabes' }, candidates)?.track.title, 'Feather');
  assert.equal(matchImportedTrack({ title: 'Completely Different Song', artist: 'Nobody' }, candidates), null);
  assert.ok(trackSimilarity({ title: 'Feather', artist: 'Nujabes' }, { title: 'Feather (Official Audio)', artist: 'Nujabes' }) >= 0.5);
});

test('playlist import: Spotify, YTM, and YouTube URLs parse; Spotify payload parses', () => {
  assert.deepEqual(parsePlaylistUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), { source: 'spotify', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.deepEqual(parsePlaylistUrl('spotify:playlist:abc123'), { source: 'spotify', id: 'abc123' });
  assert.deepEqual(parsePlaylistUrl('https://music.youtube.com/playlist?list=PL1234567890'), { source: 'ytmusic', id: 'PL1234567890' });
  assert.deepEqual(parsePlaylistUrl('https://www.youtube.com/playlist?list=PLxyz'), { source: 'youtube', id: 'PLxyz' });
  assert.equal(parsePlaylistUrl('not a playlist'), null);

  const spotify = parseSpotifyPlaylistResponse({
    name: 'Starry Night',
    tracks: { items: [
      { track: { name: 'Feather', artists: [{ name: 'Nujabes' }], album: { name: 'Modal Soul' }, duration_ms: 180000 } },
      { track: null },
    ] },
  }, 'abc');
  assert.equal(spotify.title, 'Starry Night');
  assert.equal(spotify.tracks.length, 1);
  assert.equal(spotify.tracks[0].durationSeconds, 180);

  const col = (texts: string[]) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs: texts.map((text) => ({ text })) } } });
  const shelfItem = { musicResponsiveListItemRenderer: { flexColumns: [col(['Feather']), col(['Nujabes', ' • ', '3:00'])] } };
  const ytmPayload: any = { musicPlaylistShelfRenderer: { contents: [shelfItem] } };
  const ytm = parseYtmPlaylistResponse(ytmPayload, 'PL1');
  assert.equal(ytm.tracks.length, 1);
  assert.equal(ytm.tracks[0].artist, 'Nujabes');
});
