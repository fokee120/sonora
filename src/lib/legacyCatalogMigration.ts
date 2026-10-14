import { getDB } from './db.js';

// Exact IDs from the retired bundled catalog. Never match a prefix, artist or source:
// users may have their own legacy cloud tracks and downloaded files.
const legacyIds = new Set([
  'demo-sample-m4a',
  'demo-sade-smooth-operator',
  'demo-sinatra-strangers-in-the-night',
  'demo-sinatra-summer-wind',
  'demo-chopin-nocturne',
  'demo-debussy-clair-de-lune',
  'demo-vivaldi-spring',
]);

export async function migrateLegacyCatalog(): Promise<void> {
  const db = await getDB();
  // Deliberately excludes downloads, audioBlobs, playlists, favorites and history.
  const tx = db.transaction(['tracks', 'albums', 'artists'], 'readwrite');
  const tracks = await tx.objectStore('tracks').getAll();
  const removed = tracks.filter(track => legacyIds.has(track.id));
  const retained = tracks.filter(track => !legacyIds.has(track.id));
  for (const track of removed) await tx.objectStore('tracks').delete(track.id);
  for (const album of await tx.objectStore('albums').getAll()) {
    const ids = album.tracks?.map(track => track.id) || [];
    if (!ids.some(id => legacyIds.has(id))) continue;
    const remaining = ids.filter(id => !legacyIds.has(id));
    if (!remaining.length) await tx.objectStore('albums').delete(album.id);
    else await tx.objectStore('albums').put({ ...album, tracks: album.tracks?.filter(track => !legacyIds.has(track.id)), trackCount: remaining.length });
  }
  for (const artist of await tx.objectStore('artists').getAll()) {
    if (removed.some(track => track.artist === artist.name) && !retained.some(track => track.artist === artist.name)) {
      await tx.objectStore('artists').delete(artist.id);
    }
  }
  await tx.done;
  // Remove retired local account credentials only. Google OAuth keys are untouched.
  try {
    localStorage.removeItem('music_auth_token');
    localStorage.removeItem('music_auth_user');
  } catch { /* Storage can be disabled by browser policy. */ }
}
