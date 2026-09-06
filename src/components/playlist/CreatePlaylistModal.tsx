import React, { useState, useMemo } from 'react';
import { X, ListMusic, Plus, Search, Check, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { Track } from '../../types/index.js';

interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTrackId?: string;
  onCreated?: (playlistId: string) => void;
}

const PLAYLIST_THEMES = [
  { id: 'indigo', name: 'Deep Indigo', gradient: 'from-indigo-600 to-slate-900', border: 'border-indigo-500/30' },
  { id: 'violet', name: 'Velvet Violet', gradient: 'from-purple-600 to-zinc-950', border: 'border-purple-500/30' },
  { id: 'emerald', name: 'Emerald Pine', gradient: 'from-emerald-600 to-teal-950', border: 'border-emerald-500/30' },
  { id: 'rose', name: 'Nordic Rose', gradient: 'from-rose-600 to-stone-950', border: 'border-rose-500/30' },
  { id: 'amber', name: 'Warm Amber', gradient: 'from-amber-600 to-yellow-950', border: 'border-amber-500/30' },
  { id: 'cyan', name: 'Glacier Cyan', gradient: 'from-cyan-600 to-blue-950', border: 'border-cyan-500/30' },
];

export const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  isOpen,
  onClose,
  initialTrackId,
  onCreated,
}) => {
  const { tracks, createPlaylist, navigate } = useApp();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTheme, setSelectedTheme] = useState(PLAYLIST_THEMES[0]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(
    new Set(initialTrackId ? [initialTrackId] : [])
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredTracks = useMemo(() => {
    if (!searchQuery.trim()) return tracks.slice(0, 20);
    const q = searchQuery.toLowerCase();
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        (t.album && t.album.toLowerCase().includes(q))
    );
  }, [tracks, searchQuery]);

  if (!isOpen) return null;

  const toggleTrack = (id: string) => {
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Please provide a playlist name');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const newPl = await createPlaylist(
        cleanTitle,
        description.trim() || undefined,
        Array.from(selectedTrackIds)
      );

      // Reset
      setTitle('');
      setDescription('');
      setSelectedTrackIds(new Set());
      setSearchQuery('');
      onClose();

      if (onCreated) {
        onCreated(newPl.id);
      } else {
        navigate({ type: 'playlist', id: newPl.id });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to create playlist');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div
        id="create-playlist-dialog"
        className="w-full max-w-lg rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-950/40">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${selectedTheme.gradient} flex items-center justify-center text-white shadow-md`}>
              <ListMusic className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Create New Playlist</h2>
              <p className="text-[11px] text-zinc-400">Add songs from your Google Drive audio library</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* Title & Description */}
          <div className="space-y-3">
            <div>
              <label htmlFor="playlist-title" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Playlist Name <span className="text-rose-400">*</span>
              </label>
              <input
                id="playlist-title"
                type="text"
                autoFocus
                placeholder="e.g., Road Trip Classics, Chill Focus..."
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full px-3.5 py-2.5 text-sm bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder:text-zinc-600 focus:outline-hidden focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <label htmlFor="playlist-description" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Description (Optional)
              </label>
              <textarea
                id="playlist-description"
                rows={2}
                placeholder="Brief summary or mood..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-white placeholder:text-zinc-600 focus:outline-hidden focus:border-indigo-500 transition resize-none"
              />
            </div>
          </div>

          {/* Theme Color Selection */}
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>Cover Accent</span>
            </span>
            <div className="grid grid-cols-6 gap-2">
              {PLAYLIST_THEMES.map((theme) => {
                const isSelected = selectedTheme.id === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setSelectedTheme(theme)}
                    className={`h-9 rounded-xl bg-gradient-to-tr ${theme.gradient} transition relative flex items-center justify-center border ${
                      isSelected ? 'border-white scale-105 shadow-md shadow-white/10 ring-2 ring-indigo-500/50' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                    title={theme.name}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-white drop-shadow-md" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Song Selector */}
          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Add Songs ({selectedTrackIds.size} selected)
              </span>
              {selectedTrackIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTrackIds(new Set())}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 transition"
                >
                  Clear selection
                </button>
              )}
            </div>

            {/* Track Search Bar */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search songs to add..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder:text-zinc-600 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            {/* Track Checkboxes List */}
            <div className="max-h-44 overflow-y-auto space-y-1 pr-1 rounded-xl bg-zinc-950/60 p-2 border border-zinc-800/80">
              {filteredTracks.length === 0 ? (
                <p className="text-center py-4 text-xs text-zinc-600">No matching songs found</p>
              ) : (
                filteredTracks.map((track) => {
                  const isChecked = selectedTrackIds.has(track.id);
                  return (
                    <div
                      key={track.id}
                      onClick={() => toggleTrack(track.id)}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer text-xs transition select-none ${
                        isChecked
                          ? 'bg-indigo-600/15 border border-indigo-500/30 text-white'
                          : 'hover:bg-zinc-800/50 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border transition shrink-0 ${
                            isChecked ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-zinc-700 bg-zinc-900'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <div className="truncate">
                          <p className="font-medium truncate text-white">{track.title}</p>
                          <p className="text-[10px] text-zinc-400 truncate">{track.artist}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                        {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800/80 bg-zinc-950/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white transition rounded-xl"
          >
            Cancel
          </button>
          <button
            id="submit-create-playlist-btn"
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition active:scale-95 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Creating...' : 'Create Playlist'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
