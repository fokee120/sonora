import { startImport } from '../../lib/importJobs.js';
import React, { useEffect, useId, useState } from 'react';
import { Overlay } from '../common/Overlay.js';
import { X, Link2, Loader2, Check, AlertCircle, FileUp } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import {
  parsePlaylistUrl,
  fetchImportedPlaylist,
  type ImportedPlaylist,
  type ImportedTrack,
  parsePlaylistFile,
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
  const [url, setUrl] = useState(() => sessionStorage.getItem('sonora:import-url') || '');
  const [phase, setPhase] = useState<Phase>('url');
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedPlaylist | null>(null);
  const [matched, setMatched] = useState<Track[]>([]);
  const [unmatched, setUnmatched] = useState<ImportedTrack[]>([]);
  const [progress, setProgress] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const titleId = useId();
  const [spotify, setSpotify] = useState<{ configured: boolean; connected: boolean } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const result = new URLSearchParams(location.search).get('spotify');
    if (result) {
      if (result === 'cancelled') setError('Spotify connection was cancelled. You can connect again.');
      const clean = new URL(location.href); clean.searchParams.delete('spotify');
      history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    }
    let active = true;
    void fetch('/api/spotify/status').then(response => response.ok ? response.json() : null)
      .then(value => { if (active) setSpotify(value); }).catch(() => {});
    return () => { active = false; };
  }, [isOpen]);

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
      if(parsed.source==='spotify'){setProgress('Importing songs by title and artist…');const created=await createPlaylist(playlist.title,playlist.description||'Imported from Spotify');await startImport(created.id,playlist);navigate({type:'playlist',id:created.id});onClose();reset();return;}
      setImported(playlist);
      setPhase('fetched');
      setProgress('');
    } catch (err: any) {
      setError(err?.message || 'Playlist import failed');
      setPhase('url');
    }
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setError(null); setPhase('matching'); setProgress('Reading playlist file…');
    try { const playlist = await parsePlaylistFile(file); setImported(playlist); setPhase('fetched'); setProgress(''); }
    catch (err: any) { setError(err?.message || 'Could not read that playlist file.'); setPhase('url'); setProgress(''); }
  };

  const handleMatch = async () => {
    if (!imported) return;
    setPhase('matching');
    try {const playlist = await createPlaylist(imported.title, imported.description || `Imported from ${imported.source}`);
    await startImport(playlist.id,imported);
    navigate({type:'playlist',id:playlist.id}); onClose();reset();}
    catch(error){setError(error instanceof Error?error.message:String(error));setPhase('fetched');}
  };

  const handleCreate = async () => {
    if (!imported || matched.length === 0) return;
    await addTracksToLibrary(matched);
    const playlist = await createPlaylist(
      imported.title,
      `Imported from ${imported.source} (${imported.sourceId}). ${unmatched.length} track(s) could not be matched.${imported.warning ? ' Public preview; playlist completeness is not verified.' : ''}`,
      matched.map((t) => t.id)
    );
    setCreatedId(playlist.id);
  };

  return (
    <Overlay isOpen={isOpen} onClose={onClose} label="Import playlist">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 id={titleId} className="text-base font-bold text-white flex items-center gap-2"><Link2 className="w-4 h-4 text-indigo-400" /> Import playlist</h2>
            <p className="text-xs text-zinc-400 mt-1">
              Paste a public Spotify or YouTube Music link, or import a local JSON/CSV file. Local files stay on this device.
            </p>
          </div>
          <button aria-label="Close import" onClick={onClose} className="shrink-0 p-1 text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {spotify && !spotify.connected && <div className="text-xs text-zinc-400">
          {spotify.configured ? <a href="/api/spotify/login" onClick={() => sessionStorage.setItem('sonora:import-url', url)} className="font-semibold text-emerald-400">Connect Spotify</a>
            : <p>Public Spotify playlists import directly. No Spotify login, Premium, or developer setup required.</p>}
        </div>}
        {phase === 'url' || phase === 'matching' ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <input aria-label="Playlist URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Spotify or YouTube Music playlist link"
              className="min-w-0 flex-1 px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-base sm:text-sm text-zinc-100 placeholder:text-zinc-600" />
            <button onClick={handleFetch} disabled={phase === 'matching' || !url.trim()}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5">
              {phase === 'matching' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Fetch
            </button>
          </div>
        ) : null}
        {(phase === 'url' || phase === 'matching') && <div className="flex items-center gap-3"><label className="action-button cursor-pointer"><FileUp size={17} /> Choose JSON/CSV file<input className="sr-only" type="file" accept=".json,.csv,.tsv,application/json,text/csv" onChange={e => void handleFile(e.target.files?.[0])} /></label><span className="text-[11px] text-zinc-500">JSON, CSV, or TSV</span></div>}
        {progress && <p role="status" className="text-xs text-zinc-300">{progress}</p>}
        {error && <p role="alert" className="text-xs text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {error}</p>}

        {imported && phase !== 'matching' && (
          <div className="space-y-3">
            {imported.warning && <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{imported.warning}</p>}
            <p className="text-xs text-zinc-300">
              <span className="font-semibold text-white">{imported.title}</span> — {imported.tracks.length} tracks from {imported.source}
            </p>
            {phase === 'fetched' && (
              <button onClick={handleMatch} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
                Import in background
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
    </Overlay>
  );
};
