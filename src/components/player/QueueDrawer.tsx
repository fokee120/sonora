import React from 'react';
import { X, Trash2, Play, Music2 } from 'lucide-react';
import { usePlayer } from '../../hooks/usePlayer.js';

interface QueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QueueDrawer: React.FC<QueueDrawerProps> = ({ isOpen, onClose }) => {
  const { queue, currentTrack, playTrack, removeFromQueue, clearQueue } = usePlayer();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-zinc-950 border-l border-zinc-800/80 h-full flex flex-col shadow-2xl p-5 text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80">
          <div className="flex items-center gap-2">
            <Music2 className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold">Play Queue</h2>
            <span className="text-xs text-zinc-500 font-mono">({queue.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {queue.length > 1 && (
              <button
                onClick={clearQueue}
                className="text-xs text-zinc-400 hover:text-rose-400 px-2 py-1 rounded-md hover:bg-zinc-900 transition flex items-center gap-1"
                title="Clear upcoming queue"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Current Playing Song */}
        {currentTrack && (
          <div className="my-4 p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/20">
            <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 block mb-2">
              Now Playing
            </span>
            <div className="flex items-center gap-3">
              <img
                src={currentTrack.artworkUrl || '/icon.svg'}
                alt={currentTrack.title}
                className="w-11 h-11 rounded-lg object-cover bg-zinc-900"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/icon.svg';
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">{currentTrack.title}</p>
                <p className="text-xs text-indigo-200/70 truncate">{currentTrack.artist}</p>
              </div>
            </div>
          </div>
        )}

        {/* Upcoming List */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 block mb-2 px-1">
            Next Up
          </span>

          {queue.length <= 1 ? (
            <div className="py-12 text-center text-zinc-500 text-xs">
              <p>No more songs in queue.</p>
              <p className="text-zinc-600 mt-1">Play an album or playlist to queue up tracks!</p>
            </div>
          ) : (
            queue.map((item, idx) => {
              const isCurrent = item.track.id === currentTrack?.id;
              if (isCurrent) return null;

              return (
                <div
                  key={item.queueId || `${item.track.id}_${idx}`}
                  className="group flex items-center justify-between p-2 rounded-xl hover:bg-zinc-900 transition"
                >
                  <div
                    onClick={() => playTrack(item.track)}
                    className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  >
                    <span className="text-xs font-mono text-zinc-600 w-5 text-center">
                      {idx + 1}
                    </span>
                    <img
                      src={item.track.artworkUrl || '/icon.svg'}
                      alt={item.track.title}
                      className="w-9 h-9 rounded-lg object-cover bg-zinc-900 shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/icon.svg';
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-zinc-200 group-hover:text-white truncate">
                        {item.track.title}
                      </p>
                      <p className="text-[11px] text-zinc-500 truncate">{item.track.artist}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={() => playTrack(item.track)}
                      className="p-1.5 text-zinc-400 hover:text-white rounded-md"
                      title="Play now"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                    </button>
                    <button
                      onClick={() => removeFromQueue(item.queueId)}
                      className="p-1.5 text-zinc-500 hover:text-rose-400 rounded-md"
                      title="Remove from queue"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
