import { Track, PlayerState, RepeatMode, QueueItem } from '../../types/index.js';
import { offlineManager } from '../offline/OfflineManager.js';
import { dbService } from '../db.js';
import { cloudStreamUrl, fetchDriveAudio, isDriveTrack } from './audioSource.js';

type StateListener = (state: PlayerState) => void;
type QueueListener = (queue: QueueItem[]) => void;

export class PlayerEngine {
  private static instance: PlayerEngine;
  private audio: HTMLAudioElement;
  private currentObjectUrl: string | null = null;
  private loadController: AbortController | null = null;
  private stateListeners: Set<StateListener> = new Set();
  private queueListeners: Set<QueueListener> = new Set();

  private queue: QueueItem[] = [];
  private currentQueueIndex = -1;
  private originalQueue: QueueItem[] = []; // For un-shuffling

  private state: PlayerState = {
    currentTrack: null,
    isPlaying: false,
    playbackSource: 'cloud',
    volume: 1.0,
    isMuted: false,
    shuffle: false,
    repeatMode: 'off',
    currentTime: 0,
    duration: 0,
    bufferedTime: 0,
    isLoading: false,
  };

  private retryCount = 0;

  private constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.setupAudioListeners();
    this.setupMediaSession();
    this.restorePersistedState();
  }

  public static getInstance(): PlayerEngine {
    if (!PlayerEngine.instance) {
      PlayerEngine.instance = new PlayerEngine();
    }
    return PlayerEngine.instance;
  }

  private async restorePersistedState(): Promise<void> {
    try {
      const savedVolume = await dbService.getSetting<number>('player_volume', 1.0);
      const savedRepeat = await dbService.getSetting<RepeatMode>('player_repeat', 'off');
      const savedShuffle = await dbService.getSetting<boolean>('player_shuffle', false);
      const savedQueue = await dbService.getSetting<QueueItem[]>('player_queue', []);
      const savedTrack = await dbService.getSetting<Track | null>('player_track', null);

      this.state.volume = savedVolume;
      this.state.repeatMode = savedRepeat;
      this.state.shuffle = savedShuffle;
      this.audio.volume = savedVolume;

      if (savedQueue && savedQueue.length > 0) {
        this.queue = savedQueue;
        this.originalQueue = [...savedQueue];
        if (savedTrack) {
          this.state.currentTrack = savedTrack;
          this.currentQueueIndex = this.queue.findIndex((q) => q.track.id === savedTrack.id);
        }
        this.notifyQueue();
      }
      this.notifyState();
    } catch (err) {
      console.warn('Failed to restore player state:', err);
    }
  }

  private setupAudioListeners(): void {
    this.audio.addEventListener('play', () => {
      this.state.isPlaying = true;
      this.state.isLoading = false;
      this.updateMediaSessionPlaybackState('playing');
      this.notifyState();
    });

    this.audio.addEventListener('pause', () => {
      this.state.isPlaying = false;
      this.updateMediaSessionPlaybackState('paused');
      this.notifyState();
    });

    this.audio.addEventListener('waiting', () => {
      this.state.isLoading = true;
      this.notifyState();
    });

    this.audio.addEventListener('playing', () => {
      this.state.isLoading = false;
      this.notifyState();
    });

    this.audio.addEventListener('timeupdate', () => {
      this.state.currentTime = this.audio.currentTime;
      if (this.audio.duration && !isNaN(this.audio.duration)) {
        this.state.duration = this.audio.duration;
      }
      this.updateMediaSessionPosition();
      this.notifyState();
    });

    this.audio.addEventListener('progress', () => {
      if (this.audio.buffered.length > 0) {
        this.state.bufferedTime = this.audio.buffered.end(this.audio.buffered.length - 1);
        this.notifyState();
      }
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.recordDuration();
      this.state.isLoading = false;
      this.updateMediaSessionPosition();
      this.notifyState();
    });
    this.audio.addEventListener('durationchange', () => this.recordDuration());

    this.audio.addEventListener('ended', () => {
      this.handleTrackEnded();
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio element playback error:', e);
      this.handlePlaybackError();
    });
  }

  private recordDuration(): void {
    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    this.state.duration = duration;
    const track = this.state.currentTrack;
    if (track && Math.abs(track.duration - duration) > 0.01) {
      this.state.currentTrack = { ...track, duration };
      window.dispatchEvent(new CustomEvent('track-duration', { detail: { track, duration } }));
    }
    this.notifyState();
  }

  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;

    const ms = navigator.mediaSession;

    ms.setActionHandler('play', () => this.play());
    ms.setActionHandler('pause', () => this.pause());
    ms.setActionHandler('previoustrack', () => this.previous());
    ms.setActionHandler('nexttrack', () => this.next());
    ms.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined && details.seekTime !== null) {
        this.seek(details.seekTime);
      }
    });
    ms.setActionHandler('seekbackward', (details) => {
      const skip = details.seekOffset || 10;
      this.seek(Math.max(0, this.state.currentTime - skip));
    });
    ms.setActionHandler('seekforward', (details) => {
      const skip = details.seekOffset || 10;
      this.seek(Math.min(this.state.duration, this.state.currentTime + skip));
    });
  }

  private updateMediaSessionMetadata(track: Track): void {
    if (!('mediaSession' in navigator)) return;

    const artworkUrl = track.artworkUrl || '/icon.svg';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: [
        { src: artworkUrl, sizes: '96x96', type: 'image/png' },
        { src: artworkUrl, sizes: '128x128', type: 'image/png' },
        { src: artworkUrl, sizes: '192x192', type: 'image/png' },
        { src: artworkUrl, sizes: '512x512', type: 'image/png' },
      ],
    });
  }

  private updateMediaSessionPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = state;
  }

  private updateMediaSessionPosition(): void {
    if (!('mediaSession' in navigator) || !this.state.duration) return;
    try {
      if ('setPositionState' in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration: this.state.duration || 0,
          playbackRate: this.audio.playbackRate || 1.0,
          position: Math.min(this.state.currentTime || 0, this.state.duration || 0),
        });
      }
    } catch {
      // Ignore position sync issues
    }
  }

  public subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  public subscribeQueue(listener: QueueListener): () => void {
    this.queueListeners.add(listener);
    listener(this.queue);
    return () => this.queueListeners.delete(listener);
  }

  private notifyState(): void {
    for (const listener of this.stateListeners) {
      listener({ ...this.state });
    }
  }

  private notifyQueue(): void {
    for (const listener of this.queueListeners) {
      listener([...this.queue]);
    }
  }

  /**
   * Load and play a specific track
   */
  public async playTrack(track: Track, newQueue?: Track[]): Promise<void> {
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (newQueue && newQueue.length > 0) {
      this.setQueue(newQueue, track);
    } else if (this.queue.length === 0) {
      this.setQueue([track], track);
    }

    this.state.currentTrack = track;
    this.state.isLoading = true;
    this.state.currentTime = 0;
    this.state.duration = track.duration || 0;
    this.state.bufferedTime = 0;
    this.state.error = null;
    this.retryCount = 0;
    this.notifyState();

    // Persist current track
    dbService.setSetting('player_track', track);
    dbService.addHistory(track.id);

    this.updateMediaSessionMetadata(track);

    // Clean previous object URL if any
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    try {
      // Check if we have the track downloaded locally in IndexedDB
      const isDownloaded = offlineManager.isTrackDownloaded(track.id);
      if (isDownloaded) {
        const localBlob = await offlineManager.audioStorage.get(track.id);
        controller.signal.throwIfAborted();
        if (localBlob) {
          const objectUrl = URL.createObjectURL(localBlob);
          this.currentObjectUrl = objectUrl;
          this.state.playbackSource = 'local';
          this.audio.src = objectUrl;
          await this.audio.play();
          this.notifyState();
          return;
        }
      }

      // If offline and track not downloaded, reject
      if (!navigator.onLine) {
        throw new Error('This track is not downloaded for offline playback.');
      }

      this.state.playbackSource = 'cloud';
      if (isDriveTrack(track)) {
        const response = await fetchDriveAudio(track, { signal: controller.signal });
        const blob = await response.blob();
        controller.signal.throwIfAborted();
        this.currentObjectUrl = URL.createObjectURL(blob);
        this.audio.src = this.currentObjectUrl;
      } else {
        const streamUrl = await cloudStreamUrl(track, controller.signal);
        controller.signal.throwIfAborted();
        this.audio.src = streamUrl;
      }
      await this.audio.play();
      this.notifyState();
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.error('Error starting playback:', err);
      this.state.isLoading = false;
      this.state.isPlaying = false;
      this.state.error = err.name === 'NotAllowedError'
        ? 'Audio is ready. Press Play to start.'
        : err.message || 'This audio file could not be played.';
      this.notifyState();
    }
  }

  private async handlePlaybackError(): Promise<void> {
    const track = this.state.currentTrack;
    if (!track) return;
    if (isDriveTrack(track)) {
      this.state.isLoading = false;
      this.state.isPlaying = false;
      this.state.error = 'This browser could not play the audio file. Try another browser or an MP3 version.';
      this.notifyState();
      return;
    }

    // Retry once with a fresh signed URL if online
    if (navigator.onLine && this.retryCount === 0 && this.state.playbackSource === 'cloud') {
      this.retryCount++;
      console.log('Retrying stream with refreshed signed URL...');
      try {
        const res = await fetch(`/api/tracks/${track.id}/stream-url?refresh=true`);
        if (res.ok) {
          const { streamUrl } = await res.json();
          if (streamUrl) {
            this.audio.src = streamUrl;
            await this.audio.play();
            return;
          }
        }
      } catch (err) {
        console.warn('Retry failed:', err);
      }
    }

    // Try fallback to local if available
    const blob = await offlineManager.audioStorage.get(track.id);
    if (blob) {
      const objUrl = URL.createObjectURL(blob);
      this.currentObjectUrl = objUrl;
      this.state.playbackSource = 'local';
      this.audio.src = objUrl;
      await this.audio.play();
    }
  }

  public async play(): Promise<void> {
    this.state.error = null;
    if (this.state.currentTrack) {
      if (!this.audio.src) {
        await this.playTrack(this.state.currentTrack);
      } else {
        try {
          await this.audio.play();
        } catch (err: any) {
          this.state.error = err.message || 'Playback could not start.';
          this.state.isLoading = false;
          this.notifyState();
        }
      }
    } else if (this.queue.length > 0) {
      await this.playTrack(this.queue[0].track);
    }
  }

  public pause(): void {
    this.audio.pause();
  }

  public togglePlay(): void {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  public seek(timeInSeconds: number): void {
    if (this.audio.duration) {
      const clamped = Math.max(0, Math.min(timeInSeconds, this.audio.duration));
      this.audio.currentTime = clamped;
      this.state.currentTime = clamped;
      this.notifyState();
    }
  }

  public setVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(1, vol));
    this.audio.volume = clamped;
    this.state.volume = clamped;
    this.state.isMuted = clamped === 0;
    dbService.setSetting('player_volume', clamped);
    this.notifyState();
  }

  public toggleMute(): void {
    if (this.state.isMuted) {
      this.audio.volume = this.state.volume || 1.0;
      this.state.isMuted = false;
    } else {
      this.audio.volume = 0;
      this.state.isMuted = true;
    }
    this.notifyState();
  }

  public setRepeatMode(mode: RepeatMode): void {
    this.state.repeatMode = mode;
    dbService.setSetting('player_repeat', mode);
    this.notifyState();
  }

  public cycleRepeatMode(): void {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const next = modes[(modes.indexOf(this.state.repeatMode) + 1) % modes.length];
    this.setRepeatMode(next);
  }

  public toggleShuffle(): void {
    const nextShuffle = !this.state.shuffle;
    this.state.shuffle = nextShuffle;
    dbService.setSetting('player_shuffle', nextShuffle);

    if (nextShuffle) {
      // Shuffle queue while keeping current playing track at top
      const current = this.state.currentTrack;
      const otherItems = this.queue.filter((q) => q.track.id !== current?.id);
      // Fisher-Yates shuffle
      for (let i = otherItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [otherItems[i], otherItems[j]] = [otherItems[j], otherItems[i]];
      }
      const currentItem = this.queue.find((q) => q.track.id === current?.id);
      this.queue = currentItem ? [currentItem, ...otherItems] : otherItems;
      this.currentQueueIndex = 0;
    } else {
      // Restore original queue order
      this.queue = [...this.originalQueue];
      if (this.state.currentTrack) {
        this.currentQueueIndex = this.queue.findIndex(
          (q) => q.track.id === this.state.currentTrack?.id
        );
      }
    }

    this.notifyQueue();
    this.notifyState();
  }

  public next(): void {
    if (this.queue.length === 0) return;

    if (this.state.repeatMode === 'one') {
      this.seek(0);
      this.play();
      return;
    }

    let nextIndex = this.currentQueueIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.state.repeatMode === 'all') {
        nextIndex = 0;
      } else {
        return; // End of queue
      }
    }

    this.currentQueueIndex = nextIndex;
    const nextItem = this.queue[nextIndex];
    if (nextItem) {
      this.playTrack(nextItem.track);
    }
  }

  public previous(): void {
    // If more than 3 seconds in, seek to 0 first (standard music player behavior)
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }

    if (this.queue.length === 0) return;

    let prevIndex = this.currentQueueIndex - 1;
    if (prevIndex < 0) {
      if (this.state.repeatMode === 'all') {
        prevIndex = this.queue.length - 1;
      } else {
        prevIndex = 0;
      }
    }

    this.currentQueueIndex = prevIndex;
    const prevItem = this.queue[prevIndex];
    if (prevItem) {
      this.playTrack(prevItem.track);
    }
  }

  private handleTrackEnded(): void {
    if (this.state.repeatMode === 'one') {
      this.seek(0);
      this.play();
      return;
    }
    this.next();
  }

  // Queue Operations
  public setQueue(tracks: Track[], activeTrack?: Track): void {
    this.originalQueue = tracks.map((track) => ({
      track,
      queueId: Math.random().toString(36).substring(2, 9),
    }));

    if (this.state.shuffle) {
      const activeId = activeTrack?.id || tracks[0]?.id;
      const currentItem = this.originalQueue.find((q) => q.track.id === activeId);
      const otherItems = this.originalQueue.filter((q) => q.track.id !== activeId);
      for (let i = otherItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [otherItems[i], otherItems[j]] = [otherItems[j], otherItems[i]];
      }
      this.queue = currentItem ? [currentItem, ...otherItems] : otherItems;
    } else {
      this.queue = [...this.originalQueue];
    }

    const currentId = activeTrack?.id || this.state.currentTrack?.id;
    this.currentQueueIndex = this.queue.findIndex((q) => q.track.id === currentId);
    if (this.currentQueueIndex === -1 && this.queue.length > 0) {
      this.currentQueueIndex = 0;
    }

    dbService.setSetting('player_queue', this.queue);
    this.notifyQueue();
  }

  public playNext(track: Track): void {
    const newItem: QueueItem = {
      track,
      queueId: Math.random().toString(36).substring(2, 9),
    };
    const insertAt = Math.max(0, this.currentQueueIndex + 1);
    this.queue.splice(insertAt, 0, newItem);
    this.originalQueue.push(newItem);
    dbService.setSetting('player_queue', this.queue);
    this.notifyQueue();
  }

  public addToQueue(track: Track): void {
    const newItem: QueueItem = {
      track,
      queueId: Math.random().toString(36).substring(2, 9),
    };
    this.queue.push(newItem);
    this.originalQueue.push(newItem);
    dbService.setSetting('player_queue', this.queue);
    this.notifyQueue();
  }

  public removeFromQueue(queueId: string): void {
    const idx = this.queue.findIndex((q) => q.queueId === queueId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      this.originalQueue = this.originalQueue.filter((q) => q.queueId !== queueId);
      if (this.currentQueueIndex > idx) {
        this.currentQueueIndex--;
      }
      dbService.setSetting('player_queue', this.queue);
      this.notifyQueue();
    }
  }

  public clearQueue(): void {
    if (this.state.currentTrack) {
      const currentItem = this.queue[this.currentQueueIndex];
      this.queue = currentItem ? [currentItem] : [];
      this.originalQueue = this.queue;
      this.currentQueueIndex = 0;
    } else {
      this.queue = [];
      this.originalQueue = [];
      this.currentQueueIndex = -1;
    }
    dbService.setSetting('player_queue', this.queue);
    this.notifyQueue();
  }

  public getQueue(): QueueItem[] {
    return [...this.queue];
  }

  public getState(): PlayerState {
    return { ...this.state };
  }
}

export const playerEngine = PlayerEngine.getInstance();
