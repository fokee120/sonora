import React, { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { PlaylistCover } from '../common/PlaylistCover.js';
import { notify } from '../common/ToastHost.js';
import { Overlay } from '../common/Overlay.js';
import type { Playlist, Track } from '../../types/index.js';

export function AddToPlaylistSheet({ track, isOpen, onClose }: { track: Track; isOpen: boolean; onClose: () => void }) {
  const { tracks, playlists, addTrackToPlaylist, removeTrackFromPlaylist, addTracksToLibrary, openCreatePlaylist } = useApp();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const close = () => { if (!saving) onClose(); };

  async function updateMembership(playlist: Playlist, included: boolean) {
    setSaving(true);
    setError('');
    try {
      if (included) {
        await removeTrackFromPlaylist(playlist.id, track.id);
        notify('Removed from ' + playlist.title);
        return;
      }

      await addTracksToLibrary([track]);
      if (!await addTrackToPlaylist(playlist.id, track.id)) {
        setError('That playlist is no longer available.');
        return;
      }
      notify('Added to ' + playlist.title);
      onClose();
    } catch {
      setError(included ? 'Couldn’t remove this song. Try again.' : 'Couldn’t add this song. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function createWithSong() {
    setSaving(true);
    setError('');
    try {
      await addTracksToLibrary([track]);
      onClose();
      openCreatePlaylist(track.id);
    } catch {
      setError('Couldn’t save this song. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return <Overlay isOpen={isOpen} onClose={close} label="Add to playlist" variant="picker">
    <header className="playlist-picker-header">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold">Add to playlist</h2>
        <p className="text-sm text-zinc-400 truncate">{track.title}</p>
      </div>
      <button className="player-icon" aria-label="Close playlist picker" onClick={close} disabled={saving}><X size={20} /></button>
    </header>
    <div className="playlist-picker-options" aria-busy={saving}>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button className="action-button" onClick={() => void createWithSong()} disabled={saving}><Plus size={17} />New playlist</button>
      {playlists.map(playlist => {
        const included = playlist.trackIds.includes(track.id);
        return <button
          key={playlist.id}
          className="playlist-library-row playlist-picker-choice"
          aria-label={playlist.title}
          aria-pressed={included}
          title={(included ? 'Remove from ' : 'Add to ') + playlist.title}
          disabled={saving}
          onClick={() => void updateMembership(playlist, included)}
        >
          <PlaylistCover playlist={playlist} tracks={tracks} className="playlist-row-art" />
          <span className="truncate">{playlist.title}</span>
          <span className="playlist-picker-state" aria-hidden="true">
            {included ? <Check size={20} strokeWidth={2.5} /> : <Plus size={20} />}
          </span>
        </button>;
      })}
    </div>
  </Overlay>;
}
