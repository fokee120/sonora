import { Track, Album, Playlist, DownloadState, StorageQuotaInfo } from '../../types/index.js';
import { dbService } from '../db.js';
import { IAudioStorage } from './IAudioStorage.js';
import { IndexedDBAudioStorage } from './IndexedDBAudioStorage.js';
import { getDriveAccessToken } from '../googleAuth.js';

type Listener = () => void;

export class OfflineManager {
  private static instance: OfflineManager;
  public audioStorage: IAudioStorage;
  private activeControllers = new Map<string, AbortController>();
  private downloadQueue: Track[] = [];
  private isProcessingQueue = false;
  private listeners: Set<Listener> = new Set();
  private downloadsCache = new Map<string, DownloadState>();

  private constructor() {
    this.audioStorage = new IndexedDBAudioStorage();
    this.init();
  }

  public static getInstance(): OfflineManager {
    if (!OfflineManager.instance) {
      OfflineManager.instance = new OfflineManager();
    }
    return OfflineManager.instance;
  }

  private async init(): Promise<void> {
    try {
      const records = await dbService.getAllDownloads();
      for (const record of records) {
        this.downloadsCache.set(record.trackId, record);
      }
      this.notify();
    } catch (err) {
      console.error('Failed to initialize downloads cache:', err);
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public getDownloadState(trackId: string): DownloadState | undefined {
    return this.downloadsCache.get(trackId);
  }

  public isTrackDownloaded(trackId: string): boolean {
    const state = this.downloadsCache.get(trackId);
    return state?.status === 'completed';
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
    if (current?.status === 'completed' || current?.status === 'downloading') {
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
    this.notify();

    this.processQueue();
  }

  /**
   * Process queued downloads
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.downloadQueue.length > 0) {
      const track = this.downloadQueue.shift();
      if (!track) break;

      // Double check if cancelled
      const currentState = this.downloadsCache.get(track.id);
      if (!currentState || currentState.status !== 'queued') {
        continue;
      }

      await this.executeTrackDownload(track);
    }

    this.isProcessingQueue = false;
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
      await updateState({ status: 'downloading', progress: 5 });

      // Step 1: Request signed stream URL from API
      const driveToken = getDriveAccessToken();
      const queryParam = driveToken ? `?token=${encodeURIComponent(driveToken)}` : '';
      const res = await fetch(`/api/tracks/${track.id}/stream-url${queryParam}`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Failed to obtain signed URL (${res.status})`);
      }

      const { streamUrl } = await res.json();
      if (!streamUrl) {
        throw new Error('No stream URL received');
      }

      // Step 2: Fetch audio in browser with progress tracking
      const audioRes = await fetch(streamUrl, {
        signal: controller.signal,
      });

      if (!audioRes.ok) {
        throw new Error(`Failed to fetch audio stream (${audioRes.status})`);
      }

      const contentLength = audioRes.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : track.sizeBytes || 4000000;

      if (!audioRes.body) {
        const blob = await audioRes.blob();
        await this.audioStorage.save(track.id, blob, blob.type || 'audio/mpeg');
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        const progress = Math.min(98, Math.round((receivedBytes / totalBytes) * 100));
        await updateState({
          progress,
          bytesDownloaded: receivedBytes,
          totalBytes,
        });
      }

      // Combine into Blob
      const combinedBlob = new Blob(chunks, { type: 'audio/mpeg' });

      // Step 3: Store raw binary Blob inside IndexedDB
      await this.audioStorage.save(track.id, combinedBlob, 'audio/mpeg');

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
    const trackMap = new Map(tracks.map((t) => [t.id, t]));
    for (const trackId of playlist.trackIds) {
      const track = trackMap.get(trackId);
      if (track) {
        await this.downloadTrack(track);
      }
    }
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
    for (const trackId of playlist.trackIds) {
      await this.removeTrackDownload(trackId);
    }
  }

  /**
   * Clear all offline downloads and cache
   */
  public async clearAllDownloads(): Promise<void> {
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
