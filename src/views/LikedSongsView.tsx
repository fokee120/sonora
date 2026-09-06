import React from 'react';
import { Heart, Play, Shuffle, Download, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';

export const LikedSongsView: React.FC = () => {
  const { tracks, favorites, isOnline, downloadTrack } = useApp();
  const { playTrack, setQueue } = usePlayer();

  const likedTracks = tracks.filter((t) => favorites.has(t.id));
  const allDownloaded =
    likedTracks.length > 0 &&
    likedTracks.every((t) => offlineManager.isTrackDownloaded(t.id));

  const handlePlayAll = (shuffle = false) => {
    if (likedTracks.length === 0) return;
    setQueue(likedTracks, likedTracks[0]);
    playTrack(likedTracks[0], likedTracks);
  };

  const handleDownloadAll = async () => {
    for (const track of likedTracks) {
      if (!offlineManager.isTrackDownloaded(track.id)) {
        await downloadTrack(track);
      }
    }
  };

  return (
    <div id="liked-songs-view" className="space-y-6 pb-12">
      {/* Hero */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 rounded-3xl bg-gradient-to-b from-rose-950/40 via-zinc-900 to-zinc-950 border border-zinc-800/80 shadow-xl">
        <div className="w-40 h-40 rounded-2xl bg-gradient-to-tr from-rose-600 via-rose-500 to-pink-500 flex items-center justify-center text-white shadow-2xl shrink-0">
          <Heart className="w-16 h-16 fill-white" />
        </div>

        <div className="flex-1 min-w-0 text-center sm:text-left space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-rose-400">
            Collection
          </span>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white truncate">
            Liked Songs
          </h1>
          <p className="text-xs text-zinc-400">
            {likedTracks.length} song{likedTracks.length === 1 ? '' : 's'} marked as favorite
          </p>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-3">
            <button
              onClick={() => handlePlayAll(false)}
              disabled={likedTracks.length === 0}
              className="px-5 py-2.5 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-xs flex items-center gap-2 transition shadow-lg disabled:opacity-40"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>Play All</span>
            </button>

            <button
              onClick={() => handlePlayAll(true)}
              disabled={likedTracks.length === 0}
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs flex items-center gap-2 border border-zinc-700 transition disabled:opacity-40"
            >
              <Shuffle className="w-4 h-4" />
              <span>Shuffle</span>
            </button>

            {likedTracks.length > 0 && isOnline && !allDownloaded && (
              <button
                onClick={handleDownloadAll}
                className="px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 font-medium text-xs flex items-center gap-2 transition"
              >
                <Download className="w-4 h-4" />
                <span>Download All Offline</span>
              </button>
            )}

            {allDownloaded && likedTracks.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-xs text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span>All Liked Songs Offline</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tracks List */}
      <div className="divide-y divide-zinc-900/60 rounded-2xl bg-zinc-900/20 border border-zinc-800/50 p-1">
        {likedTracks.length === 0 ? (
          <div className="py-20 text-center text-zinc-500 text-xs">
            <p>You haven&apos;t liked any songs yet.</p>
            <p className="text-zinc-600 mt-1">
              Tap the heart icon on any track to add it to your favorites.
            </p>
          </div>
        ) : (
          likedTracks.map((track, idx) => (
            <TrackRow
              key={`liked-${track.id}`}
              track={track}
              index={idx}
              tracksContext={likedTracks}
            />
          ))
        )}
      </div>
    </div>
  );
};
