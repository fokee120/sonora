import React from 'react';
import {
  Play,
  Shuffle,
  Download,
  CheckCircle2,
  Loader2,
  Clock,
  ArrowLeft,
  Disc3,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';

interface AlbumDetailViewProps {
  albumId: string;
}

export const AlbumDetailView: React.FC<AlbumDetailViewProps> = ({ albumId }) => {
  const { displayAlbums, navigate, downloadAlbum, removeAlbumDownload, isOnline } = useApp();
  const { playTrack, setQueue } = usePlayer();

  const album = displayAlbums.find((a) => a.id === albumId);

  if (!album) {
    return (
      <div className="py-20 text-center text-zinc-500 text-sm">
        <p>Album not found.</p>
        <button
          onClick={() => navigate({ type: 'library' })}
          className="mt-3 px-4 py-1.5 rounded-xl bg-zinc-800 text-xs text-zinc-300 hover:text-white"
        >
          Back to Library
        </button>
      </div>
    );
  }

  const tracks = album.tracks || [];
  const allDownloaded =
    tracks.length > 0 && tracks.every((t) => offlineManager.isTrackDownloaded(t.id));
  const someDownloading = tracks.some((t) => offlineManager.isTrackDownloading(t.id));

  const totalSeconds = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalMins = Math.floor(totalSeconds / 60);

  const handlePlayAlbum = (shuffle = false) => {
    if (tracks.length === 0) return;
    setQueue(tracks, tracks[0]);
    playTrack(tracks[0], tracks);
  };

  const handleDownloadToggle = async () => {
    if (allDownloaded) {
      await removeAlbumDownload(album);
    } else {
      await downloadAlbum(album);
    }
  };

  return (
    <div id="album-detail-view" className="space-y-6 pb-12">
      {/* Back button */}
      <button
        onClick={() => navigate({ type: 'library' })}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Library</span>
      </button>

      {/* Album Hero */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 sm:p-8 rounded-3xl glass border border-white/10 shadow-2xl relative overflow-hidden">
        <div className="relative w-44 h-44 sm:w-52 sm:h-52 rounded-2xl overflow-hidden bg-zinc-950 shadow-2xl border border-white/10 shrink-0">
          <img
            src={album.artworkUrl || '/icon.svg'}
            alt={album.title}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/icon.svg';
            }}
          />
        </div>

        <div className="flex-1 min-w-0 text-center sm:text-left space-y-2 relative z-10">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-blue-400">
            Album
          </span>
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-white truncate">
            {album.title}
          </h1>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-zinc-400">
            <span
              onClick={() => navigate({ type: 'artist', id: `artist_${album.artist.toLowerCase().replace(/[^a-z0-9]/g, '_')}` })}
              className="font-semibold text-zinc-200 hover:text-blue-400 cursor-pointer transition"
            >
              {album.artist}
            </span>
            {album.year && <span>• {album.year}</span>}
            {album.genre && <span>• {album.genre}</span>}
            <span>• {tracks.length} songs</span>
            {totalMins > 0 && <span>• {totalMins} min</span>}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-3">
            <button
              onClick={() => handlePlayAlbum(false)}
              disabled={tracks.length === 0}
              className="px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-2 transition shadow-lg shadow-blue-900/40 disabled:opacity-40"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>Play</span>
            </button>

            <button
              onClick={() => handlePlayAlbum(true)}
              disabled={tracks.length === 0}
              className="px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white font-medium text-xs flex items-center gap-2 border border-white/10 transition disabled:opacity-40"
            >
              <Shuffle className="w-4 h-4" />
              <span>Shuffle</span>
            </button>

            {/* Batch Download Button */}
            <button
              onClick={handleDownloadToggle}
              disabled={!isOnline && !allDownloaded}
              className={`px-4 py-2.5 rounded-full font-medium text-xs flex items-center gap-2 border transition ${
                allDownloaded
                  ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400 hover:bg-rose-950/40 hover:text-rose-400 hover:border-rose-800/40'
                  : someDownloading
                  ? 'bg-blue-950/50 border-blue-800/50 text-blue-300'
                  : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              title={
                allDownloaded
                  ? 'Album stored in local IndexedDB. Click to remove.'
                  : 'Download entire album for offline playback'
              }
            >
              {someDownloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Downloading...</span>
                </>
              ) : allDownloaded ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Downloaded Offline</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Album</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Ambient atmospheric radial gradient inside hero */}
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Track Listing */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 border-b border-white/10">
          <div className="flex items-center gap-4">
            <span className="w-6 text-center">#</span>
            <span>Title</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
          </div>
        </div>

        <div className="divide-y divide-white/5">
          {tracks.map((track, idx) => (
            <TrackRow
              key={track.id}
              track={track}
              index={track.trackNumber ? track.trackNumber - 1 : idx}
              tracksContext={tracks}
              showAlbum={false}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
