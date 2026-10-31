import {isServerOnline} from '../serverConnection.js';
import type { Track } from '../../types/index.js';
import { isYoutubeTrack, youtubeVideoId } from '../ytmusic/youtubeMusic.js';
import { createUuid } from '../uuid.js';

/**
 * Per-client session ID for the Chromium bridge. Each browser gets a unique
 * ID (stored in localStorage) so the server can give concurrent users
 * isolated playback sessions — two people can play different songs at once.
 */
export function getBridgeSessionId(): string {
  const KEY = 'sonora-bridge-session';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 's-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 's-fallback-' + Math.random().toString(36).slice(2);
  }
}

export function bridgeHeaders(): Record<string, string> {
  return { 'X-Session-Id': getBridgeSessionId() };
}

let prepareRequest: Promise<void> | null = null;
let prepareAgainAt = 0;

/** Optional, silent warmup. Never request a song or wait for this before play. */
export function prepareYoutubeBridge(): Promise<void> {
  if (prepareRequest) return prepareRequest;
  if (!isServerOnline() || Date.now() < prepareAgainAt) return Promise.resolve();
  // Cool down failures too, including deployments without this optional API.
  prepareAgainAt = Date.now() + 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  prepareRequest = fetch('/api/ytmusic/bridge/prepare', {
    method: 'POST', headers: bridgeHeaders(), signal: controller.signal,
  }).then(async response => {
    if (response.ok) prepareAgainAt = Date.now() + 5 * 60_000;
    await response.body?.cancel();
  }).catch(() => {
    // Warmup is an optimization, not a playback prerequisite.
  }).finally(() => {
    clearTimeout(timeout);
    prepareRequest = null;
  });
  return prepareRequest;
}

export function youtubeStreamUrl(track: Track, start = 0): string {
  const videoId = youtubeVideoId(track);
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube track. Search for it again.');
  // Session ID as query param (<audio src> can't set headers) — isolates
  // this user's playback from other concurrent users on the bridge.
  return `/api/ytmusic/stream/${encodeURIComponent(videoId)}?session=${encodeURIComponent(getBridgeSessionId())}${start > 0 ? `&start=${Math.max(0, start)}` : ''}`;
}

export function youtubeDownloadUrl(track: Track): string {
  const videoId = youtubeVideoId(track);
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube track. Search for it again.');
  return `/api/ytmusic/download/${encodeURIComponent(videoId)}?session=${encodeURIComponent(getBridgeSessionId())}`;
}

export async function fetchTrackAudio(track: Track, signal?: AbortSignal, onProgress?: (state: { phase: 'preparing' | 'recording' | 'fetching' | 'finalizing' | 'waiting_transfer'; progress: number; recordedSeconds: number; sourceDuration: number; sourceBytesDownloaded?: number; sourceTotalBytes?: number }) => Promise<void>): Promise<Response> {
  if (isYoutubeTrack(track)) {
    return fetchYoutubeAudio(track, signal, true, onProgress);
  }
  throw new Error('Search for this song again to stream or download it. Saved local audio remains playable.');
}

/** A single full GET avoids unsupported Range requests while the audio backend transcodes MP3. */
export async function fetchYoutubeAudio(track: Track, signal?: AbortSignal, download = false, onProgress?: (state: { phase: 'preparing' | 'recording' | 'fetching' | 'finalizing' | 'waiting_transfer'; progress: number; recordedSeconds: number; sourceDuration: number; sourceBytesDownloaded?: number; sourceTotalBytes?: number }) => Promise<void>): Promise<Response> {
  const metadata = new URLSearchParams({ title: track.title, artist: track.artist, duration: String(track.duration || 0) });
  const polling = new AbortController();
  const requestId = download && onProgress ? createUuid() : undefined;
  if (requestId) metadata.set('requestId', requestId);
  const cancelPolling = () => polling.abort();
  signal?.addEventListener('abort', cancelPolling, { once: true });
  if (signal?.aborted) cancelPolling();
  let response: Response;
  const pending = fetch(`${download ? youtubeDownloadUrl(track) : youtubeStreamUrl(track)}&${metadata}`, {signal,cache:'no-store'});
  const monitor = requestId ? (async () => {
    while (!polling.signal.aborted) {
      try {
        const status = await fetch(`/api/ytmusic/download-status/${requestId}?session=${encodeURIComponent(getBridgeSessionId())}`, { signal: polling.signal, cache: 'no-store' });
        if (status.ok) {
          const state = await status.json();
          if (!polling.signal.aborted && ['preparing', 'recording', 'fetching', 'finalizing', 'waiting_transfer'].includes(state.phase) && Number.isFinite(state.progress)) {
            await onProgress!({
              phase: state.phase,
              progress: Math.min(95, Math.max(0, state.progress)),
              recordedSeconds: Number.isFinite(state.recordedSeconds) ? state.recordedSeconds : 0,
              sourceDuration: Number.isFinite(state.sourceDuration) ? state.sourceDuration : 0,
              sourceBytesDownloaded: Number.isFinite(state.downloadedBytes) ? Math.max(0, state.downloadedBytes) : 0,
              sourceTotalBytes: Number.isFinite(state.totalBytes) ? Math.max(0, state.totalBytes) : 0,
            });
          }
        }
      } catch { /* Status outages must not abort valid downloads. */ }
      if (!polling.signal.aborted) await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); polling.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 500);
        polling.signal.addEventListener('abort', done, { once: true });
      });
    }
  })() : Promise.resolve();
  try { response = await pending; }
  finally { cancelPolling(); signal?.removeEventListener('abort', cancelPolling); await monitor; }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = data?.details || data?.error;
    throw new Error(typeof detail === 'string' ? detail : 'Sonora audio request failed (HTTP ' + response.status + '). Please retry.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (/text\/|application\/(json|xml)/i.test(contentType)) {
    await response.body?.cancel();
    throw new Error('Sonora audio backend returned a page instead of MP3 audio.');
  }
  return response;
}
