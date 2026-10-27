import React, { useState } from 'react';
import { Plus, X, ListMusic } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { Overlay } from '../common/Overlay.js';
import type { Track } from '../../types/index.js';
export function AddToPlaylistSheet({ track, isOpen, onClose }: { track: Track; isOpen: boolean; onClose: () => void }) {
  const { playlists, addTrackToPlaylist, addTracksToLibrary, openCreatePlaylist } = useApp();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return <Overlay isOpen={isOpen} onClose={onClose} label="Add to playlist">
    <div className="p-5 space-y-4"><header className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">Add to playlist</h2><p className="text-sm text-zinc-400">{track.title}</p></div><button className="player-icon" aria-label="Close playlist picker" onClick={onClose}><X size={20} /></button></header>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button className="action-button" onClick={async () => { await addTracksToLibrary([track]); onClose(); openCreatePlaylist(track.id); }}><Plus size={17} />New playlist</button>
      {playlists.map(playlist => <button disabled={saving} className="playlist-library-row" key={playlist.id} onClick={async () => { setSaving(true); try { await addTracksToLibrary([track]); await addTrackToPlaylist(playlist.id, track.id); onClose(); } catch { setError('Could not add this song. Try again.'); } finally { setSaving(false); } }}><ListMusic size={20} /><span className="truncate">{playlist.title}</span></button>)}
    </div>
  </Overlay>;
}
