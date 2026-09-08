import React, { useState } from 'react';
import {
  Play,
  Pause,
  Heart,
  Download,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Plus,
  ListPlus,
  Trash2,
  Youtube,
} from 'lucide-react';
import { Track } from '../../types/index.js';
import { useApp } from '../../context/AppContext.js';
import { usePlayer } from '../../hooks/usePlayer.js';
import { offlineManager } from '../../lib/offline/OfflineManager.js';
import { isYoutubeTrack } from '../../lib/ytmusic/youtubeMusic.js';
import { playUiSound } from '../../lib/uiFeedback.js';

interface TrackRowProps {
  track: Track;
  index: number;
  tracksContext?: Track[];
  showAlbum?: boolean;
}

export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  index,
  tracksContext,
  showAlbum = true,
}) => {
  const {
    isFavorite,
    toggleFavorite,
    isDownloaded,
    isDownloading,
    downloadTrack,
    removeDownload,
    playlists,
    addTrackToPlaylist,
    isOnline,
  } = useApp();

  const { currentTrack, isPlaying, playTrack, togglePlay, playNext, addToQueue } = usePlayer();

  const [showMenu, setShowMenu] = useState(false);
  const [showPlaylistsSubmenu, setShowPlaylistsSubmenu] = useState(false);
  const [downloadPulse, setDownloadPulse] = useState(0);

  const isCurrent = currentTrack?.id === track.id;
  const isCurrentlyPlaying = isCurrent && isPlaying;
  const isYoutube = isYoutubeTrack(track);
  const downloaded = isDownloaded(track.id);
  const downloading = isDownloading(track.id);
  const downloadState = offlineManager.getDownloadState(track.id);
  const favorite = isFavorite(track.id);

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    playUiSound('tap');
    if (isCurrent) {
      togglePlay();
    } else {
      playTrack(track, tracksContext);
    }
  };

  const handleDownloadToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    playUiSound(downloaded ? 'toggle' : 'download');
    setDownloadPulse((value) => value + 1);
    if (downloaded) {
      await removeDownload(track.id);
    } else if (!downloading) {
      await downloadTrack(track);
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || !Number.isFinite(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div
      id={`track-row-${track.id}`}
      onClick={handlePlayClick}
      className={`track-row group relative flex items-center gap-3 px-4 py-3 rounded-xl transition cursor-pointer select-none ${
        isCurrent
          ? 'bg-white/[0.07] text-white shadow-xs'
          : 'hover:bg-white/[0.05] text-zinc-300 hover:text-white'
      }`}
    >
      {/* Index or Play indicator */}
      <div className="w-8 shrink-0 flex items-center justify-center text-xs font-mono text-zinc-500">
        <button
          onClick={handlePlayClick}
          className="w-7 h-7 rounded-full flex items-center justify-center transition group-hover:bg-blue-600 group-hover:text-white"
        >
          {isCurrentlyPlaying ? (
            <div className="flex items-end justify-center gap-0.5 h-3.5 w-3.5">
              <span className="w-0.5 bg-blue-400 animate-pulse h-full"></span>
              <span className="w-0.5 bg-blue-400 animate-pulse h-2/3"></span>
              <span className="w-0.5 bg-blue-400 animate-pulse h-4/5"></span>
            </div>
          ) : isCurrent ? (
            <Play className="w-3.5 h-3.5 fill-blue-400 text-blue-400" />
          ) : (
            <>
              <span className="group-hover:hidden">{index + 1}</span>
              <Play className="w-3.5 h-3.5 fill-white text-white hidden group-hover:block ml-0.5" />
            </>
          )}
        </button>
      </div>

      {/* Artwork thumbnail */}
      <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-zinc-900 border border-white/10">
        <img
          src={track.artworkUrl || '/icon.svg'}
          alt={track.album}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/icon.svg';
          }}
        />
        {downloaded && (
          <div
            className="absolute bottom-0.5 right-0.5 bg-emerald-500 rounded-full p-0.5 text-zinc-950 shadow-xs"
            title="Stored Offline"
          >
            <CheckCircle2 className="w-2.5 h-2.5 stroke-[3]" />
          </div>
        )}
        {isYoutube && !downloaded && (
          <div
            className="absolute top-0.5 left-0.5 bg-red-600/90 rounded-sm px-0.5 flex items-center justify-center"
            title="From YouTube Music"
          >
            <Youtube className="w-2.5 h-2.5 text-white" />
          </div>
        )}
      </div>

      {/* Track Title & Artist */}
      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-center gap-2">
          <p
            className={`text-sm font-medium truncate ${
              isCurrent ? 'text-blue-400 font-semibold' : 'text-zinc-100 group-hover:text-white'
            }`}
          >
            {track.title}
          </p>
          {downloaded && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.2 text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 rounded-sm font-medium hidden sm:inline">
              Offline
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-400 truncate mt-0.5">
          {track.artist}
          {showAlbum && track.album && (
            <span className="text-zinc-600 hidden md:inline"> • {track.album}</span>
          )}
        </p>
        {downloadState?.status === 'failed' && (
          <p role="alert" className="text-xs text-rose-300 mt-1 break-words">
            {downloadState.error || 'Download failed. Please try again.'}
          </p>
        )}
      </div>

      {/* Album name column (desktop) */}
      {showAlbum && (
        <div className="hidden lg:block w-48 truncate text-xs text-zinc-400">
          {track.album}
        </div>
      )}

      {/* Download Action & Progress */}
      <div className="flex items-center gap-2 shrink-0">
        {downloading ? (
          <div
            className="flex items-center gap-1 text-[11px] text-blue-400 bg-blue-950/50 px-2 py-1 rounded-md border border-blue-800/40"
            title="Downloading to IndexedDB..."
          >
            <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
            <span className="font-mono">{downloadState?.progress || 0}%</span>
          </div>
        ) : downloaded ? (
          <button
            key={`downloaded-${downloadPulse}`}
            onClick={handleDownloadToggle}
            className="download-pop p-1.5 text-emerald-400 hover:text-rose-400 rounded-lg transition active:scale-90"
            title="Downloaded offline. Click to remove from local storage."
          >
            <CheckCircle2 className="w-4 h-4" />
          </button>
        ) : (
          <button
            key={`download-${downloadPulse}`}
            onClick={handleDownloadToggle}
            disabled={!isOnline}
            className={`download-pop p-1.5 text-zinc-500 hover:text-white rounded-lg transition active:scale-90 ${
              !isOnline ? 'opacity-30 cursor-not-allowed' : 'opacity-0 group-hover:opacity-100'
            }`}
            title={isOnline ? (downloadState?.status === 'failed' ? 'Retry download' : 'Download for offline playback') : 'Connect online to download'}
          >
            <Download className="w-4 h-4" />
          </button>
        )}

        {/* Favorite Heart */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            playUiSound(favorite ? 'toggle' : 'success');
            toggleFavorite(track.id);
          }}
          className={`p-1.5 transition ${
            favorite
              ? 'text-rose-500 hover:text-rose-400'
              : 'text-zinc-500 hover:text-white opacity-0 group-hover:opacity-100'
          }`}
          title={favorite ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
        >
          <Heart className={`w-4 h-4 ${favorite ? 'fill-rose-500' : ''}`} />
        </button>

        {/* Duration */}
        <span className="text-xs font-mono text-zinc-500 w-10 text-right">
          {formatDuration(track.duration)}
        </span>

        {/* Context Menu Button */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1.5 text-zinc-500 hover:text-white rounded-lg opacity-0 group-hover:opacity-100 transition"
            title="More options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {showMenu && (
            <div
              className="absolute right-0 top-8 z-40 w-48 rounded-xl bg-black/90 border border-white/10 p-1.5 shadow-2xl text-xs text-zinc-200 backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
              onClick={() => {
                  playUiSound('tap');
                  playNext(track);
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Play Next</span>
              </button>

              <button
              onClick={() => {
                  playUiSound('tap');
                  addToQueue(track);
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition"
              >
                <ListPlus className="w-3.5 h-3.5" />
                <span>Add to Queue</span>
              </button>

              <button
                onClick={() => {
                  playUiSound('toggle');
                  setShowPlaylistsSubmenu(!showPlaylistsSubmenu);
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/10 hover:text-white transition"
              >
                <div className="flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add to Playlist</span>
                </div>
                <span>›</span>
              </button>

              {showPlaylistsSubmenu && (
                <div className="my-1 pl-3 border-l border-white/10 space-y-1">
                  {playlists.length === 0 ? (
                    <span className="text-zinc-500 text-[11px] block py-1">No playlists yet</span>
                  ) : (
                    playlists.map((pl) => (
                      <button
                        key={pl.id}
                        onClick={() => {
                          playUiSound('success');
                          addTrackToPlaylist(pl.id, track.id);
                          setShowMenu(false);
                        }}
                        className="w-full text-left truncate px-2 py-1 rounded hover:bg-white/10 text-zinc-300 hover:text-white"
                      >
                        {pl.title}
                      </button>
                    ))
                  )}
                </div>
              )}

              {downloaded && (
                <button
                  onClick={() => {
                    playUiSound('toggle');
                    removeDownload(track.id);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-rose-950/40 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove Offline File</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
