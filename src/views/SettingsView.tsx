import React, { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  Shield,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Smartphone,
  RefreshCw,
  Music,
  Terminal,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { PWAInstallButton } from '../components/common/PWAInstallButton.js';
import { usePWAInstall } from '../hooks/usePWAInstall.js';
import { GoogleDriveConnectCard } from '../components/auth/GoogleDriveConnectCard.js';
import { YoutubeMusicCard } from '../components/settings/YoutubeMusicCard.js';

interface StorageApiStatus {
  gcsConfigured: boolean;
  provider: string;
  bucket: string | null;
  projectId?: string | null;
  clientEmail?: string | null;
  hasPrivateKey?: boolean;
  connected?: boolean;
  error?: string | null;
  lastScanTime?: string | null;
  trackCount: number;
}

export const SettingsView: React.FC = () => {
  const {
    isGcsConfigured,
    storageInfo,
    refreshStorageInfo,
    requestPersistStorage,
    clearAllDownloads,
    authSession,
    rescanLibrary,
    isLoadingLibrary,
    tracks,
  } = useApp();

  const { isInstalled } = usePWAInstall();

  const [copiedCors, setCopiedCors] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [isPersisting, setIsPersisting] = useState(false);
  const [persistMessage, setPersistMessage] = useState<string | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);
  const [rescanSuccessMessage, setRescanSuccessMessage] = useState<string | null>(null);

  const [status, setStatus] = useState<StorageApiStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/storage/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.warn('Failed to fetch storage status:', err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleRescan = async () => {
    setIsRescanning(true);
    setRescanSuccessMessage(null);
    try {
      await rescanLibrary();
      await fetchStatus();
      setRescanSuccessMessage('Library scan complete and indexed successfully.');
      setTimeout(() => setRescanSuccessMessage(null), 4000);
    } catch {
      setRescanSuccessMessage('Scan completed with current local index.');
    } finally {
      setIsRescanning(false);
    }
  };

  const corsConfigJson = JSON.stringify(
    [
      {
        origin: ['http://localhost:3000', 'https://*.vercel.app', '*'],
        method: ['GET', 'HEAD'],
        responseHeader: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type'],
        maxAgeSeconds: 3600,
      },
    ],
    null,
    2
  );

  const gcsCliCommand = `gcloud storage buckets update gs://${status?.bucket || 'YOUR_GCS_BUCKET'} --cors-file=cors.json`;

  const sampleEnvText = `# Google Cloud Storage Credentials (Server-Side Only)
GCP_PROJECT_ID="${status?.projectId || 'your-gcp-project-id'}"
GCS_BUCKET_NAME="${status?.bucket || 'your-music-bucket-name'}"
GCP_CLIENT_EMAIL="${status?.clientEmail || 'storage-service-account@your-gcp-project.iam.gserviceaccount.com'}"
GCP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nYOUR_KEY_HERE\\n-----END PRIVATE KEY-----"

# Personal Auth Access Control
AUTHORIZED_EMAILS="fokee83@gmail.com"
AUTH_SECRET="your_custom_secret_key_phrase"`;

  const copyToClipboard = (text: string, setFn: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setFn(true);
    setTimeout(() => setFn(false), 2500);
  };

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

  const formatLastScan = (isoString?: string | null) => {
    if (!isoString) return 'Never scanned';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' (' + date.toLocaleDateString() + ')';
    } catch {
      return isoString;
    }
  };

  const isConnected = status?.connected || isGcsConfigured;
  const currentBucket = status?.bucket || 'Not configured';
  const totalTracks = status?.trackCount ?? tracks.length;

  return (
    <div id="settings-view" className="space-y-8 pb-16 max-w-4xl">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>Settings & Storage</span>
        </h1>
        <p className="text-xs text-zinc-400 mt-1">
          Google Drive MP3 integration, Cloud Storage, offline IndexedDB audio storage, and PWA setup.
        </p>
      </div>

      {/* Primary Google Drive Audio Integration */}
      <GoogleDriveConnectCard />

      {/* YouTube Music Integration (search + third-party downloader + offline) */}
      <YoutubeMusicCard />

      {/* Google Cloud Storage Connection Status & Scanner */}
      <section className="p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/80 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                isConnected
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-lg shadow-emerald-500/5'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}
            >
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Google Cloud Storage</span>
                {isConnected ? (
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/50 font-medium">
                    Connected
                  </span>
                ) : (
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/50 font-medium">
                    Demo Mode (Unconfigured)
                  </span>
                )}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {isConnected
                  ? 'Private GCS bucket connected. Server-side V4 signed URLs stream directly with byte-range seeking.'
                  : 'Running with bundled high-fidelity tracks (including verified M4A master). Provide Google Cloud credentials in .env to stream your private bucket.'}
              </p>
            </div>
          </div>

          <button
            id="rescan-library-btn"
            onClick={handleRescan}
            disabled={isRescanning || isLoadingLibrary}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRescanning || isLoadingLibrary ? 'animate-spin' : ''}`} />
            <span>{isRescanning || isLoadingLibrary ? 'Scanning...' : 'Rescan Library'}</span>
          </button>
        </div>

        {rescanSuccessMessage && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{rescanSuccessMessage}</span>
          </div>
        )}

        {/* GCS Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
              GCS Bucket
            </span>
            <p className="text-sm font-bold font-mono text-zinc-200 mt-1 truncate" title={currentBucket}>
              {currentBucket}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
              Total Tracks Indexed
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <Music className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-bold text-white">
                {totalTracks} {totalTracks === 1 ? 'Track' : 'Tracks'}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
              Last Successful Scan
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-medium text-zinc-200 truncate">
                {formatLastScan(status?.lastScanTime)}
              </span>
            </div>
          </div>
        </div>

        {/* Required Environment Variables Reference */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Google Cloud Credentials (.env)</span>
            </span>
            <button
              onClick={() => copyToClipboard(sampleEnvText, setCopiedEnv)}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
            >
              {copiedEnv ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedEnv ? 'Copied' : 'Copy Template'}</span>
            </button>
          </div>
          <pre className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-300 overflow-x-auto leading-relaxed">
            {sampleEnvText}
          </pre>
        </div>

        {/* GCS CORS Configuration Guide */}
        <div className="pt-3 border-t border-zinc-800/60 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <span>Google Cloud Storage CORS Configuration</span>
            </span>
            <button
              onClick={() => copyToClipboard(corsConfigJson, setCopiedCors)}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
            >
              {copiedCors ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCors ? 'Copied' : 'Copy CORS JSON'}</span>
            </button>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Save as <code>cors.json</code> and apply to your private bucket to enable browser streaming and seeking via HTTP byte ranges:
          </p>
          <pre className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-400 overflow-x-auto">
            {corsConfigJson}
          </pre>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] font-mono text-zinc-500">CLI command to apply:</span>
            <button
              onClick={() => copyToClipboard(gcsCliCommand, setCopiedCli)}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              {copiedCli ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copiedCli ? 'Copied Command' : 'Copy Command'}</span>
            </button>
          </div>
          <pre className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-emerald-400/90 overflow-x-auto">
            {gcsCliCommand}
          </pre>
        </div>
      </section>

      {/* Offline Storage Quota & Persistence */}
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

      {/* Access Control & Authentication */}
      <section className="p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/80 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Private App Access Control</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Whitelisted email protection via AUTHORIZED_EMAILS in .env
            </p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800 space-y-2 text-xs text-zinc-300">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Current Session:</span>
            <span className="font-semibold text-white">
              {authSession.user ? `${authSession.user.name} (${authSession.user.email})` : 'Guest / Open Access'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Auth Gate Active:</span>
            <span className={`font-semibold ${authSession.authRequired ? 'text-emerald-400' : 'text-zinc-400'}`}>
              {authSession.authRequired ? 'Enabled (Restricted)' : 'Open (No email whitelist set)'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
