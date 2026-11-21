import { useSyncExternalStore } from 'react';
import { playerEngine } from '../audio/PlayerEngine.js';
import { getConnectionState, subscribeConnection } from '../serverConnection.js';
import { offlineManager } from './OfflineManager.js';

type Status = 'preparing' | 'ready' | 'insecure' | 'development' | 'unsupported' | 'error';
type UpdateStatus = 'idle' | 'installing' | 'waiting' | 'restarting';

let status: Status = 'preparing';
let updateStatus: UpdateStatus = 'idle';
const listeners = new Set<() => void>();
const publish = (next: Status) => {
  if (status === next) return;
  status = next;
  listeners.forEach(listener => listener());
};
const publishUpdate = (next: UpdateStatus) => {
  if (updateStatus === next) return;
  updateStatus = next;
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useOfflineAppStatus = () => useSyncExternalStore(subscribe, () => status);
export const useAppUpdateStatus = () => useSyncExternalStore(subscribe, () => updateStatus);

let registration: ServiceWorkerRegistration | undefined;
let setup: Promise<void> | undefined;
let watching = false;
let updateRequested = true;
let checking = false;
let lastCheckAt = 0;
let wasConnected = false;
let restartPending = false;
let restartScheduled = false;
const watchedWorkers = new WeakSet<ServiceWorker>();

function canRestart(): boolean {
  return document.visibilityState === 'visible' && playerEngine.canRestartForUpdate()
    && !offlineManager.hasPendingDownloads()
    && !document.querySelector('audio[data-sonora-player][src]');
}

function applyWhenIdle(): void {
  if (!restartPending || restartScheduled) return;
  if (!canRestart()) {
    publishUpdate('waiting');
    return;
  }

  restartScheduled = true;
  publishUpdate('restarting');
  // The worker activates after precaching. Defer the page reload until
  // playback and downloads are idle, even if another tab installed it.
  setTimeout(() => {
    if (!canRestart()) {
      restartScheduled = false;
      publishUpdate('waiting');
      return;
    }
    playerEngine.savePositionForUpdate();
    location.reload();
  }, 250);
}

function checkForUpdate(): void {
  const connection = getConnectionState();
  if (!connection.isOnline || connection.isChecking || !connection.lastChecked) return;
  if (!registration) {
    void prepareOfflineApp();
    return;
  }
  if (checking || registration.installing || registration.waiting || restartPending) return;
  if (!updateRequested && Date.now() - lastCheckAt < 60_000) return;

  checking = true;
  updateRequested = false;
  lastCheckAt = Date.now();
  void registration.update().catch(() => {
    // A failed request leaves the existing offline shell usable.
  }).finally(() => {
    checking = false;
    if (updateRequested) checkForUpdate();
  });
}

function watchUpdates(): void {
  if (watching) return;
  watching = true;
  let controller = navigator.serviceWorker.controller;
  wasConnected = getConnectionState().lastChecked > 0 && getConnectionState().isOnline;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const next = navigator.serviceWorker.controller;
    if (!next || next === controller) return;
    const replacing = !!controller;
    controller = next;
    publish('ready');
    if (replacing) {
      restartPending = true;
      applyWhenIdle();
    }
  });

  subscribeConnection(() => {
    const connection = getConnectionState();
    if (connection.isChecking || !connection.lastChecked) return;
    if (connection.isOnline && !wasConnected) updateRequested = true;
    wasConnected = connection.isOnline;
    checkForUpdate();
  });
  const onOpen = () => {
    if (document.visibilityState !== 'visible') return;
    updateRequested = true;
    checkForUpdate();
    applyWhenIdle();
  };
  window.addEventListener('pageshow', onOpen);
  document.addEventListener('visibilitychange', onOpen);
  playerEngine.subscribe(applyWhenIdle);
  offlineManager.subscribe(applyWhenIdle);
}

function watchInstallation(): void {
  if (!registration) return;
  if (registration.active?.state === 'activated') publish('ready');
  const worker = registration.installing;
  if (worker && !watchedWorkers.has(worker)) {
    watchedWorkers.add(worker);
    if (registration.active) publishUpdate('installing');
    worker.addEventListener('statechange', () => {
      if (worker.state === 'redundant') {
        publishUpdate('idle');
        if (!registration?.active) publish('error');
      }
      if (worker.state === 'activated') publish('ready');
    });
  }
  applyWhenIdle();
}

export function prepareOfflineApp(): Promise<void> {
  if (!window.isSecureContext) { publish('insecure'); return Promise.resolve(); }
  if (import.meta.env.DEV) { publish('development'); return Promise.resolve(); }
  if (!('serviceWorker' in navigator)) { publish('unsupported'); return Promise.resolve(); }
  if (setup) return setup;
  watchUpdates();

  setup = (async () => {
    try {
      if (!registration) {
        registration = await navigator.serviceWorker.getRegistration('/');
        if (!registration) {
          registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        }
        registration.addEventListener('updatefound', watchInstallation);
      }
      watchInstallation();
      checkForUpdate();
    } catch (error) {
      publish(registration?.active ? 'ready' : 'error');
      console.warn('Offline app setup:', error);
    }
  })().finally(() => { setup = undefined; });
  return setup;
}
