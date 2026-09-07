import React, { useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
  ListMusic,
  Maximize2,
  HardDriveDownload,
  Cloud,
  Loader2,
} from 'lucide-react';
import { usePlayer } from '../../hooks/usePlayer.js';
import { useApp } from '../../context/AppContext.js';
import { ExpandedPlayerModal } from './ExpandedPlayerModal.js';
import { QueueDrawer } from './QueueDrawer.js';

export const BottomPlayer: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    next,
    previous,
    seek,
    currentTime,
    duration,
    volume,
    setVolume,
    isMuted,
    toggleMute,
    shuffle,
    toggleShuffle,
    repeatMode,
    cycleRepeatMode,
    playbackSource,
    isLoading,
    error,
  } = usePlayer();

  const { isFavorite, toggleFavorite } = useApp();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);

  if (!currentTrack) return null;

  const favorite = isFavorite(currentTrack.id);

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <div
        id="bottom-player-bar"
        className="fixed bottom-14 md:bottom-0 left-0 right-0 z-40 bg-black/80 backdrop-blur-xl border-t border-white/5 select-none shadow-2xl transition"
      >
        {error && <p role="alert" className="px-4 py-2 text-xs text-rose-300 bg-rose-950/80 break-words">{error}</p>}
        {/* Scrubber Progress Bar at top edge with Atmospheric Blue Accent */}
        <div
          className="relative w-full h-1 bg-white/10 cursor-pointer group hover:h-2 transition-all"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            seek(pct * duration);
          }}
        >
          <div
            className="h-full bg-blue-500 group-hover:bg-blue-400 transition-all relative shadow-[0_0_12px_rgba(59,130,246,0.6)]"
            style={{ width: `${progressPercent}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white opacity-0 group-hover:opacity-100 transition shadow-md" />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 md:px-8 py-3 max-w-7xl mx-auto gap-3 sm:gap-6">
          {/* Left: Track Details */}
          <div
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-3.5 min-w-0 flex-1 max-w-[240px] md:max-w-xs cursor-pointer group"
          >
            <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-zinc-900 shrink-0 border border-white/10 shadow-lg">
              <img
                src={currentTrack.artworkUrl || '/icon.svg'}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/icon.svg';
                }}
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                <Maximize2 className="w-4 h-4 text-white" />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-xs md:text-sm font-bold text-white group-hover:text-blue-400 truncate transition-colors">
                  {currentTrack.title}
                </p>
                {playbackSource === 'local' ? (
                  <span
                    className="shrink-0 px-1 py-0.2 text-[9px] rounded bg-emerald-950/70 text-emerald-400 border border-emerald-800/40 font-medium"
                    title="Playing from local IndexedDB cache"
                  >
                    Offline
                  </span>
                ) : (
                  <span
                    className="shrink-0 px-1 py-0.2 text-[9px] rounded bg-blue-950/70 text-blue-400 border border-blue-800/40 font-medium hidden sm:inline"
                    title="Streaming from Google Cloud Storage"
                  >
                    Cloud
                  </span>
                )}
              </div>
              <p className="text-[11px] md:text-xs text-zinc-400 truncate mt-0.5">
                {currentTrack.artist}
              </p>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(currentTrack.id);
              }}
              className={`p-1.5 transition hidden sm:block ${
                favorite ? 'text-rose-500' : 'text-zinc-500 hover:text-white'
              }`}
              title={favorite ? 'Liked' : 'Like'}
            >
              <Heart className={`w-4 h-4 ${favorite ? 'fill-rose-500' : ''}`} />
            </button>
          </div>

          {/* Center: Playback Controls */}
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Shuffle (desktop) */}
              <button
                onClick={toggleShuffle}
                className={`p-1.5 rounded-full transition ${
                  shuffle
                    ? 'text-blue-400 bg-blue-500/10'
                    : 'text-zinc-500 hover:text-white'
                }`}
                title={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
              >
                <Shuffle className="w-4 h-4" />
              </button>

              {/* Previous */}
              <button
                onClick={previous}
                className="p-1.5 text-zinc-400 hover:text-white transition rounded-full"
                title="Previous track"
              >
                <SkipBack className="w-5 h-5 fill-current" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                disabled={isLoading}
                className="w-10 h-10 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-lg shadow-white/10"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-900" />
                ) : isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>

              {/* Next */}
              <button
                onClick={next}
                className="p-1.5 text-zinc-400 hover:text-white transition rounded-full"
                title="Next track"
              >
                <SkipForward className="w-5 h-5 fill-current" />
              </button>

              {/* Repeat (desktop) */}
              <button
                onClick={cycleRepeatMode}
                className={`p-1.5 rounded-full transition ${
                  repeatMode !== 'off'
                    ? 'text-blue-400 bg-blue-500/10'
                    : 'text-zinc-500 hover:text-white'
                }`}
                title={`Repeat: ${repeatMode}`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-4 h-4" />
                ) : (
                  <Repeat className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Time readout (desktop) */}
            <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-zinc-500">
              <span>{formatTime(currentTime)}</span>
              <span>/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right: Volume & Utilities */}
          <div className="flex items-center justify-end gap-2 sm:gap-3 flex-1 max-w-[200px]">
            {/* Volume slider (desktop) */}
            <div className="hidden lg:flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="p-1 text-zinc-400 hover:text-white transition"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-zinc-600" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-20 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            {/* Queue Drawer Button */}
            <button
              onClick={() => setIsQueueOpen(true)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition"
              title="Queue"
            >
              <ListMusic className="w-4 h-4" />
            </button>

            {/* Expand Full Player Button */}
            <button
              onClick={() => setIsExpanded(true)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition"
              title="Expand player"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Player Full Modal */}
      <ExpandedPlayerModal
        isOpen={isExpanded}
        onClose={() => setIsExpanded(false)}
        onOpenQueue={() => setIsQueueOpen(true)}
      />

      {/* Queue Drawer */}
      <QueueDrawer isOpen={isQueueOpen} onClose={() => setIsQueueOpen(false)} />
    </>
  );
};
