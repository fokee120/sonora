import { prepareOfflineApp, useOfflineAppStatus } from '../../lib/offline/appShell.js';

export function OfflineReadiness() {
  const status = useOfflineAppStatus();
  const messages = {
    preparing: ['Saving the app for offline use…', 'Keep Sonora open and connected until it is ready.'],
    ready: ['Ready to open offline', 'This app is saved on this device. Download songs here before disconnecting.'],
    insecure: ['Open Sonora over HTTPS', 'This address cannot save the app for offline opening. Use the secure Sonora address, then add it to your Home Screen.'],
    development: ['Offline opening unavailable in this preview', 'Use the production Sonora server to install the offline app.'],
    unsupported: ['Offline opening unavailable', 'This browser does not support saving the app. Try Safari on your iPhone.'],
    error: ['The app could not be saved offline', 'Check your connection and available device storage, then try again.'],
  };
  return <div role="status" data-testid="offline-readiness" className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm">
    <p className={status === 'ready' ? 'font-semibold text-emerald-400' : 'font-semibold text-amber-300'}>{messages[status][0]}</p>
    <p className="mt-1 text-xs text-zinc-400">{messages[status][1]}</p>
    {status === 'error' && <button className="mt-3 text-indigo-300" onClick={() => void prepareOfflineApp()}>Try again</button>}
  </div>;
}
