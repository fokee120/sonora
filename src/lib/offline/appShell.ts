import { useSyncExternalStore } from 'react';
import { playerEngine } from '../audio/PlayerEngine.js';

type Status = 'preparing' | 'ready' | 'insecure' | 'development' | 'unsupported' | 'error';
let status: Status = 'preparing';
let watchingUpdates = false;
const listeners = new Set<() => void>();
const publish = (next: Status) => {
  status = next;
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useOfflineAppStatus = () => useSyncExternalStore(subscribe, () => status);

// Activation only happens after Workbox has finished caching the app shell.
// Never clear downloaded music or reload the page while a song is playing.
export async function prepareOfflineApp() {
  if (!window.isSecureContext) { publish('insecure'); return; }
  if (import.meta.env.DEV) { publish('development'); return; }
  if (!('serviceWorker' in navigator)) { publish('unsupported'); return; }
  publish('preparing');
  if (!watchingUpdates) {
    watchingUpdates = true;
    const previousController = navigator.serviceWorker.controller;
    let updating = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Initial installation doesn't need a reload. A replacement worker can
      // control this page while it still runs the old JavaScript bundle.
      if (!previousController || updating || navigator.serviceWorker.controller === previousController) return;
      updating = true;
      let unsubscribe: (() => void) | undefined;
      let reloading = false;

      const reloadWhenIdle = (state: ReturnType<typeof playerEngine.getState>) => {
        // A paused iOS element still owns the lock-screen session. Reloading
        // here discards that session even though no music is currently audible.
        const retainedNativeSource = document.querySelector('audio[data-sonora-player][src]');
        if (reloading || state.isPlaying || state.isLoading || document.visibilityState !== 'visible' || retainedNativeSource) return;
        reloading = true;
        queueMicrotask(() => { unsubscribe?.(); document.removeEventListener('visibilitychange', onVisibility); location.reload(); });
      };
      const onVisibility = () => reloadWhenIdle(playerEngine.getState());
      document.addEventListener('visibilitychange', onVisibility);
      unsubscribe = playerEngine.subscribe(reloadWhenIdle);
    });
  }
  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.getRegistration('/');
    if (registration?.active?.scriptURL === new URL('/sw.js', location.href).href) publish('ready');
    registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/', updateViaCache: 'none',
    });
    const check = () => {
      if (registration?.active?.state === 'activated') publish('ready');
    };
    const watch = () => {
      const worker = registration?.installing;
      worker?.addEventListener('statechange', () => {
        check();
        if (worker.state === 'redundant' && !registration?.active) publish('error');
      });
      check();
    };
    registration.addEventListener('updatefound', watch);
    watch();
  } catch (error) {
    // A saved, active worker remains usable when an update cannot be fetched offline.
    if (registration?.active?.scriptURL === new URL('/sw.js', location.href).href) publish('ready');
    else publish('error');
    console.warn('Offline app setup:', error);
  }
}
