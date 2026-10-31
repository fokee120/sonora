import { getDB, dbService } from './db.js';
import type { Track } from '../types/index.js';

export function highQualityArtwork(url?: string): string {
  if (!url) return '/icon.svg';
  try {
    const parsed = new URL(url);
    if (/^((?:lh\d+|yt3)\.googleusercontent\.com|yt3\.ggpht\.com)$/.test(parsed.hostname)) {
      return url.replace(/=(?:w\d+|s\d+)[^?]*/, '=w1200-h1200-l90-rj');
    }
    if (parsed.hostname === 'i.ytimg.com') return url.replace(/\/(?:hqdefault|mqdefault|default)\.(jpg|webp)/, '/maxresdefault.$1');
  } catch {}
  return url;
}
const pending = new Map<string, Promise<Blob | null>>();
let activeArtwork = 0;
const artworkWaiters: Array<() => void> = [];
async function limitedArtwork<T>(work: () => Promise<T>): Promise<T> {
  if (activeArtwork >= 3) await new Promise<void>(resolve => artworkWaiters.push(resolve)); else activeArtwork++;
  try { return await work(); } finally { const next = artworkWaiters.shift(); if (next) next(); else activeArtwork--; }
}
export async function readArtwork(id: string): Promise<Blob | null> {
  const record = await (await getDB()).get('artworks', `hq:${id}`);
  return record?.bytes ? new Blob([record.bytes], { type: record.mimeType }) : record?.blob ?? null;
}
export function cacheArtwork(track: Pick<Track, 'id' | 'artworkUrl'>): Promise<Blob | null> {
  if (!track.artworkUrl) return Promise.resolve(null);
  if (pending.has(track.id)) return pending.get(track.id)!;
  const load = async () => {
    const db = await getDB();
    const previous = await db.get('artworks', `hq:${track.id}`);
    const source = highQualityArtwork(track.artworkUrl);
    if ((previous?.bytes?.byteLength || previous?.blob?.size) && previous?.sourceUrl === source) return readArtwork(track.id);
    for (const url of [...new Set([source, track.artworkUrl!])]) {
      try {
        const host = new URL(url, location.href).hostname;
        const trusted = /^((?:lh\d+|yt3)\.googleusercontent\.com|yt3\.ggpht\.com|i\.ytimg\.com)$/.test(host);
        const response = await fetch(trusted ? `/api/artwork?url=${encodeURIComponent(url)}` : url, { signal: AbortSignal.timeout(12000) });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) continue;
        const blob = await response.blob();
        if (!blob.size || blob.size > 8 * 1024 * 1024) continue;
        // Decode before storing: a 200 response may still be an error image/page.
        const image = new Image(), objectUrl = URL.createObjectURL(blob);
        try { image.src = objectUrl; await image.decode(); if (!image.naturalWidth) continue; }
        finally { URL.revokeObjectURL(objectUrl); }
        // Store in-memory bytes rather than a network-backed Blob/File. Safari
        // can reject those temporary file handles when IndexedDB serializes them.
        await db.put('artworks', { id: `hq:${track.id}`, bytes: await blob.arrayBuffer(), mimeType: blob.type, cachedAt: Date.now(), sourceUrl: url });
        window.dispatchEvent(new CustomEvent('sonora:artwork-saved', { detail: track.id }));
        return blob;
      } catch (error) { console.debug('Artwork cache failed:', error); }
    }
    return readArtwork(track.id);
  };
  const task = limitedArtwork(load).finally(() => pending.delete(track.id));
  pending.set(track.id, task);
  return task;
}
export async function repairDownloadedArtwork(tracks: Track[]) {
  const downloads = await dbService.getCompletedDownloads();
  const ids = new Set(downloads.map(item => item.trackId));
  let saved = 0, failed = 0;
  for (const track of tracks.filter(track => ids.has(track.id))) {
    if (await cacheArtwork(track)) saved++; else failed++;
  }
  return { saved, failed };
}
