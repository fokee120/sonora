import React, { useState } from 'react';
import {
  ArrowLeft,
  Play,
  Shuffle,
  Download,
  CheckCircle2,
  Trash2,
  Plus,
  ListMusic,
  Clock,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';

interface PlaylistDetailViewProps {
  playlistId: string;
}

export const PlaylistDetailView: React.FC<PlaylistDetailViewProps> = ({ playlistId }) => {
  const {
    playlists,
    displayTracks,
    tracks: allTracks,
    deletePlaylist,
    removeTrackFromPlaylist,
    addTrackToPlaylist,
    downloadPlaylist,
    removePlaylistDownload,
    navigate,
    isOnline,
  } = useApp();

  const { playTrack, setQueue } = usePlayer();
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  const playlist = playlists.find((p) => p.id === playlistId);

  if (!playlist) {
    return (
      <div className="py-20 text-center text-zinc-500 text-sm">
        <p>Playlist not found.</p>
        <button
          onClick={() => navigate({ type: 'library' })}
          className="mt-3 px-4 py-1.5 rounded-xl bg-zinc-800 text-xs text-zinc-300 hover:text-white"
        >
          Back to Library
        </button>
      </div>
    );
  }

  // Resolve tracks in this playlist
  const playlistTracks = playlist.trackIds
    .map((id) => allTracks.find((t) => t.id === id))
    .filter((t): t is typeof allTracks[0] => Boolean(t));

  const allDownloaded =
    playlistTracks.length > 0 &&
    playlistTracks.every((t) => offlineManager.isTrackDownloaded(t.id));

  const handlePlayPlaylist = (shuffle = false) => {
    if (playlistTracks.length === 0) return;
    setQueue(playlistTracks, playlistTracks[0]);
    playTrack(playlistTracks[0], playlistTracks);
  };

  const handleDownloadToggle = async () => {
    if (allDownloaded) {
      await removePlaylistDownload(playlist);
    } else {
      await downloadPlaylist(playlist);
    }
  };

  const handleDelete = async () => {
    if (confirm(`Are you sure you want to delete the playlist "${playlist.title}"?`)) {
      await deletePlaylist(playlist.id);
      navigate({ type: 'library' });
    }
  };

  // Filter candidates for Add Songs modal
  const addCandidates = allTracks.filter((t) => {
    if (playlist.trackIds.includes(t.id)) return false;
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
  });

  return (
    <div id="playlist-detail-view" className="space-y-6 pb-12">
      {/* Back button */}
      <button
        onClick={() => navigate({ type: 'library' })}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      {/* Playlist Hero */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 rounded-3xl bg-gradient-to-b from-indigo-950/40 via-zinc-900 to-zinc-950 border border-zinc-800/80 shadow-xl">
        <div className="w-40 h-40 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-indigo-400 shadow-2xl shrink-0">
          <ListMusic className="w-16 h-16 opacity-80" />
        </div>

        <div className="flex-1 min-w-0 text-center sm:text-left space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-indigo-400">
            Playlist
          </span>
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-white truncate">
            {playlist.title}
          </h1>
          {playlist.description && (
            <p className="text-xs text-zinc-400">{playlist.description}</p>
          )}
          <p className="text-xs text-zinc-500 font-mono">
            {playlistTracks.length} song{playlistTracks.length === 1 ? '' : 's'}
          </p>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-3">
            <button
              onClick={() => handlePlayPlaylist(false)}
              disabled={playlistTracks.length === 0}
              className="px-5 py-2.5 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-xs flex items-center gap-2 transition shadow-lg disabled:opacity-40"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>Play</span>
            </button>

            <button
              onClick={() => handlePlayPlaylist(true)}
              disabled={playlistTracks.length === 0}
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs flex items-center gap-2 border border-zinc-700 transition disabled:opacity-40"
            >
              <Shuffle className="w-4 h-4" />
              <span>Shuffle</span>
            </button>

            {/* Download Playlist */}
            {playlistTracks.length > 0 && (
              <button
                onClick={handleDownloadToggle}
                disabled={!isOnline && !allDownloaded}
                className={`px-4 py-2.5 rounded-xl font-medium text-xs flex items-center gap-2 border transition ${
                  allDownloaded
                    ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400 hover:bg-rose-950/40 hover:text-rose-400 hover:border-rose-800/40'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {allDownloaded ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Downloaded</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download Playlist</span>
                  </>
                )}
              </button>
            )}

            {/* Add Songs */}
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-medium text-xs flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Songs</span>
            </button>

            {/* Delete Playlist */}
            <button
              onClick={handleDelete}
              className="p-2.5 rounded-xl text-zinc-500 hover:text-rose-400 hover:bg-zinc-900 transition"
              title="Delete playlist"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Playlist Tracks Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-900">
          <div className="flex items-center gap-4">
            <span className="w-6 text-center">#</span>
            <span>Title</span>
          </div>
          <Clock className="w-3.5 h-3.5" />
        </div>

        {playlistTracks.length === 0 ? (
          <div className="py-16 text-center text-zinc-500 text-xs">
            <p>This playlist is empty.</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition"
            >
              Add songs from vault
            </button>
          </div>
        ) : (
          <div className="divide-y divide-zinc-900/60">
            {playlistTracks.map((track, idx) => (
              <div key={track.id} className="relative group">
                <TrackRow
                  track={track}
                  index={idx}
                  tracksContext={playlistTracks}
                  showAlbum={true}
                />
                <button
                  onClick={() => removeTrackFromPlaylist(playlist.id, track.id)}
                  className="absolute right-12 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition rounded"
                  title="Remove from playlist"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Songs Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-zinc-950 border border-zinc-800 p-5 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-semibold text-white">Add Songs to Playlist</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-zinc-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="my-3">
              <input
                type="text"
                placeholder="Filter songs by title or artist..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-200 placeholder:text-zinc-500 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 divide-y divide-zinc-900 pr-1">
              {addCandidates.length === 0 ? (
                <p className="py-8 text-center text-zinc-500 text-xs">No matching songs found.</p>
              ) : (
                addCandidates.map((track) => (
                  <div
                    key={`add-${track.id}`}
                    className="flex items-center justify-between p-2 rounded-xl hover:bg-zinc-900 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <img
                        src={track.artworkUrl || '/icon.svg'}
                        alt={track.title}
                        className="w-8 h-8 rounded-lg object-cover bg-zinc-900 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-zinc-200 truncate">{track.title}</p>
                        <p className="text-[11px] text-zinc-500 truncate">{track.artist}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => addTrackToPlaylist(playlist.id, track.id)}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
