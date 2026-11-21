type ConnectionState = {isOnline: boolean; isChecking: boolean; lastChecked: number; audioCacheGeneration?: string};
let state: ConnectionState = {isOnline: typeof navigator === 'undefined' || navigator.onLine, isChecking: false, lastChecked: 0};
const listeners = new Set<() => void>();
let pending: Promise<boolean> | null = null, active: AbortController | null = null, revision = 0;
const publish = (patch: Partial<ConnectionState>) => { state = {...state, ...patch}; for (const listener of listeners) listener(); };
export const getConnectionState = () => state;
export const subscribeConnection = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
// The server probe is authoritative; Safari's device flag can lag behind connectivity.
export const isServerOnline = () => state.isOnline;
function cancelProbe() {
  revision++;
  active?.abort();
  active = null;
  pending = null;
}
export function markNetworkOffline() {
  cancelProbe();
  publish({isOnline: false, isChecking: false, lastChecked: Date.now()});
}
export function checkServerConnection(): Promise<boolean> {
  if (pending) return pending;
  const generation = revision, controller = new AbortController(); active = controller;
  publish({isChecking: true});
  const job = (async () => {
    let online = false;
    let audioCacheGeneration = state.audioCacheGeneration;
    // A PWA resuming on iOS or a busy mobile connection may fail the first
    // request. Confirm failure before disabling songs and stopping playback.
    for (let attempt = 0; attempt < 2 && !controller.signal.aborted; attempt++) {
      const timeout = new AbortController();
      const abort = () => timeout.abort();
      controller.signal.addEventListener('abort', abort, {once: true});
      const timer = setTimeout(abort, 6000);
      try {
        const response = await fetch('/api/health?t=' + Date.now(), {
          signal: timeout.signal, cache: 'no-store', credentials: 'omit', priority: 'high',
        });
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const data = await response.json();
          online = data.status === 'ok';
          if (online) audioCacheGeneration = typeof data.audioCacheGeneration === 'string' ? data.audioCacheGeneration : undefined;
        } else await response.body?.cancel();
      } catch { online = false; }
      finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
      if (online) break;
    }
    if (generation === revision) publish({isOnline: online, isChecking: false, lastChecked: Date.now(), audioCacheGeneration});
    return isServerOnline();
  })().finally(() => { if (pending === job) { pending = null; active = null; } });
  pending = job;
  return job;
}

export function reconnectToServer(): Promise<boolean> {
  cancelProbe();
  return checkServerConnection();
}
