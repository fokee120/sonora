import React, { useEffect, useState } from 'react';
import { Youtube, RefreshCw } from 'lucide-react';
import { fetchYoutubeMusicStatus, type YtmStatus } from '../../lib/ytmusic/youtubeMusic.js';

export const YoutubeMusicCard: React.FC = () => {
  const [status, setStatus] = useState<YtmStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadStatus = async () => {
    setRefreshing(true);
    try { setStatus(await fetchYoutubeMusicStatus()); }
    finally { setRefreshing(false); }
  };
  useEffect(() => { void loadStatus(); }, []);
  const bridge = status?.bridge?.mode === 'chromium';

  return (
    <section className="p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/80 shadow-xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 bg-red-500/10 text-red-400 border border-red-500/20">
            <Youtube className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">YouTube Music Integration</h2>
            <p aria-live="polite" className="text-xs text-zinc-400 mt-1">
              {refreshing ? 'Checking playback service…' : bridge ? 'Chromium bridge' : 'Playback service status unavailable'}
            </p>
          </div>
        </div>
        <button onClick={loadStatus} disabled={refreshing} title="Refresh integration status" aria-label="Refresh integration status"
          className="p-2 text-zinc-400 hover:text-white rounded-xl bg-zinc-800 hover:bg-zinc-700 transition disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed">
        Search the YouTube Music catalog and stream through an isolated browser player. No separate audio-service account or cloud bucket is required.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-xl bg-zinc-950/60 border border-zinc-800 p-3">
          <div className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold">Playback</div>
          <div className="text-zinc-200 mt-1">WebM / Opus; MP3 for iOS</div>
        </div>
        <div className="rounded-xl bg-zinc-950/60 border border-zinc-800 p-3">
          <div className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold">Downloads</div>
          <div className="text-zinc-200 mt-1">Direct file retrieval with transfer progress</div>
        </div>
        <div className="rounded-xl bg-zinc-950/60 border border-zinc-800 p-3">
          <div className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold">Offline storage</div>
          <div className="text-zinc-200 mt-1">Verified audio saved on this device</div>
        </div>
      </div>
      <div className="text-[11px] text-zinc-500 leading-relaxed border-t border-zinc-800/80 pt-4">
        Downloads fetch the source audio file instead of recording playback, then verify the full file before saving. Speed depends on your connection and source availability. Bot checks or unavailable tracks produce an error, not a different song or a slow recording fallback.
      </div>
    </section>
  );
};
