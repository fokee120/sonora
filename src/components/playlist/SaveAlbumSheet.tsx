import React, { useState } from 'react';
import { BookmarkCheck, Plus, X } from 'lucide-react';
import { Overlay } from '../common/Overlay.js';
import { PlaylistCover } from '../common/PlaylistCover.js';
import { useApp } from '../../context/AppContext.js';
import { notify } from '../common/ToastHost.js';
import type { Album } from '../../types/index.js';

export function SaveAlbumSheet({ album, saved, loadAlbum, onClose, onRemoved }: {
  album: Album;
  saved: boolean;
  loadAlbum: () => Promise<Album>;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { playlists, tracks, saveAlbumToLibrary, removeAlbumFromLibrary, addTracksToLibrary, addTracksToPlaylist } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Couldn’t update this album. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggleSaved = () => run(async () => {
    if (saved) {
      await removeAlbumFromLibrary(album.id);
      notify('Album removed from Library');
      onRemoved();
    } else {
      await saveAlbumToLibrary(await loadAlbum());
      notify('Album saved to Library');
    }
  });

  const addToPlaylist = (id: string) => run(async () => {
    const songs = (await loadAlbum()).tracks || [];
    if (!songs.length) throw new Error('This album has no available songs.');
    await addTracksToLibrary(songs);
    const updated = await addTracksToPlaylist(id, songs.map(track => track.id));
    if (!updated) throw new Error('This playlist no longer exists.');
    notify('Album added to ' + updated.title);
  });

  return <Overlay isOpen onClose={() => { if (!busy) onClose(); }} label="Save album" variant="picker">
    <header className="playlist-picker-header">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold">Save album</h2>
        <p className="truncate text-sm text-zinc-400">{album.title}</p>
      </div>
      <button className="player-icon" disabled={busy} aria-label="Close album picker" onClick={onClose}><X size={20} /></button>
    </header>
    <div className="playlist-picker-options" aria-busy={busy}>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Updating your library…</p>}
      <button className="action-button" disabled={busy} onClick={() => void toggleSaved()}>
        {saved ? <BookmarkCheck size={17} /> : <Plus size={17} />}
        {saved ? 'Remove from Library' : 'Save to Library'}
      </button>
      {!!playlists.length && <section className="playlist-picker-options-group">
        <h3 className="collection-count">Add songs to a playlist</h3>
        {playlists.map(playlist => (
          <button className="playlist-library-row playlist-picker-choice" key={playlist.id} disabled={busy} onClick={() => void addToPlaylist(playlist.id)}>
            <PlaylistCover playlist={playlist} tracks={tracks} className="playlist-row-art" />
            <span className="truncate">{playlist.title}</span>
          </button>
        ))}
      </section>}
    </div>
  </Overlay>;
}
