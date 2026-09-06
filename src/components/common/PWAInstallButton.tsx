import React, { useState } from 'react';
import { Download, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall.js';

export const PWAInstallButton: React.FC<{ variant?: 'sidebar' | 'banner' | 'compact' }> = ({
  variant = 'sidebar',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installedNotice, setInstalledNotice] = useState(false);

  if (isInstalled) {
    if (variant === 'sidebar') {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 rounded-lg">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>App Installed</span>
        </div>
      );
    }
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) {
        setInstalledNotice(true);
        setTimeout(() => setInstalledNotice(false), 3000);
      }
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  if (!isInstallable && !isIOS) {
    return null;
  }

  return (
    <>
      <button
        id="pwa-install-btn"
        onClick={handleInstallClick}
        className={`flex items-center gap-2 rounded-xl transition font-medium text-xs ${
          variant === 'sidebar'
            ? 'w-full px-3 py-2 bg-gradient-to-r from-indigo-600/80 to-purple-600/80 hover:from-indigo-600 hover:to-purple-600 text-white shadow-sm border border-indigo-500/20'
            : 'px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60'
        }`}
        title="Install as native PWA app on desktop or mobile"
      >
        <Smartphone className="w-4 h-4 text-indigo-200" />
        <span>{isIOS ? 'Install on iOS' : 'Install App'}</span>
      </button>

      {/* iOS Safari Installation Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl text-zinc-100">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-semibold">Install on iPhone / iPad</h3>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-sm text-zinc-300">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold">
                  1
                </div>
                <p>
                  Tap the Safari <strong>Share</strong> button (box with an arrow pointing up) in the navigation toolbar.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold">
                  2
                </div>
                <p>
                  Scroll down the share sheet and tap <strong>Add to Home Screen</strong>.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold">
                  3
                </div>
                <p>
                  Tap <strong>Add</strong> in the top-right corner. The app will launch in standalone full-screen mode with persistent offline playback!
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-6 w-full rounded-xl bg-zinc-800 hover:bg-zinc-700 py-2.5 text-xs font-semibold text-zinc-100 transition"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {installedNotice && (
        <div className="fixed bottom-24 right-6 z-50 rounded-xl bg-emerald-950 border border-emerald-700/60 p-3 text-emerald-200 text-xs shadow-xl flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>App installed successfully!</span>
        </div>
      )}
    </>
  );
};
