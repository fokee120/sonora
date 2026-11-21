import React, { useEffect, useRef, useState } from 'react';
import { FileUp, Link2, Loader2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { startImport } from '../../lib/importJobs.js';
import { fetchImportedPlaylist, parsePlaylistFile, parsePlaylistUrl, type ImportedPlaylist } from '../../lib/playlistImport.js';
import { fetchYoutubeTrack } from '../../lib/ytmusic/youtubeMusic.js';
import type { Track } from '../../types/index.js';
import { Overlay } from '../common/Overlay.js';

const IMPORT_DRAFT = 'sonora:import-url';

function videoIds(input: string): string[] {
  const ids = new Set<string>();
  for (const text of input.trim().split(/[\s,]+/)) {
    if (/^[\w-]{11}$/.test(text)) {
      ids.add(text);
      continue;
    }
    try {
      const url = new URL(text);
      const host = url.hostname.replace(/^www\./, '');
      let id = '';
      if (host === 'youtu.be') id = url.pathname.split('/')[1];
      else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com') {
        if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
        else id = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})(?:\/|$)/)?.[1] || '';
      }
      if (/^[\w-]{11}$/.test(id)) ids.add(id);
    } catch { /* Ignore text that is neither a YouTube URL nor a video ID. */ }
  }
  return [...ids].slice(0, 40);
}

export function PlaylistImportForm({ onImported, onBusyChange, onVideos, initialTrackIds }: {
  onImported: () => void;
  onBusyChange: (busy: boolean) => void;
  onVideos?: (tracks: Track[]) => Promise<void>;
  initialTrackIds?: string[];
}) {
  const { createPlaylist, deletePlaylist, navigate } = useApp();
  const [url, setUrl] = useState(() => sessionStorage.getItem(IMPORT_DRAFT) || '');
  const [preview, setPreview] = useState<ImportedPlaylist | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [spotify, setSpotify] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const importing = useRef(false);

  useEffect(() => {
    const result = new URLSearchParams(location.search).get('spotify');
    if (result) {
      if (result === 'cancelled') setError('Spotify connection was cancelled. You can connect again.');
      const clean = new URL(location.href);
      clean.searchParams.delete('spotify');
      history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    }
    const controller = new AbortController();
    void fetch('/api/spotify/status', { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (!controller.signal.aborted) setSpotify(value); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const run = async (message: string, action: () => Promise<void>) => {
    if (importing.current) return;
    importing.current = true;
    onBusyChange(true);
    setError('');
    setProgress(message);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Playlist import failed. Try again.');
    } finally {
      importing.current = false;
      onBusyChange(false);
      setProgress('');
    }
  };

  const importPlaylist = async (source: ImportedPlaylist) => {
    if (!source.tracks.length) throw Error('No songs were found in this playlist.');
    const playlist = await createPlaylist(source.title, source.description || 'Imported from ' + source.source, initialTrackIds);
    try {
      await startImport(playlist.id, source);
    } catch (error) {
      await deletePlaylist(playlist.id).catch(() => {});
      throw error;
    }
    sessionStorage.removeItem(IMPORT_DRAFT);
    navigate({ type: 'playlist', id: playlist.id });
    onImported();
  };

  const fetchLink = (event: React.FormEvent) => {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;
    const ids = onVideos ? videoIds(value) : [];
    const parsed = onVideos && /^[\w-]{11}$/.test(value) ? null : parsePlaylistUrl(value);
    if (parsed) {
      void run('Fetching playlist…', async () => {
        const source = await fetchImportedPlaylist(parsed);
        if (source.source === 'spotify') {
          setProgress('Importing songs by title and artist…');
          await importPlaylist(source);
        } else {
          setPreview(source);
        }
      });
    } else if (ids.length && onVideos) {
      void run('Adding YouTube songs…', async () => {
        await onVideos(await Promise.all(ids.map(id => fetchYoutubeTrack(id))));
        setUrl('');
      });
    } else {
      setError(onVideos ? 'Paste a Spotify or YouTube playlist link, or YouTube video links.' : 'Paste a Spotify or YouTube playlist link.');
    }
  };

  const readFile = (file?: File) => {
    if (file) void run('Reading playlist file…', async () => { setPreview(await parsePlaylistFile(file)); });
  };

  return <div className="playlist-import-content" aria-busy={!!progress}>
    {!preview && <>
      <form className="playlist-import-link" onSubmit={fetchLink}>
        {onVideos ?
          <textarea rows={1} aria-label="Playlist URL" value={url} disabled={!!progress} onChange={e => setUrl(e.target.value)}
            placeholder="Spotify or YouTube link" autoCapitalize="none" autoCorrect="off" spellCheck={false} /> :
          <input type="text" aria-label="Playlist URL" value={url} disabled={!!progress} onChange={e => setUrl(e.target.value)}
            placeholder="Spotify or YouTube playlist link" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} />}
        <button type="submit" className="action-button" disabled={!!progress || !url.trim()}>
          {progress && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}Fetch
        </button>
      </form>
      <div className="playlist-import-alternatives">
        <label className="text-button cursor-pointer">
          <FileUp size={15} />Choose JSON/CSV file
          <input className="sr-only" type="file" accept=".json,.csv,.tsv,application/json,text/csv" disabled={!!progress}
            onChange={event => { readFile(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        {spotify?.configured && !spotify.connected &&
          <a href="/api/spotify/login" className="text-button" onClick={() => sessionStorage.setItem(IMPORT_DRAFT, url)}>Connect Spotify</a>}
      </div>
    </>}
    {preview && <>
      <p className="text-sm"><strong>{preview.title}</strong> · {preview.tracks.length} songs</p>
      {preview.warning && <p role="note" className="text-xs text-amber-300">{preview.warning}</p>}
      <div className="flex items-center gap-3">
        <button className="action-button" disabled={!!progress}
          onClick={() => void run('Starting import…', () => importPlaylist(preview))}>Import in background</button>
        <button className="text-button" disabled={!!progress} onClick={() => { setPreview(null); setError(''); }}>Back</button>
      </div>
    </>}
    {progress && <p role="status" className="text-sm text-zinc-400">{progress}</p>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
  </div>;
}

export function ImportPlaylistModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) onClose(); };
  return <Overlay isOpen={isOpen} onClose={close} label="Import playlist">
    <div className="p-4 sm:p-5">
      <header className="section-heading mb-3">
        <h2 className="flex items-center gap-2"><Link2 size={18} />Import playlist</h2>
        <button className="player-icon" aria-label="Close import" disabled={busy} onClick={close}><X size={20} /></button>
      </header>
      <PlaylistImportForm onImported={onClose} onBusyChange={setBusy} />
    </div>
  </Overlay>;
}
