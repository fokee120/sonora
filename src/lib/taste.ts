/**
 * Taste profile: a plain, testable summary of what a user actually
 * listens to, built from signals Sonora already records.
 *
 * Sources, in order of strength:
 *  - favourite (like)      weight 3
 *  - explicit preference   weight 2 (genre/artist the user typed in)
 *  - playlist membership   weight 1.5
 *  - play                  weight 1, decayed by age
 *
 * Nothing here invents taste from a PDF, a filename, or a guess:
 * every score traces back to a play, a like, a playlist, or an
 * explicit preference. A user with no signals gets an empty taste
 * profile, not a fabricated one.
 */

import type { AccountPreferences } from './accounts.js';

export type TasteSignalSource = 'play' | 'favorite' | 'playlist' | 'preference';

export interface TasteSignal {
  artist: string;
  genre?: string;
  source: TasteSignalSource;
  playedAt?: number;
}

export interface TasteProfile {
  artistScores: Record<string, number>;
  genreScores: Record<string, number>;
  topArtists: { name: string; score: number }[];
  topGenres: { name: string; score: number }[];
  signalCount: number;
}

const SOURCE_WEIGHT: Record<TasteSignalSource, number> = {
  favorite: 3,
  preference: 2,
  playlist: 1.5,
  play: 1,
};

/** Plays older than ~90 days count half; anything recent counts full. */
function recencyFactor(playedAt: number | undefined, now: number): number {
  if (!playedAt) return 1;
  const days = (now - playedAt) / 86_400_000;
  if (days <= 30) return 1;
  if (days <= 90) return 0.75;
  return 0.5;
}

function sortedScores(scores: Record<string, number>): { name: string; score: number }[] {
  return Object.entries(scores)
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score);
}

export function buildTaste(
  signals: TasteSignal[],
  preferences?: AccountPreferences | null,
  now: number = Date.now()
): TasteProfile {
  const artistScores: Record<string, number> = {};
  const genreScores: Record<string, number> = {};
  const add = (scores: Record<string, number>, key: string | undefined, weight: number) => {
    const name = (key || '').trim();
    if (!name || name === 'Unknown Artist') return;
    scores[name] = (scores[name] || 0) + weight;
  };

  for (const signal of signals) {
    const weight = SOURCE_WEIGHT[signal.source] * recencyFactor(signal.playedAt, now);
    add(artistScores, signal.artist, weight);
    add(genreScores, signal.genre, weight);
  }

  if (preferences) {
    for (const artist of preferences.favouriteArtists) add(artistScores, artist, SOURCE_WEIGHT.preference);
    for (const genre of preferences.favouriteGenres) add(genreScores, genre, SOURCE_WEIGHT.preference);
  }

  return {
    artistScores,
    genreScores,
    topArtists: sortedScores(artistScores).slice(0, 20),
    topGenres: sortedScores(genreScores).slice(0, 20),
    signalCount: signals.length,
  };
}

export function hasTaste(taste: TasteProfile): boolean {
  return taste.signalCount > 0 || taste.topArtists.length > 0 || taste.topGenres.length > 0;
}
