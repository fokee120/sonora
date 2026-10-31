import { readPlaylistCover } from '../../lib/playlistCover.js';
import React, { useState } from 'react';
import { Pin, Pencil, X } from 'lucide-react';
import { notify } from '../common/ToastHost.js';
import { Overlay } from '../common/Overlay.js';
import { useApp } from '../../context/AppContext.js';
import type { Playlist } from '../../types/index.js';
export function PlaylistTools({ playlist }: {
    playlist: Playlist;
}) { const { updatePlaylist } = useApp(); const [open, setOpen] = useState(false); const [title, setTitle] = useState(playlist.title); const [description, setDescription] = useState(playlist.description || ''); const [cover, setCover] = useState(playlist.artworkUrl || ''); const [error, setError] = useState(''); return <><button className="player-icon" aria-label="Edit playlist" title="Edit playlist" onClick={() => { setTitle(playlist.title); setDescription(playlist.description || ''); setCover(playlist.artworkUrl || ''); setOpen(true); }}><Pencil size={18}/></button><button className="player-icon" aria-label={playlist.pinnedAt ? 'Unpin' : 'Pin'} title={playlist.pinnedAt ? 'Unpin' : 'Pin'} aria-pressed={!!playlist.pinnedAt} onClick={() => void updatePlaylist(playlist.id, { pinnedAt: playlist.pinnedAt ? undefined : Date.now() }).then(() => notify(playlist.pinnedAt ? "Playlist unpinned" : "Playlist pinned")).catch(() => notify("Couldn’t update playlist.", true))}><Pin size={18}/></button>{open && <Overlay isOpen={open} onClose={() => setOpen(false)} label="Edit playlist"><form className="settings-card w-full max-w-lg space-y-4" onSubmit={async (e) => { e.preventDefault(); try {
    await updatePlaylist(playlist.id, { title: title.trim(), description: description.trim(), artworkUrl: cover });
    setOpen(false); notify("Playlist updated");
}
catch (e) {
    setError(String(e));
} }}><div className="flex justify-between"><h2>Edit playlist</h2><button type="button" aria-label="Close playlist editor" onClick={() => setOpen(false)}><X /></button></div><label>Title<input className="settings-input" aria-label="Playlist title" required value={title} onChange={e => setTitle(e.target.value)}/></label><label>Description<textarea className="settings-input" aria-label="Playlist description" value={description} onChange={e => setDescription(e.target.value)}/></label>{cover && <img src={cover} alt="Playlist cover" className="w-32 h-32 rounded-2xl object-cover"/>}<label>Choose cover<input type="file" accept="image/*" onChange={async (e) => { try {
    const file = e.target.files?.[0];
    if (!file)
        return;
    const cropped=await readPlaylistCover(file);if(cropped)setCover(cropped);
    e.target.value = '';
}
catch {
    setError('Could not read that image.');
} }}/></label><button type="button" onClick={() => setCover('')}>Remove custom cover</button>{error && <p role="alert">{error}</p>}<button className="action-button" disabled={!title.trim()}>Save playlist</button></form></Overlay>}</>; }
