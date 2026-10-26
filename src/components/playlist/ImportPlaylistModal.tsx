import React, { useState } from 'react';
import { X, Link2, Loader2, Check, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import {
  parsePlaylistUrl,
  fetchImportedPlaylist,
  type ImportedPlaylist,
  type ImportedTrack,
} from '../../lib/playlistImport.js';
import { matchImportedTrack } from '../../lib/recommendations.js';
import { cachedSearchYoutubeMusic } from '../../lib/ytmusic/youtubeMusic.js';
import type { Track } from '../../types/index.js';

interface ImportPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'url' | 'fetched' | 'matching' | 'done';

/**
 * Import a playlist by URL, then match every entry to a playable
 * YouTube Music track. Matched tracks become a new Sonora playlist;
 * unmatched entries are listed by name and are never silently
 * replaced with a wrong song.
 */
export const ImportPlaylistModal: React.FC<ImportPlaylistModalProps> = ({ isOpen, onClose }) => {
  const { createPlaylist, addTracksToLibrary, navigate } = useApp();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('url');
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedPlaylist | null>(null);
  const [matched, setMatched] = useState<Track[]>([]);
  const [unmatched, setUnmatched] = useState<ImportedTrack[]>([]);
  const [progress, setProgress] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setPhase('url');
    setError(null);
    setImported(null);
    setMatched([]);
    setUnmatched([]);
    setProgress('');
    setCreatedId(null);
  };

  const handleFetch = async () => {
    const parsed = parsePlaylistUrl(url);
    if (!parsed) {
      setError('That does not look like a Spotify or YouTube Music playlist URL (or a playlist id).');
      return;
    }
    setError(null);
    setPhase('matching');
    setProgress('Fetching playlist…');
    try {
      const playlist = await fetchImportedPlaylist(parsed);
      setImported(playlist);
      setPhase('fetched');
      setProgress('');
    } catch (err: any) {
      setError(err?.message || 'Playlist import failed');
      setPhase('url');
    }
  };

  const handleMatch = async () => {
    if (!imported) return;
    setPhase('matching');
    setError(null);
    const found: Track[] = [];
    const missing: ImportedTrack[] = [];
    for (let i = 0; i < imported.tracks.length; i++) {
      const entry = imported.tracks[i];
      setProgress(`Matching ${i + 1} of ${imported.tracks.length}: ${entry.title} — ${entry.artist}`);
      try {
        const candidates = await cachedSearchYoutubeMusic(`${entry.title} ${entry.artist}`, 'songs');
        const best = matchImportedTrack(entry, candidates);
        if (best) found.push(best.track);
        else missing.push(entry);
      } catch {
        missing.push(entry);
      }
    }
    setMatched(found);
    setUnmatched(missing);
    setProgress('');
    setPhase('done');
  };

  const handleCreate = async () => {
    if (!imported || matched.length === 0) return;
    await addTracksToLibrary(matched);
    const playlist = await createPlaylist(
      imported.title,
      `Imported from ${imported.source} (${imported.sourceId}). ${unmatched.length} track(s) could not be matched.`,
      matched.map((t) => t.id)
    );
    setCreatedId(playlist.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-3xl bg-zinc-950 border border-zinc-800 shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2"><Link2 className="w-4 h-4 text-indigo-400" /> Import playlist by URL</h2>
            <p className="text-xs text-zinc-400 mt-1">
              Paste a Spotify or YouTube Music playlist link. Spotify imports need
              SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET on the Sonora host; YouTube Music
              public playlists need no extra setup.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {phase === 'url' || phase === 'matching' ? (
          <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/… or music.youtube.com/playlist?list=…"
              className="flex-1 px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600" />
            <button onClick={handleFetch} disabled={phase === 'matching' || !url.trim()}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5">
              {phase === 'matching' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Fetch
            </button>
          </div>
        ) : null}
        {progress && <p role="status" className="text-xs text-zinc-300">{progress}</p>}
        {error && <p role="alert" className="text-xs text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {error}</p>}

        {imported && phase !== 'matching' && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-300">
              <span className="font-semibold text-white">{imported.title}</span> — {imported.tracks.length} tracks from {imported.source}
            </p>
            {phase === 'fetched' && (
              <button onClick={handleMatch} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
                Match to playable tracks
              </button>
            )}
            {phase === 'done' && (
              <>
                <p className="text-xs text-zinc-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> {matched.length} matched · {unmatched.length} unmatched
                </p>
                {unmatched.length > 0 && (
                  <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                    <p className="text-[11px] font-semibold text-zinc-400 mb-1">Could not be matched (not added):</p>
                    <ul className="text-[11px] text-zinc-500 space-y-0.5">
                      {unmatched.slice(0, 20).map((t, i) => <li key={i}>{t.title} — {t.artist}</li>)}
                    </ul>
                  </div>
                )}
                {createdId ? (
                  <button onClick={() => { onClose(); navigate({ type: 'playlist', id: createdId }); }}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold">
                    Open imported playlist
                  </button>
                ) : (
                  <button onClick={handleCreate} disabled={matched.length === 0}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-40">
                    Create Sonora playlist ({matched.length} tracks)
                  </button>
                )}
                <button onClick={reset} className="ml-2 px-3 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-medium">Import another</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
