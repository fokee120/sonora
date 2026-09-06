import React, { useState } from 'react';
import {
  ChevronDown,
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
  HardDriveDownload,
  Cloud,
  FileText,
  ListMusic,
  Download,
  CheckCircle2,
} from 'lucide-react';
import { usePlayer } from '../../hooks/usePlayer.js';
import { useApp } from '../../context/AppContext.js';

interface ExpandedPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenQueue: () => void;
}

export const ExpandedPlayerModal: React.FC<ExpandedPlayerModalProps> = ({
  isOpen,
  onClose,
  onOpenQueue,
}) => {
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
  } = usePlayer();

  const { isFavorite, toggleFavorite, isDownloaded, downloadTrack, removeDownload } = useApp();
  const [showLyrics, setShowLyrics] = useState(false);

  if (!isOpen || !currentTrack) return null;

  const favorite = isFavorite(currentTrack.id);
  const downloaded = isDownloaded(currentTrack.id);

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      id="expanded-player-modal"
      className="fixed inset-0 z-50 flex flex-col bg-[#050505]/95 backdrop-blur-2xl p-6 sm:p-10 select-none overflow-y-auto animate-fade-in text-white relative"
    >
      {/* Ambient background bloom */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 30%, rgba(59,130,246,0.12) 0%, transparent 60%), radial-gradient(circle at 80% 80%, rgba(147,51,234,0.08) 0%, transparent 50%)',
        }}
      />

      {/* Top Header */}
      <div className="relative z-10 flex items-center justify-between max-w-2xl w-full mx-auto pb-4">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition"
          title="Minimize player"
        >
          <ChevronDown className="w-6 h-6" />
        </button>

        <div className="text-center">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 block">
            Playing From {playbackSource === 'local' ? 'Offline Cache' : 'Cloud Storage'}
          </span>
          <p className="text-xs font-medium text-zinc-300 truncate max-w-xs">{currentTrack.album}</p>
        </div>

        <button
          onClick={() => setShowLyrics(!showLyrics)}
          className={`p-2 rounded-xl border text-xs font-medium transition flex items-center gap-1.5 ${
            showLyrics
              ? 'bg-blue-600 text-white border-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]'
              : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
          }`}
          title="Toggle lyrics view"
        >
          <FileText className="w-4 h-4" />
          <span className="hidden sm:inline">Lyrics</span>
        </button>
      </div>

      {/* Main Content Area: Artwork or Lyrics */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center max-w-md w-full mx-auto my-4 min-h-[260px]">
        {showLyrics ? (
          <div className="w-full h-80 glass-card rounded-2xl p-6 overflow-y-auto text-sm leading-relaxed text-zinc-300 font-sans shadow-inner">
            <h3 className="text-xs uppercase font-bold text-blue-400 tracking-wider mb-3">Lyrics</h3>
            {currentTrack.lyrics ? (
              <p className="whitespace-pre-line text-zinc-200">{currentTrack.lyrics}</p>
            ) : (
              <p className="text-zinc-500 italic py-12 text-center">
                No embedded lyrics found for this track.
              </p>
            )}
          </div>
        ) : (
          <div className="relative w-64 h-64 sm:w-80 sm:h-80 rounded-3xl overflow-hidden shadow-2xl shadow-black/90 border border-white/10 bg-zinc-950">
            <img
              src={currentTrack.artworkUrl || '/icon.svg'}
              alt={currentTrack.album}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/icon.svg';
              }}
            />
            {/* Playback Source Badge */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium backdrop-blur-md bg-black/70 border border-white/15 text-white shadow-md">
              {playbackSource === 'local' ? (
                <>
                  <HardDriveDownload className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Offline Blob</span>
                </>
              ) : (
                <>
                  <Cloud className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-blue-300">GCS Cloud</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Track Info & Actions */}
      <div className="relative z-10 max-w-md w-full mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="text-xl font-bold text-white truncate tracking-tight">
              {currentTrack.title}
            </h2>
            <p className="text-sm text-zinc-400 truncate mt-0.5">{currentTrack.artist}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => (downloaded ? removeDownload(currentTrack.id) : downloadTrack(currentTrack))}
              className={`p-2.5 rounded-full border transition ${
                downloaded
                  ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
              }`}
              title={downloaded ? 'Downloaded to IndexedDB' : 'Download for offline playback'}
            >
              {downloaded ? <CheckCircle2 className="w-5 h-5" /> : <Download className="w-5 h-5" />}
            </button>

            <button
              onClick={() => toggleFavorite(currentTrack.id)}
              className={`p-2.5 rounded-full border transition ${
                favorite
                  ? 'bg-rose-950/60 border-rose-800/60 text-rose-500'
                  : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
              }`}
              title={favorite ? 'Liked' : 'Like'}
            >
              <Heart className={`w-5 h-5 ${favorite ? 'fill-rose-500' : ''}`} />
            </button>
          </div>
        </div>

        {/* Progress Bar with seeking */}
        <div className="space-y-1.5">
          <div
            className="relative w-full h-2 bg-white/10 rounded-full cursor-pointer group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              seek(pct * duration);
            }}
          >
            <div
              className="h-full bg-blue-500 group-hover:bg-blue-400 rounded-full transition-all shadow-[0_0_12px_rgba(59,130,246,0.6)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-mono text-zinc-500">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-between py-2">
          {/* Shuffle */}
          <button
            onClick={toggleShuffle}
            className={`p-2 rounded-full transition ${
              shuffle ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-500 hover:text-white'
            }`}
            title={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
          >
            <Shuffle className="w-5 h-5" />
          </button>

          {/* Previous */}
          <button
            onClick={previous}
            className="p-3 rounded-full text-zinc-300 hover:text-white hover:bg-white/5 transition"
            title="Previous track"
          >
            <SkipBack className="w-6 h-6 fill-current" />
          </button>

          {/* Play/Pause Main Button */}
          <button
            onClick={togglePlay}
            className="w-16 h-16 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-2xl"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-7 h-7 fill-current" />
            ) : (
              <Play className="w-7 h-7 fill-current ml-1" />
            )}
          </button>

          {/* Next */}
          <button
            onClick={next}
            className="p-3 rounded-full text-zinc-300 hover:text-white hover:bg-white/5 transition"
            title="Next track"
          >
            <SkipForward className="w-6 h-6 fill-current" />
          </button>

          {/* Repeat */}
          <button
            onClick={cycleRepeatMode}
            className={`p-2 rounded-full transition ${
              repeatMode !== 'off'
                ? 'text-blue-400 bg-blue-500/10'
                : 'text-zinc-500 hover:text-white'
            }`}
            title={`Repeat: ${repeatMode}`}
          >
            {repeatMode === 'one' ? (
              <Repeat1 className="w-5 h-5" />
            ) : (
              <Repeat className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Volume & Queue Bottom Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <div className="flex items-center gap-2 flex-1 max-w-[180px]">
            <button
              onClick={toggleMute}
              className="p-1.5 text-zinc-400 hover:text-white"
              title="Mute / Unmute"
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
              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>

          <button
            onClick={() => {
              onClose();
              onOpenQueue();
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-zinc-300 border border-white/10 transition"
          >
            <ListMusic className="w-4 h-4 text-blue-400" />
            <span>Queue</span>
          </button>
        </div>
      </div>
    </div>
  );
};
