import { Track, Album, Playlist, DownloadState, StorageQuotaInfo } from '../../types/index.js';
import { dbService } from '../db.js';
import { IAudioStorage } from './IAudioStorage.js';
import { IndexedDBAudioStorage } from './IndexedDBAudioStorage.js';
import { fetchTrackAudio } from '../audio/audioSource.js';
import { validateAudioBlob } from './audioCompleteness.js';
import { cacheArtwork } from '../artwork.js';

type Listener = () => void;

export class OfflineManager {
  private static instance: OfflineManager;
  public audioStorage: IAudioStorage;
  private activeControllers = new Map<string, AbortController>();
  private downloadQueue: Track[] = [];
  private runningDownloads = 0;
  private readonly maxConcurrentDownloads = 20;
  private listeners: Set<Listener> = new Set();
  private downloadsCache = new Map<string, DownloadState>();
  private playlistBatches = new Map<string, { cancelled: boolean }>();
  private notificationTimer: ReturnType<typeof setTimeout> | null = null;

  private initialization: Promise<void>;
  private playlistUpdates: Promise<void> = Promise.resolve();
  private disabledPlaylists = new Set<string>();
  private constructor() {
    this.audioStorage = new IndexedDBAudioStorage();
    this.initialization = this.init();
    window.addEventListener('sonora:playlist-saved', event => {
      const detail = (event as CustomEvent<{playlist: Playlist; previous?: Playlist}>).detail;
      this.schedulePlaylist(detail.playlist.id, detail.previous);
    });
    window.addEventListener('online', () => { void this.processQueue(); void this.reconcileKeptPlaylists(); });
    void this.initialization.then(() => this.reconcileKeptPlaylists()).catch(error => console.warn('Could not restore offline playlists:', error));
  }

  private schedulePlaylist(id: string, previous?: Playlist): void {
    this.playlistUpdates = this.playlistUpdates.then(async () => {
      await this.initialization;
      const playlist = await dbService.getPlaylist(id);
      if (!playlist || playlist.keepDownloaded === false || this.disabledPlaylists.has(id)) return;
      let keep = playlist.keepDownloaded === true;
      // Older playlists predate saved offline intent. Infer it from the list
      // before an addition, so the new song cannot turn that intent off.
      const priorIds = previous?.trackIds ?? playlist.trackIds;
      if (!keep && priorIds.length) {
        const states = await Promise.all(priorIds.map(trackId => dbService.getDownloadState(trackId)));
        keep = states.every(state => state?.status === 'completed');
        if (keep) await this.setPlaylistOfflineIntent(id, true);
      }
      if (!keep || !navigator.onLine || this.disabledPlaylists.has(id)) return;
      const added = previous?.keepDownloaded === true
        ? playlist.trackIds.filter(trackId => !previous.trackIds.includes(trackId))
        : playlist.trackIds;
      for (const trackId of added) {
        if (this.disabledPlaylists.has(id)) break;
        const latest = await dbService.getPlaylist(id);
        if (!latest || latest.keepDownloaded === false || !latest.trackIds.includes(trackId)) continue;
        const track = await dbService.getTrack(trackId);
        if (track) await this.downloadTrack(track);
      }
    }).catch(error => console.warn('Could not keep playlist offline:', error));
  }

  private async reconcileKeptPlaylists(): Promise<void> {
    await this.initialization;
    for (const playlist of await dbService.getAllPlaylists()) this.schedulePlaylist(playlist.id);
  }

  private async setPlaylistOfflineIntent(id: string, keepDownloaded: boolean): Promise<void> {
    await dbService.mutatePlaylist(id, playlist => ({...playlist, keepDownloaded}));
    window.dispatchEvent(new Event('sonora:playlist-offline-changed'));
  }

  public getPlaylistDownloadProgress(playlist: Playlist): {fraction:number; completed:number; active:number; total:number} {
    const ids = [...new Set(playlist.trackIds)];
    let completed = 0, active = 0, sum = 0;
    for (const id of ids) {
      const state = this.downloadsCache.get(id);
      if (state?.status === 'completed') { completed++; sum++; }
      else if (state?.status === 'downloading' || state?.status === 'queued') {
        active++;
        if (Number.isFinite(state.progress)) sum += Math.max(0, Math.min(.99, state.progress / 100));
      }
    }
    return {fraction: ids.length ? sum / ids.length : 0, completed, active, total: ids.length};
  }

  public static getInstance(): OfflineManager {
    if (!OfflineManager.instance) {
      OfflineManager.instance = new OfflineManager();
    }
    return OfflineManager.instance;
  }

