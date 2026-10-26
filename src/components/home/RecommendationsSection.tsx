import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { usePlayer } from '../../hooks/usePlayer.js';
import { TrackRow } from '../common/TrackRow.js';
import { dbService } from '../../lib/db.js';
import { buildTaste, hasTaste, type TasteSignal } from '../../lib/taste.js';
import { recommendFromLibrary, suggestedQueries } from '../../lib/recommendations.js';
import { cachedSearchYoutubeMusic } from '../../lib/ytmusic/youtubeMusic.js';
import type { Track } from '../../types/index.js';
import type { AccountPreferences } from '../../lib/accounts.js';
import { defaultPreferences } from '../../lib/accounts.js';

/**
 * Recommended for you (your library, scored by taste) plus
 * Suggested songs (YouTube Music catalog, searched by taste).
 *
 * The suggested-songs note is deliberately explicit: these are
 * taste-derived searches, not your signed-in YouTube Music home
 * feed. Sonora's bridge uses anonymous Chromium profiles, so
 * there is no YTM account session to read yet — see the Settings
 * note in SettingsView.
 */
export const RecommendationsSection: React.FC = () => {
  const { tracks, favorites, history, playlists } = useApp();
  const { playTrack, setQueue } = usePlayer();
  const [suggested, setSuggested] = useState<Track[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const taste = useMemo(() => {
    const byId = new Map<string, Track>(tracks.map((t) => [t.id, t] as [string, Track]));
    const signals: TasteSignal[] = [];
    for (const h of history) {
      const t = byId.get(h.trackId);
      if (t) signals.push({ artist: t.artist, genre: t.genre, source: 'play', playedAt: h.playedAt });
    }
    for (const id of favorites) {
      const t = byId.get(id);
      if (t) signals.push({ artist: t.artist, genre: t.genre, source: 'favorite' });
    }
    for (const playlist of playlists) {
      for (const id of playlist.trackIds) {
        const t = byId.get(id);
        if (t) signals.push({ artist: t.artist, genre: t.genre, source: 'playlist' });
      }
    }
    return { signals, byId };
  }, [tracks, favorites, history, playlists]);

  const [prefs, setPrefs] = useState<AccountPreferences>(defaultPreferences());
  useEffect(() => {
    let cancelled = false;
    void dbService.getSetting<AccountPreferences | null>('sonora:account:preferences', null).then((saved) => {
      if (!cancelled && saved) setPrefs(saved);
    });
    return () => { cancelled = true; };
  }, []);

  const tasteProfile = useMemo(() => buildTaste(taste.signals, prefs), [taste, prefs]);

  const recommended = useMemo(() => {
    if (!hasTaste(tasteProfile)) return [];
    return recommendFromLibrary(tracks, tasteProfile, {
      playedTrackIds: new Set(history.map((h) => h.trackId)),
      favoriteTrackIds: favorites,
      limit: 10,
    });
  }, [tracks, tasteProfile, history, favorites]);

  const refreshSuggested = async () => {
    if (!hasTaste(tasteProfile)) return;
    setIsSuggesting(true);
    setSuggestError(null);
    try {
      const queries = suggestedQueries(tasteProfile, 4);
      const seen = new Set(tracks.map((t) => t.id));
      const out: Track[] = [];
      for (const query of queries) {
        const results = await cachedSearchYoutubeMusic(query, 'songs');
        for (const track of results) {
          if (!seen.has(track.id) && !out.some((t) => t.id === track.id)) out.push(track);
        }
        if (out.length >= 12) break;
      }
      setSuggested(out.slice(0, 12));
    } catch (err: any) {
      setSuggestError(err?.message || 'Could not load suggested songs');
    } finally {
      setIsSuggesting(false);
    }
  };

  useEffect(() => {
    if (hasTaste(tasteProfile) && suggested.length === 0 && !isSuggesting) void refreshSuggested();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasteProfile]);

  if (!hasTaste(tasteProfile)) {
    return (
      <section className="space-y-3">
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" /> Recommended for you
        </h2>
        <div className="p-6 rounded-2xl glass-card text-center text-xs text-zinc-500">
          Play a few songs, like some, or set favourite genres/artists in Settings → Sonora Account,
          and recommendations will appear here. Nothing is guessed until then.
        </div>
      </section>
    );
  }

  const recommendedTracks = recommended.map((r) => r.track);

  return (
    <div className="space-y-8">
      {recommendedTracks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" /> Recommended for you
            </h2>
            <button
              onClick={() => { setQueue(recommendedTracks, recommendedTracks[0]); playTrack(recommendedTracks[0], recommendedTracks); }}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium"
            >
              Play all
            </button>
          </div>
          <div className="divide-y divide-white/5 rounded-2xl glass-card p-1">
            {recommended.map((r, idx) => (
              <div key={`rec-${r.track.id}`}>
                <TrackRow track={r.track} index={idx} tracksContext={recommendedTracks} />
                {r.reasons.length > 0 && (
                  <p className="text-[11px] text-zinc-500 px-4 pb-2 -mt-1">{r.reasons.join(' · ')}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white tracking-tight">Suggested songs</h2>
          <button onClick={refreshSuggested} disabled={isSuggesting}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${isSuggesting ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">
          From your Sonora taste (plays, likes, playlists, preferences), searched on YouTube Music.
          This is not your signed-in YouTube Music home feed — the bridge uses anonymous sessions,
          so that feed is not connected yet.
        </p>
        {suggestError && <p role="alert" className="text-xs text-rose-400">{suggestError}</p>}
        {suggested.length > 0 && (
          <div className="divide-y divide-white/5 rounded-2xl glass-card p-1">
            {suggested.map((track, idx) => (
              <TrackRow key={`sug-${track.id}`} track={track} index={idx} tracksContext={suggested} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
