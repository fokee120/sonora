import React, { useState } from 'react';
import {
  HardDriveDownload,
  Trash2,
  ShieldCheck,
  Play,
  Shuffle,
  AlertTriangle,
  RefreshCw,
  Database,
  Smartphone,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';

export const DownloadsView: React.FC = () => {
  const {
    tracks,
    storageInfo,
    refreshStorageInfo,
    clearAllDownloads,
    requestPersistStorage,
  } = useApp();

  const { playTrack, setQueue } = usePlayer();
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [isPersisting, setIsPersisting] = useState(false);

  // Filter downloaded tracks
  const downloadedIds = offlineManager.getAllDownloadedTrackIds();
  const downloadedTracks = tracks.filter((t) => downloadedIds.has(t.id));

  const handlePlayAll = (shuffle = false) => {
    if (downloadedTracks.length === 0) return;
    setQueue(downloadedTracks, downloadedTracks[0]);
    playTrack(downloadedTracks[0], downloadedTracks);
  };

  const handleRequestPersist = async () => {
    setIsPersisting(true);
    await requestPersistStorage();
    setIsPersisting(false);
  };

  const handleClear = async () => {
    await clearAllDownloads();
    setShowConfirmClear(false);
  };

  return (
    <div id="downloads-view" className="space-y-8 pb-12">
      {/* Header & Storage Gauge Card */}
      <div className="p-6 sm:p-8 rounded-3xl bg-zinc-900/60 border border-zinc-800/80 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <HardDriveDownload className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Offline Downloads</h1>
              <p className="text-xs text-zinc-400">
                IndexedDB Binary Audio Storage & Safari PWA Cache
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshStorageInfo()}
              className="p-2 text-zinc-400 hover:text-white rounded-xl bg-zinc-800 hover:bg-zinc-700 transition"
              title="Refresh quota estimate"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {downloadedTracks.length > 0 && (
              <button
                onClick={() => setShowConfirmClear(true)}
                className="px-3 py-2 text-xs font-medium text-rose-400 hover:text-white hover:bg-rose-950/60 border border-rose-900/40 rounded-xl transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            )}
          </div>
        </div>

        {/* Quota Meter */}
        {storageInfo && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 space-y-1">
              <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Downloaded Songs
              </span>
              <p className="text-2xl font-bold font-mono text-emerald-400">
                {storageInfo.trackCount}
              </p>
              <p className="text-[11px] text-zinc-500">Stored in IndexedDB Audio Store</p>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 space-y-1">
              <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Storage Used
              </span>
              <p className="text-2xl font-bold font-mono text-indigo-400">
                {storageInfo.downloadSizeMB} MB
              </p>
              <p className="text-[11px] text-zinc-500">
                of ~{storageInfo.quotaMB > 1024 ? `${(storageInfo.quotaMB / 1024).toFixed(1)} GB` : `${storageInfo.quotaMB} MB`} browser quota
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 space-y-2 flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Persistent Storage
                </span>
                <div className="flex items-center gap-1.5 mt-1">
                  <ShieldCheck
                    className={`w-4 h-4 ${
                      storageInfo.isPersisted ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  />
                  <span
                    className={`text-xs font-semibold ${
                      storageInfo.isPersisted ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {storageInfo.isPersisted ? 'Storage Protected' : 'Not Persisted'}
                  </span>
                </div>
              </div>

              {!storageInfo.isPersisted && (
                <button
                  onClick={handleRequestPersist}
                  disabled={isPersisting}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 text-[11px] font-medium transition"
                >
                  {isPersisting ? 'Requesting...' : 'Request Protection'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Safari & iOS PWA Notes */}
        <div className="p-3.5 rounded-2xl bg-zinc-950/40 border border-zinc-800/50 text-xs text-zinc-400 flex items-start gap-3">
          <Smartphone className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>iOS & Safari PWA Optimization:</strong> Stored directly as raw binary blobs in IndexedDB. When added to your Home Screen as a standalone PWA, iOS grants persistent offline storage without Safari cache purge cycles.
          </p>
        </div>

        {/* Playback Actions */}
        {downloadedTracks.length > 0 && (
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => handlePlayAll(false)}
              className="px-5 py-2.5 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-xs flex items-center gap-2 transition shadow-lg"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>Play All Downloaded</span>
            </button>
            <button
              onClick={() => handlePlayAll(true)}
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs flex items-center gap-2 border border-zinc-700 transition"
            >
              <Shuffle className="w-4 h-4" />
              <span>Shuffle</span>
            </button>
          </div>
        )}
      </div>

      {/* Downloaded Track List */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-white tracking-tight">Downloaded Tracks</h2>

        <div className="divide-y divide-zinc-900/60 rounded-2xl bg-zinc-900/20 border border-zinc-800/50 p-1">
          {downloadedTracks.length === 0 ? (
            <div className="py-20 text-center text-zinc-500 text-xs">
              <HardDriveDownload className="w-8 h-8 mx-auto mb-2 opacity-30 text-zinc-400" />
              <p>No tracks downloaded for offline playback yet.</p>
              <p className="text-zinc-600 mt-1">
                Click the download icon on any song, album, or playlist to save it locally.
              </p>
            </div>
          ) : (
            downloadedTracks.map((track, idx) => (
              <TrackRow
                key={`downloaded-${track.id}`}
                track={track}
                index={idx}
                tracksContext={downloadedTracks}
              />
            ))
          )}
        </div>
      </div>

      {/* Confirm Clear Modal */}
      {showConfirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-zinc-950 border border-zinc-800 p-6 shadow-2xl text-zinc-100">
            <div className="flex items-center gap-3 text-rose-400 mb-3">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-semibold">Clear All Downloads?</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This will remove all {downloadedTracks.length} cached audio blobs from IndexedDB. You can re-download them whenever you are connected to the internet.
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                onClick={handleClear}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-xl shadow-lg transition"
              >
                Clear Downloads
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