  private async init(): Promise<void> {
    try {
      await this.requestPersistentStorageOnce();
      const records = await dbService.getAllDownloads();
      for (const record of records) {
        if (this.downloadsCache.has(record.trackId)) continue;
        if (record.status === 'queued' || record.status === 'downloading') {
          const track = await dbService.getTrack(record.trackId);
          if (track) { const queued = { ...record, status: 'queued' as const, progress: 0 }; this.downloadsCache.set(record.trackId, queued); this.downloadQueue.push(track); await dbService.saveDownloadState(queued); }
          else { const failed = { ...record, status: 'failed' as const, error: 'Song information is missing. Search for it again.' }; this.downloadsCache.set(record.trackId, failed); await dbService.saveDownloadState(failed); }
        } else this.downloadsCache.set(record.trackId, record);
      }
      this.notify();
      void this.processQueue();
    } catch (err) {
      console.error('Failed to initialize downloads cache:', err);
    }
  }

  private async requestPersistentStorageOnce(): Promise<void> {
    if (!navigator.storage?.persist || !navigator.storage?.persisted) return;
    try {
      const alreadyPersisted = await navigator.storage.persisted();
      if (alreadyPersisted || localStorage.getItem('sonora_storage_persist_requested') === '1') return;
      localStorage.setItem('sonora_storage_persist_requested', '1');
      await navigator.storage.persist();
    } catch (err) {
      console.warn('Failed to request persistent storage:', err);
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.notificationTimer) return;
    this.notificationTimer = setTimeout(() => { this.notificationTimer = null; for (const listener of this.listeners) listener(); }, 100);
  }

  public getDownloadState(trackId: string): DownloadState | undefined {
    return this.downloadsCache.get(trackId);
  }

  public isTrackDownloaded(trackId: string): boolean {
    const state = this.downloadsCache.get(trackId);
    return state?.status === 'completed';
  }

  /** Check legacy files lazily, retaining bytes and all unrelated downloads. */
  public async validateLocalAudio(track: Track, blob: Blob, signal?: AbortSignal): Promise<void> {
    try {
      await validateAudioBlob(blob, track, signal);
    } catch (error) {
      signal?.throwIfAborted();
      const existing = this.downloadsCache.get(track.id);
      if (existing?.status === 'completed') {
        const failed: DownloadState = { ...existing, status: 'failed', progress: 0, error: error instanceof Error ? error.message : 'Offline audio could not be verified. Retry the download.' };
        this.downloadsCache.set(track.id, failed);
        await dbService.saveDownloadState(failed);
        this.notify();
      }
      throw error;
    }
  }

  public isTrackDownloading(trackId: string): boolean {
    const state = this.downloadsCache.get(trackId);
    return state?.status === 'downloading' || state?.status === 'queued';
  }

  public getAlbumDownloadStatus(album: Album): 'downloaded' | 'partial' | 'downloading' | 'none' {
    if (!album.tracks || album.tracks.length === 0) return 'none';
    let downloaded = 0;
    let inProgress = 0;

    for (const track of album.tracks) {
      const state = this.downloadsCache.get(track.id);
      if (state?.status === 'completed') {
        downloaded++;
      } else if (state?.status === 'downloading' || state?.status === 'queued') {
        inProgress++;
      }
    }

    if (downloaded === album.tracks.length) return 'downloaded';
    if (inProgress > 0) return 'downloading';
    if (downloaded > 0) return 'partial';
    return 'none';
  }

  public getPlaylistDownloadStatus(playlist: Playlist): 'downloaded' | 'partial' | 'downloading' | 'none' {
    if (!playlist.trackIds || playlist.trackIds.length === 0) return 'none';
    let downloaded = 0;
    let inProgress = 0;

    for (const trackId of playlist.trackIds) {
      const state = this.downloadsCache.get(trackId);
      if (state?.status === 'completed') {
        downloaded++;
      } else if (state?.status === 'downloading' || state?.status === 'queued') {
        inProgress++;
      }
    }

    if (downloaded === playlist.trackIds.length) return 'downloaded';
    if (inProgress > 0) return 'downloading';
    if (downloaded > 0) return 'partial';
    return 'none';
  }

  public getAllDownloadedTrackIds(): Set<string> {
    const set = new Set<string>();
    for (const [trackId, state] of this.downloadsCache.entries()) {
      if (state.status === 'completed') {
        set.add(trackId);
      }
    }
    return set;
  }

  /**
   * Download a single track
   */
  public async downloadTrack(track: Track): Promise<void> {
    // If already downloaded or in progress, return
    const current = this.downloadsCache.get(track.id);
    if (current?.status === 'completed' || current?.status === 'downloading' || current?.status === 'queued') {
      return;
    }

    // Add to queue
    this.downloadQueue.push(track);
    const initialDownloadState: DownloadState = {
      trackId: track.id,
      status: 'queued',
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: track.sizeBytes || 0,
    };

    this.downloadsCache.set(track.id, initialDownloadState);
    await dbService.saveDownloadState(initialDownloadState);
    await dbService.saveTracks([track]); // cache track metadata locally
    if (this.downloadsCache.get(track.id) !== initialDownloadState) return;
    this.notify();

    this.processQueue();
  }

