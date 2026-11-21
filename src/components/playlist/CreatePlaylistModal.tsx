import React, { useEffect, useRef, useState } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { playUiSound } from '../../lib/uiFeedback.js';
import type { Track } from '../../types/index.js';
import { Overlay } from '../common/Overlay.js';
import { PlaylistImportForm } from './ImportPlaylistModal.js';

interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTrackId?: string;
  onCreated?: (playlistId: string) => void;
}

export function CreatePlaylistModal({ isOpen, onClose, initialTrackId, onCreated }: CreatePlaylistModalProps) {
  const { createPlaylist, navigate, addTracksToLibrary } = useApp();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const usableTrackIds = [...new Set<string>(initialTrackId ? [initialTrackId, ...selectedTrackIds] : selectedTrackIds)];

  useEffect(() => {
    if (!isOpen) {
      setTitle('');
      setDescription('');
      setSelectedTrackIds([]);
      setError('');
    }
  }, [isOpen]);

  const close = () => { if (!importing && !savingRef.current) onClose(); };

  const addVideos = async (tracks: Track[]) => {
    await addTracksToLibrary(tracks);
    setSelectedTrackIds(previous => [...new Set([...previous, ...tracks.map(track => track.id)])]);
    if (tracks.length > 1) setTitle(previous => previous.trim() ? previous : 'YouTube Mix');
    playUiSound('success');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current || importing || !title.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const playlist = await createPlaylist(title, description, usableTrackIds);
      playUiSound('success');
      onClose();
      if (onCreated) onCreated(playlist.id);
      else navigate({ type: 'playlist', id: playlist.id });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t create this playlist. Try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <Overlay isOpen={isOpen} onClose={close} label="Create New Playlist">
    <div id="create-playlist-dialog" className="p-4 sm:p-5">
      <header className="section-heading mb-3">
        <h2>New playlist</h2>
        <button className="player-icon" aria-label="Close create playlist" disabled={saving || importing} onClick={close}><X size={20} /></button>
      </header>
      <form className="new-playlist-form" onSubmit={submit}>
        <label>Playlist Name<input className="settings-input" value={title} onChange={e => { setTitle(e.target.value); setError(''); }}
          placeholder="Name your playlist" required disabled={saving || importing} /></label>
        <label>Description <span>(optional)</span><textarea className="settings-input" rows={1} value={description}
          onChange={e => setDescription(e.target.value)} placeholder="Add a description" disabled={saving || importing} /></label>
        {usableTrackIds.length > 0 && <p className="text-xs text-zinc-400" aria-live="polite">Add Songs ({usableTrackIds.length} selected)</p>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <button id="submit-create-playlist-btn" type="submit" className="primary-button" disabled={saving || importing || !title.trim()}>
          <Plus size={17} />{saving ? 'Creating…' : 'Create Playlist'}
        </button>
      </form>
      <section className="new-playlist-import" aria-label="Import links">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Link2 size={17} />Import links</h3>
        <PlaylistImportForm onImported={onClose} onBusyChange={setImporting} onVideos={addVideos} initialTrackIds={usableTrackIds} />
      </section>
    </div>
  </Overlay>;
}
