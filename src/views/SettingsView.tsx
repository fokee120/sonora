import React, { useState } from 'react';
import { HardDrive, CheckCircle2, AlertCircle, Smartphone } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { PWAInstallButton } from '../components/common/PWAInstallButton.js';
import { usePWAInstall } from '../hooks/usePWAInstall.js';
import { GoogleDriveConnectCard } from '../components/auth/GoogleDriveConnectCard.js';
import { YoutubeMusicCard } from '../components/settings/YoutubeMusicCard.js';
import { AccountCard } from '../components/account/AccountCard.js';
import { ImportPlaylistModal } from '../components/playlist/ImportPlaylistModal.js';

export const SettingsView: React.FC = () => {
  const { storageInfo, refreshStorageInfo, requestPersistStorage, clearAllDownloads } = useApp();
  const { isInstalled } = usePWAInstall();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isPersisting, setIsPersisting] = useState(false);
  const [persistMessage, setPersistMessage] = useState<string | null>(null);
  const handlePersist = async () => {
    setIsPersisting(true);
    setPersistMessage(null);
    try {
      if (!navigator.storage?.persist) {
        setPersistMessage('This browser does not support storage protection requests. Downloads are still available.');
        return;
      }
      const granted = await requestPersistStorage();
      setPersistMessage(granted
        ? 'Storage protection is enabled on this device.'
        : 'The browser did not grant protection. Downloads still work, but the browser may remove them when space is low.');
    } catch {
      setPersistMessage('Could not request storage protection. Please try again.');
    } finally {
      setIsPersisting(false);
    }
  };

  return (
    <div id="settings-view" className="space-y-8 pb-16 max-w-4xl">
      <h1 className="text-2xl font-bold">Settings & Storage</h1>
      <p className="text-xs text-zinc-400">Google Drive, YouTube Music, offline downloads, and app installation.</p>
      <AccountCard />
      <GoogleDriveConnectCard />
      <YoutubeMusicCard />
      <section className="p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/80 shadow-xl space-y-4">
        <h2 className="text-sm font-bold text-white">Import playlist by URL</h2>
        <p className="text-xs text-zinc-400">
          Spotify or YouTube Music playlist links are matched to playable YouTube Music tracks.
          Unmatched entries are listed, never silently replaced. Spotify needs
          SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET on the Sonora host.
        </p>
        <p className="text-xs text-zinc-400">
          YouTube Music profile suggestions: not connected yet. Sonora&apos;s bridge uses anonymous
          Chromium sessions, so there is no signed-in YTM home feed to read. Suggested songs on Home
          are taste-derived searches instead, until a YTM login is added to the bridge.
        </p>
        <button onClick={() => setIsImportOpen(true)}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition">
          Import a playlist
        </button>
      </section>
      <ImportPlaylistModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
      <section className="p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/80 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Browser Storage & IndexedDB</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Downloaded audio files (MP3, M4A, FLAC, WAV) are stored securely in IndexedDB as raw binary Blobs.
            </p>
          </div>
        </div>

        {storageInfo && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800 space-y-1">
              <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                IndexedDB Audio Blobs
              </span>
              <p className="text-lg font-bold font-mono text-white">
                {storageInfo.trackCount} Tracks ({storageInfo.downloadSizeMB} MB)
              </p>
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => refreshStorageInfo()}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  Recalculate Size
                </button>
                {storageInfo.trackCount > 0 && (
                  <button
                    onClick={() => clearAllDownloads()}
                    className="text-xs text-rose-400 hover:text-rose-300 font-medium"
                  >
                    Clear All Files
                  </button>
                )}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800 space-y-2">
              <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Storage Eviction Protection
              </span>
              <div className="flex items-center gap-2">
                {storageInfo.persisted ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                )}
                <span className="text-xs font-semibold text-zinc-200">
                  {storageInfo.persisted ? 'Storage is Persistent' : 'Storage is Best-Effort'}
                </span>
              </div>
              {!storageInfo.persisted && (
                <button
                  onClick={handlePersist}
                  disabled={isPersisting}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
                >
                  {isPersisting ? 'Requesting...' : 'Request Persistent Storage'}
                </button>
              )}
              {persistMessage && <p role="status" className="text-xs text-zinc-300">{persistMessage}</p>}
            </div>
          </div>
        )}
      </section>

      {/* PWA Installation & Safari Instructions */}
      <section className="p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/80 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Progressive Web App (PWA)</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Install the player as a standalone native app on iOS, macOS, Android, or Windows.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800">
          <div>
            <p className="text-xs font-semibold text-zinc-200">
              {isInstalled ? 'App is currently running in Standalone PWA Mode' : 'Install Standalone Application'}
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Provides full-screen media playback, hardware media key integration, and lock-screen controls.
            </p>
          </div>
          <div className="shrink-0">
            <PWAInstallButton variant="banner" />
          </div>
        </div>
      </section>

    </div>
  );
};
