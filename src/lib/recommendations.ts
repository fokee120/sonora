/** Local taste scoring and search fallback for the unified Home discovery mix.
 * The main discovery source is song-seeded YouTube Music radio; these helpers
 * supplement it with unplayed library songs and handle unavailable radio seeds.
 */

import type { Track } from '../types/index.js';
import type { TasteProfile } from './taste.js';

export interface RecommendedTrack {
  track: Track;
  score: number;
  reasons: string[];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function scoreLibraryTrack(
  track: Track,
  taste: TasteProfile,
  opts: { playedTrackIds: Set<string>; favoriteTrackIds: Set<string> }
): RecommendedTrack {
  const reasons: string[] = [];
  let score = 0;
  const artistScore = taste.artistScores[track.artist] || 0;
  if (artistScore > 0) {
    score += artistScore * 3;
    reasons.push(`Because you listen to ${track.artist}`);
  }
  const genreScore = track.genre ? taste.genreScores[track.genre] || 0 : 0;
  if (genreScore > 0) {
    score += genreScore * 2;
    reasons.push(`Matches your ${track.genre} taste`);
  }
  if (opts.favoriteTrackIds.has(track.id)) {
    // Already liked: still show it, but don't let it crowd out discovery.
    score += 0.5;
    reasons.push('One of your liked songs');
  }
  return { track, score, reasons };
}

export function recommendFromLibrary(
  tracks: Track[],
  taste: TasteProfile,
  opts: { playedTrackIds: Set<string>; favoriteTrackIds: Set<string>; limit?: number }
): RecommendedTrack[] {
  const limit = opts.limit ?? 10;
  return tracks
    .filter((t) => !opts.playedTrackIds.has(t.id))
    .map((t) => scoreLibraryTrack(t, taste, opts))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Searches to run against YTM for suggested songs, best taste first. */
export function suggestedQueries(taste: TasteProfile, limit: number = 6): string[] {
  const queries: string[] = [];
  for (const artist of taste.topArtists.slice(0, 3)) queries.push(artist.name);
  for (const genre of taste.topGenres.slice(0, 3)) queries.push(`${genre.name} music`);
  return queries.slice(0, limit);
}

/** Token-overlap similarity in [0, 1] for import matching. */
export function trackSimilarity(
  a: { title: string; artist: string },
  b: { title: string; artist: string }
): number {
  const tokens = (s: string) => new Set(normalize(s).split(' ').filter(Boolean));
  const titleA = tokens(a.title);
  const titleB = tokens(b.title);
  if (titleA.size === 0 || titleB.size === 0) return 0;
  let overlap = 0;
  for (const token of titleA) if (titleB.has(token)) overlap++;
  const jaccard = overlap / new Set([...titleA, ...titleB]).size;
  const artistA = normalize(a.artist);
  const artistB = normalize(b.artist);
  const artistBonus = artistA && artistB && (artistA === artistB || artistA.includes(artistB) || artistB.includes(artistA)) ? 0.3 : 0;
  return Math.min(1, jaccard + artistBonus);
}

export function matchImportedTrack<T extends { title: string; artist: string; album?:string }>(
  imported: { title: string; artist: string; album?:string },
  candidates: T[],
  threshold: number = 0.5
): { track: T; score: number } | null {
  let best: { track: T; score: number } | null = null;
  for (const candidate of candidates) {
    let score = trackSimilarity(imported, candidate);
    if(!imported.artist?.trim()||imported.artist==='Unknown Artist'){
      const titleScore=trackSimilarity({title:imported.title,artist:''},{title:candidate.title,artist:''});
      if(titleScore<.8)continue;
      if(imported.album?.trim()){
        const albumScore=trackSimilarity({title:imported.album,artist:''},{title:candidate.album||'',artist:''});
        if(albumScore<.65)continue;
        score=titleScore*.75+albumScore*.25;
      }else score=titleScore;
    }
    if (score >= threshold && (!best || score > best.score)) best = { track: candidate, score };
  }
  return best;
}