  /**
   * Process queued downloads
   */
  private async processQueue(): Promise<void> {
    if (!navigator.onLine) return;
    while (this.downloadQueue.length > 0 && this.runningDownloads < this.maxConcurrentDownloads) {
      const track = this.downloadQueue.shift();
      if (!track) break;

      // Double check if cancelled
      const currentState = this.downloadsCache.get(track.id);
      if (!currentState || currentState.status !== 'queued') {
        continue;
      }

      this.runningDownloads++;
      void this.executeTrackDownload(track).catch(error => console.error('Download worker failed:', error)).finally(() => { this.runningDownloads--; void this.processQueue(); });
    }
  }

  private async executeTrackDownload(track: Track): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(track.id, controller);

    const updateState = async (updates: Partial<DownloadState>) => {
      const existing = this.downloadsCache.get(track.id) || {
        trackId: track.id,
        status: 'queued' as const,
        progress: 0,
        bytesDownloaded: 0,
        totalBytes: track.sizeBytes || 0,
      };
      const updated: DownloadState = { ...existing, ...updates };
      this.downloadsCache.set(track.id, updated);
      await dbService.saveDownloadState(updated);
      this.notify();
    };

    try {
      await updateState({ status: 'downloading', progress: 0, phase: 'preparing', recordedSeconds: 0, sourceDuration: 0 });
      // Cover failures never discard a successfully downloaded song.
      const artworkTask = track.artworkUrl ? cacheArtwork(track).catch(() => null) : Promise.resolve(null);

      const audioRes = await fetchTrackAudio(track, controller.signal, async progress => {
        if (!controller.signal.aborted) await updateState(progress);
      });
      controller.signal.throwIfAborted();
      await updateState({ phase: 'transferring' });
      const mimeType = audioRes.headers.get('content-type') || 'application/octet-stream';

      const contentLength = audioRes.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      if (!audioRes.body) {
        const blob = await audioRes.blob();
        await updateState({ phase: 'validating', progress: 98 });
        await validateAudioBlob(blob, track, controller.signal, audioRes);
        controller.signal.throwIfAborted();
        await this.audioStorage.save(track.id, blob, blob.type || 'audio/mpeg');
        await artworkTask;
        await updateState({
          status: 'completed',
          progress: 100,
          bytesDownloaded: blob.size,
          totalBytes: blob.size,
          downloadedAt: Date.now(),
        });
        return;
      }

      const reader = audioRes.body.getReader();
      let receivedBytes = 0;
      const chunks: Uint8Array[] = [];
      let lastTransferUpdate = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        const baseline = this.downloadsCache.get(track.id)?.progress || 0;
        const progress = totalBytes > 0 ? Math.max(baseline, Math.min(98, Math.round((receivedBytes / totalBytes) * 98))) : baseline;
        if (Date.now() - lastTransferUpdate < 250) continue;
        lastTransferUpdate = Date.now();
        await updateState({
          progress,
          bytesDownloaded: receivedBytes,
          totalBytes,
        });
      }

      // Combine into Blob
      if (receivedBytes === 0) throw new Error('The audio provider returned an empty file.');
      const combinedBlob = new Blob(chunks, { type: mimeType });
      controller.signal.throwIfAborted();

      await updateState({ phase: 'validating', progress: 98 });
      await validateAudioBlob(combinedBlob, track, controller.signal, audioRes);
      controller.signal.throwIfAborted();

      // Store only after checking the actual downloaded audio.
      await this.audioStorage.save(track.id, combinedBlob, mimeType);
      await artworkTask;

