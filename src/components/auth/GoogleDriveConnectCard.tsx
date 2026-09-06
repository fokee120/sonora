import React, { useState } from 'react';
import { HardDrive, RefreshCw, LogOut, CheckCircle2, AlertCircle, Folder, Music } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { signInWithGoogleDrive, logoutGoogleDrive } from '../../lib/googleAuth.js';

interface GoogleDriveConnectCardProps {
  compact?: boolean;
}

export const GoogleDriveConnectCard: React.FC<GoogleDriveConnectCardProps> = ({ compact = false }) => {
  const {
    driveUser,
    isDriveConnected,
    isScanningDrive,
    scanGoogleDrive,
    setDriveUser,
    tracks,
  } = useApp();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await signInWithGoogleDrive();
      if (res) {
        setDriveUser(res.user);
        await scanGoogleDrive();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in with Google Drive');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Google Drive and clear your login from the server?')) return;
    try {
      await logoutGoogleDrive();
      setDriveUser(null);
    } catch (err: any) {
      console.error(err);
    }
  };

  if (compact) {
    if (isDriveConnected && driveUser) {
      return (
        <div className="flex items-center gap-2">
          <button
            onClick={() => scanGoogleDrive()}
            disabled={isScanningDrive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-zinc-200 border border-white/10 transition"
            title="Scan Google Drive for new MP3 files"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isScanningDrive ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isScanningDrive ? 'Scanning...' : 'Sync Drive'}</span>
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={handleSignIn}
        disabled={isLoading}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-sm"
      >
        <HardDrive className="w-3.5 h-3.5" />
        <span>{isLoading ? 'Connecting...' : 'Connect Google Drive'}</span>
      </button>
    );
  }

  return (
    <section className="p-6 rounded-3xl bg-zinc-900/60 border border-zinc-800 shadow-xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500/20 via-blue-500/20 to-emerald-500/20 border border-white/10 flex items-center justify-center text-indigo-400 shadow-inner">
            <HardDrive className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Google Drive Audio Integration</h2>
              {isDriveConnected ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                  <CheckCircle2 className="w-3 h-3" /> Connected
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 text-[10px] font-semibold">
                  Not Connected
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-1 max-w-xl">
              Streams your personal MP3, M4A, and FLAC library directly from Google Drive.
              Login is saved securely on the server so you sign in once and enjoy continuous streaming across sessions.
            </p>
          </div>
        </div>

        {isDriveConnected && (
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800/80 hover:bg-rose-500/10 hover:border-rose-500/20 text-zinc-400 hover:text-rose-300 text-xs font-medium border border-zinc-700 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Disconnect</span>
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isDriveConnected && driveUser ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center font-bold text-indigo-300 text-xs">
              {driveUser.displayName ? driveUser.displayName.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{driveUser.displayName || 'Google Account'}</p>
              <p className="text-[11px] text-zinc-400 truncate">{driveUser.email}</p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Folder className="w-4 h-4 text-emerald-400" />
              <div>
                <span className="text-[11px] text-zinc-500 block uppercase font-mono">Drive Tracks</span>
                <span className="text-sm font-bold text-white">{tracks.length} indexed</span>
              </div>
            </div>
            <button
              onClick={() => scanGoogleDrive()}
              disabled={isScanningDrive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanningDrive ? 'animate-spin' : ''}`} />
              <span>{isScanningDrive ? 'Scanning...' : 'Rescan'}</span>
            </button>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 flex items-center gap-2.5">
            <Music className="w-4 h-4 text-indigo-400" />
            <div>
              <span className="text-[11px] text-zinc-500 block uppercase font-mono">Metadata Engine</span>
              <span className="text-xs font-medium text-zinc-200">ID3v2 & Albums Active</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800">
          <div>
            <p className="text-xs font-semibold text-white">Sign in once to connect Google Drive</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Login is retained on the server side so you can stream your audio collection seamlessly without signing in again.
            </p>
          </div>

          {/* Official styled Sign in with Google button */}
          <button
            id="gdrive-sign-in-btn"
            onClick={handleSignIn}
            disabled={isLoading}
            className="flex items-center justify-center gap-3 px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 font-semibold text-xs shadow-md transition active:scale-95 disabled:opacity-50 shrink-0"
          >
            <svg className="w-4 h-4" viewBox="0 0 48 48">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>{isLoading ? 'Connecting...' : 'Sign in with Google'}</span>
          </button>
        </div>
      )}
    </section>
  );
};
