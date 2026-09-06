import React from 'react';
import { WifiOff, RefreshCw, HardDriveDownload } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, recheckConnection, displayTracks } = useApp();

  if (isOnline) return null;

  return (
    <div
      id="offline-indicator-banner"
      className="bg-black/70 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-200 flex items-center justify-between backdrop-blur-xl sticky top-0 z-30 transition"
    >
      <div className="flex items-center gap-2.5">
        <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]" />
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-400">Offline Mode</span>
        <span className="text-zinc-400 hidden sm:inline text-xs">— Playing from local IndexedDB storage</span>
      </div>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-zinc-300 text-[11px] font-mono">
          <HardDriveDownload className="w-3.5 h-3.5 text-amber-400" />
          <span>{displayTracks.length} cached</span>
        </span>

        <button
          onClick={() => recheckConnection()}
          className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-amber-500/30 text-amber-300 flex items-center gap-1.5 transition text-xs"
          title="Retry network connection"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Reconnect</span>
        </button>
      </div>
    </div>
  );
};