      // Step 4: Finalize metadata
      await updateState({
        status: 'completed',
        progress: 100,
        bytesDownloaded: combinedBlob.size,
        totalBytes: combinedBlob.size,
        downloadedAt: Date.now(),
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Cancelled by user
        this.downloadsCache.delete(track.id);
        await dbService.removeDownloadState(track.id);
      } else {
        console.error(`Download failed for track ${track.title}:`, err);
        await updateState({
          status: 'failed',
          error: err.message || 'Download failed',
        });
      }
    } finally {
      this.activeControllers.delete(track.id);
      this.notify();
    }
  }

  /**
   * Download all tracks in an album
   */
  public async downloadAlbum(album: Album): Promise<void> {
    if (!album.tracks || album.tracks.length === 0) return;
    for (const track of album.tracks) {
      await this.downloadTrack(track);
    }
  }

  /**
   * Download all tracks in a playlist
   */
  public async downloadPlaylist(playlist: Playlist, tracks: Track[]): Promise<void> {
    this.disabledPlaylists.delete(playlist.id);
    await this.setPlaylistOfflineIntent(playlist.id, true);
    const batch = { cancelled: false }; this.playlistBatches.set(playlist.id, batch);
    const trackMap = new Map(tracks.map((t) => [t.id, t]));
    for (const trackId of playlist.trackIds) {
      if (batch.cancelled || this.disabledPlaylists.has(playlist.id)) break;
      const track = trackMap.get(trackId);
      if (track) {
        await this.downloadTrack(track);
      }
    }
    if (this.playlistBatches.get(playlist.id) === batch) this.playlistBatches.delete(playlist.id);
  }

  public cancelPlaylistDownloads(playlist: Playlist): void {
    this.disabledPlaylists.add(playlist.id);
    void this.setPlaylistOfflineIntent(playlist.id, false).catch(() => {});
    const batch = this.playlistBatches.get(playlist.id); if (batch) batch.cancelled = true;
    for (const id of playlist.trackIds) if (this.isTrackDownloading(id)) this.cancelDownload(id);
  }

  /**
   * Cancel an active or queued download
   */
  public cancelDownload(trackId: string): void {
    const controller = this.activeControllers.get(trackId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(trackId);
    }

    // Remove from in-memory queue
    this.downloadQueue = this.downloadQueue.filter((t) => t.id !== trackId);
    this.downloadsCache.delete(trackId);
    dbService.removeDownloadState(trackId);
    this.notify();
  }

  /**
   * Remove a single downloaded track
   */
  public async removeTrackDownload(trackId: string): Promise<void> {
    this.cancelDownload(trackId);
    await this.audioStorage.delete(trackId);
    await dbService.removeDownloadState(trackId);
    this.downloadsCache.delete(trackId);
    this.notify();
  }

  /**
   * Remove entire album download
   */
  public async removeAlbumDownload(album: Album): Promise<void> {
    if (!album.tracks) return;
    for (const track of album.tracks) {
      await this.removeTrackDownload(track.id);
    }
  }

  /**
   * Remove entire playlist download
   */
  public async removePlaylistDownload(playlist: Playlist): Promise<void> {
    this.disabledPlaylists.add(playlist.id);
    await this.setPlaylistOfflineIntent(playlist.id, false);
    for (const trackId of playlist.trackIds) {
      await this.removeTrackDownload(trackId);
    }
  }

  /**
   * Clear all offline downloads and cache
   */
  public async clearAllDownloads(): Promise<void> {
    for (const playlist of await dbService.getAllPlaylists()) {
      this.disabledPlaylists.add(playlist.id);
      if (playlist.keepDownloaded !== false) await this.setPlaylistOfflineIntent(playlist.id, false);
    }
    // Abort any active downloads
    for (const controller of this.activeControllers.values()) {
      controller.abort();
    }
    this.activeControllers.clear();
    this.downloadQueue = [];
    this.downloadsCache.clear();

    await this.audioStorage.clear();
    this.notify();
  }

  /**
   * Request persistent storage (critical for iOS/Safari PWA)
   */
  public async requestPersistentStorage(): Promise<boolean> {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        return isPersisted;
      } catch (err) {
        console.warn('Failed to request persistent storage:', err);
        return false;
      }
    }
    return false;
  }

  /**
   * Estimate browser storage usage
   */
  public async getStorageEstimate(): Promise<StorageQuotaInfo> {
    let usage = 0;
    let quota = 0;
    let persisted = false;

    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        usage = estimate.usage || 0;
        quota = estimate.quota || 0;
      } catch (err) {
        console.warn('Storage estimate failed:', err);
      }
    }

    if (navigator.storage && navigator.storage.persisted) {
      try {
        persisted = await navigator.storage.persisted();
      } catch {
        persisted = false;
      }
    }

    let downloadCount = 0;
    let downloadSize = 0;

    for (const state of this.downloadsCache.values()) {
      if (state.status === 'completed') {
        downloadCount++;
        downloadSize += state.bytesDownloaded || 0;
      }
    }

    return {
      usage,
      quota,
      usageMB: Number((usage / (1024 * 1024)).toFixed(1)),
      quotaMB: Number((quota / (1024 * 1024)).toFixed(1)),
      percentUsed: quota > 0 ? Number(((usage / quota) * 100).toFixed(1)) : 0,
      persisted,
      trackCount: downloadCount,
      downloadSizeMB: Number((downloadSize / (1024 * 1024)).toFixed(1)),
    };
  }
}

export const offlineManager = OfflineManager.getInstance();
