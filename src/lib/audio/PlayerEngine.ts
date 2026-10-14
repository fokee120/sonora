import { Track, PlayerState, RepeatMode, QueueItem } from '../../types/index.js';
import { offlineManager } from '../offline/OfflineManager.js';
import { dbService } from '../db.js';
import { fetchDriveAudio, isDriveTrack, youtubeStreamUrl, bridgeHeaders, prepareYoutubeBridge } from './audioSource.js';
import { isYoutubeTrack } from '../ytmusic/youtubeMusic.js';
import { logPerf, perfNow } from '../perf.js';

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

  private sourceOffset = 0;
  private nativeSeekOnMetadata = 0;
  private pendingSeek: number | null = null;
  private wantsPlayback = false;
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private currentLoadStartedAt = 0;

  private constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.setupAudioListeners();
    this.setupMediaSession();
    this.restorePersistedState();
    // User interaction warms only the isolated browser, never a song.
    const warmup = () => { void prepareYoutubeBridge(); };
    document.addEventListener('pointerdown', warmup, { passive: true });
    document.addEventListener('keydown', warmup);
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
      if (this.loadController) return;

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
    const audio = this.audio;
    const listen = (event: string, callback: (event: Event) => void) => {
      audio.addEventListener(event, (event) => {
        if (this.audio !== audio || this.loadController?.signal.aborted) return;
        callback(event);
      });
    };
    listen('play', () => {
      if (!this.wantsPlayback) { audio.pause(); return; }
      // A play request is not evidence that decoded audio is flowing.
      this.state.isLoading = true;
      this.armLoadingTimeout();
      this.notifyState();
    });

    listen('pause', () => {
      this.state.isPlaying = false;
      this.updateMediaSessionPlaybackState('paused');
      this.notifyState();
    });

    listen('waiting', () => {
      if (!this.wantsPlayback) return;
      this.state.isLoading = true;
      this.armLoadingTimeout();
      this.notifyState();
    });

    listen('playing', () => {
      if (!this.wantsPlayback) { audio.pause(); return; }
      this.clearLoadingTimeout();
      this.state.isPlaying = true;
      this.updateMediaSessionPlaybackState('playing');
      this.state.isLoading = false;
      if (this.currentLoadStartedAt) {
        logPerf('player playing', this.currentLoadStartedAt, { source: this.state.playbackSource });
        this.currentLoadStartedAt = 0;
      }
      this.notifyState();
    });

    listen('timeupdate', () => {
      this.state.currentTime = this.sourceOffset + this.audio.currentTime;
      if (!this.isLiveCapture() && !this.hasLocalCatalogDuration() && Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.state.duration = this.audio.duration;
      }
      this.updateMediaSessionPosition();
      this.notifyState();
    });

    listen('progress', () => {
      if (this.audio.buffered.length > 0) {
        this.state.bufferedTime = this.sourceOffset + this.audio.buffered.end(this.audio.buffered.length - 1);
        this.notifyState();
      }
    });

    listen('loadedmetadata', () => {
      this.recordDuration();
      if (!this.isLiveCapture() && this.nativeSeekOnMetadata > 0) {
        audio.currentTime = Math.min(this.nativeSeekOnMetadata, this.state.duration || this.nativeSeekOnMetadata);
        this.nativeSeekOnMetadata = 0;
      }
      if (this.currentLoadStartedAt) {
        logPerf('player metadata', this.currentLoadStartedAt, { source: this.state.playbackSource });
      }
      this.updateMediaSessionPosition();
      this.notifyState();
    });
    listen('durationchange', () => this.recordDuration());

    listen('ended', () => {
      this.handleTrackEnded();
    });

    listen('error', (e) => {
      console.warn('Audio element playback error:', e);
      this.handlePlaybackError();
    });
  }

  private isLiveCapture(): boolean {
    return this.state.playbackSource === 'cloud' && !!this.state.currentTrack && isYoutubeTrack(this.state.currentTrack);
  }

  private clearLoadingTimeout(): void {
    if (this.loadingTimer) clearTimeout(this.loadingTimer);
    this.loadingTimer = null;
  }

  private armLoadingTimeout(): void {
    if (this.loadingTimer) return;
    const audio = this.audio;
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = null;
      if (this.audio !== audio || !this.wantsPlayback) return;
      this.failPlayback('Audio loading timed out. Check your connection and press Play to retry.');
    }, 30_000);
  }

  private failPlayback(message: string): void {
    this.clearLoadingTimeout();
    this.loadController?.abort();
    this.wantsPlayback = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.state.isLoading = false;
    this.state.isPlaying = false;
    this.state.error = message;
    this.updateMediaSessionPlaybackState('paused');
    this.notifyState();
  }

  private hasLocalCatalogDuration(): boolean {
    const track = this.state.currentTrack;
    return this.state.playbackSource === 'local' && !!track && isYoutubeTrack(track) && Number.isFinite(track.duration) && track.duration > 0;
  }

  private recordDuration(): void {
    // Capture/file duration must not rewrite a known YouTube catalog duration.
    if (this.isLiveCapture() || this.hasLocalCatalogDuration()) return;
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
    return this.loadTrack(track, newQueue);
  }

  private async loadTrack(track: Track, newQueue?: Track[], offset = 0, recovery = false): Promise<void> {
    this.clearLoadingTimeout();
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    // Each load owns a media element, so queued events from the old resource
    // cannot be mistaken for events from the replacement track.
    const previousAudio = this.audio;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = this.state.isMuted ? 0 : this.state.volume;
    this.setupAudioListeners();
    previousAudio.pause();
    previousAudio.removeAttribute('src');
    previousAudio.load();
    this.state.isPlaying = false;
    if (newQueue && newQueue.length > 0) {
      this.setQueue(newQueue, track);
    } else if (this.queue.length === 0) {
      this.setQueue([track], track);
    } else {
      const index = this.queue.findIndex(item => item.track.id === track.id);
      if (index >= 0) this.currentQueueIndex = index;
    }

    this.state.currentTrack = track;
    this.state.isLoading = true;
    this.sourceOffset = isYoutubeTrack(track) ? offset : 0;
    this.nativeSeekOnMetadata = isYoutubeTrack(track) ? 0 : offset;
    this.pendingSeek = null;
    this.wantsPlayback = true;
    this.state.currentTime = offset;
    this.state.duration = track.duration || 0;
    this.state.bufferedTime = 0;
    this.state.error = null;
    if (!recovery) this.retryCount = 0;
    this.currentLoadStartedAt = perfNow();
    this.armLoadingTimeout();
    this.notifyState();

    // Persist current track
    if (!recovery) {
      dbService.setSetting('player_track', track);
      dbService.addHistory(track.id);
    }

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
          await offlineManager.validateLocalAudio(track, localBlob, controller.signal);
          controller.signal.throwIfAborted();
          const objectUrl = URL.createObjectURL(localBlob);
          this.currentObjectUrl = objectUrl;
          this.state.playbackSource = 'local';
          this.sourceOffset = 0;
          this.nativeSeekOnMetadata = offset;
          this.audio.src = objectUrl;
          if (!this.wantsPlayback) return;
          await this.audio.play();
          if (controller.signal.aborted) return;
          this.notifyState();
          return;
        }
      }

      // If offline and track not downloaded, reject
      if (!navigator.onLine) {
        throw new Error('This track is not downloaded for offline playback.');
      }

      this.state.playbackSource = 'cloud';
      if (isYoutubeTrack(track)) {
        void prepareYoutubeBridge();
        controller.signal.throwIfAborted();
        this.audio.src = youtubeStreamUrl(track, offset);
        logPerf('youtube stream src assigned', this.currentLoadStartedAt, { trackId: track.id });
      } else if (isDriveTrack(track)) {
        const response = await fetchDriveAudio(track, { signal: controller.signal });
        const blob = await response.blob();
        controller.signal.throwIfAborted();
        this.currentObjectUrl = URL.createObjectURL(blob);
        this.audio.src = this.currentObjectUrl;
      } else {
        throw new Error('This legacy cloud source is no longer supported. Import the song from Google Drive or search YouTube Music to retry.');
      }
      if (!this.wantsPlayback) return;
      await this.audio.play();
      if (controller.signal.aborted) return;
      this.notifyState();
    } catch (err: any) {
      if (controller.signal.aborted || (!this.wantsPlayback && err.name === 'AbortError')) return;
      if (isYoutubeTrack(track) && err.name === 'NotSupportedError') {
        err = new Error('YouTube audio could not be loaded or decoded. Press Play to retry.');
      }
      console.error('Error starting playback:', err);
      this.failPlayback(err.name === 'NotAllowedError'
        ? 'Audio is ready. Press Play to start.'
        : err.message || 'This audio file could not be played.');
    }
  }

  private async handlePlaybackError(): Promise<void> {
    const track = this.state.currentTrack;
    const audio = this.audio;
    const controller = this.loadController;
    if (!track || !controller || controller.signal.aborted) return;
    // Only a network failure is recoverable. Decode/unsupported failures must
    // not spin up more browser captures or hide the terminal error.
    if (audio.error?.code === 2 && navigator.onLine && this.wantsPlayback && this.retryCount === 0 && this.state.playbackSource === 'cloud' && isYoutubeTrack(track)) {
      this.retryCount++;
      this.state.isLoading = true;
      this.armLoadingTimeout();
      this.notifyState();
      if (isYoutubeTrack(track)) {
        void this.loadTrack(track, undefined, this.state.currentTime, true);
        return;
      }
    }
    this.failPlayback(isYoutubeTrack(track)
      ? 'YouTube audio playback failed. Press Play to try again.'
      : 'This audio file could not be played. Press Play to retry or choose another track.');
  }

  public async play(): Promise<void> {
    this.state.error = null;
    this.wantsPlayback = true;
    if (this.state.currentTrack) {
      if (this.pendingSeek !== null) {
        await this.loadTrack(this.state.currentTrack, undefined, this.pendingSeek, true);
        return;
      }
      if (!this.audio.src || this.audio.error || this.loadController?.signal.aborted) {
        await this.loadTrack(this.state.currentTrack, undefined, this.state.currentTime);
      } else {
        const audio = this.audio;
        const controller = this.loadController;
        if (this.isLiveCapture()) {
          fetch('/api/ytmusic/bridge/resume', { method: 'POST', headers: bridgeHeaders() }).catch(() => {});
        }
        try {
          this.state.isLoading = true;
          this.armLoadingTimeout();
          this.notifyState();
          await audio.play();
        } catch (err: any) {
          if (this.audio !== audio || controller?.signal.aborted || (!this.wantsPlayback && err.name === 'AbortError')) return;
          this.failPlayback(err.name === 'NotAllowedError' ? 'Press Play to allow audio on this device.' : err.message || 'Playback could not start.');
        }
      }
    } else if (this.queue.length > 0) {
      await this.playTrack(this.queue[0].track);
    }
  }

  public pause(): void {
    this.clearLoadingTimeout();
    const wasLoading = this.state.isLoading;
    this.wantsPlayback = false;
    this.state.isLoading = false;
    // If pausing a YouTube track, pause the hidden Chromium bridge too
    // so it doesn't keep playing (and buffering) in the background.
    if (this.isLiveCapture()) {
      fetch('/api/ytmusic/bridge/pause', { method: 'POST', headers: bridgeHeaders() }).catch(() => {});
      if (wasLoading) {
        // Abort the HTTP capture too: a late backend start must not leak audio.
        this.pendingSeek = this.state.currentTime;
        this.loadController?.abort();
        this.audio.removeAttribute('src');
        this.audio.load();
      }
    }
    this.audio.pause();
    this.state.isPlaying = false;
    this.updateMediaSessionPlaybackState('paused');
    this.notifyState();
  }

  public togglePlay(): void {
    if (this.state.isPlaying || this.state.isLoading) {
      this.pause();
    } else {
      this.play();
    }
  }

  public seek(timeInSeconds: number): void {
    if (!Number.isFinite(timeInSeconds)) return;
    if (this.isLiveCapture()) {
      const offset = Math.max(0, Math.min(timeInSeconds, this.state.duration || timeInSeconds));
      if (this.wantsPlayback) {
        void this.loadTrack(this.state.currentTrack!, undefined, offset, true);
      } else {
        // Do not create a running backend capture while the listener is paused.
        this.pendingSeek = offset;
        this.state.currentTime = offset;
        this.state.bufferedTime = offset;
        this.notifyState();
      }
      return;
    }
    const duration = this.audio.duration;
    if (Number.isFinite(duration) && duration > 0) {
      const clamped = Math.max(0, Math.min(timeInSeconds, duration));
      this.audio.currentTime = clamped;
      this.state.currentTime = clamped;
      this.notifyState();
      return;
    }

    try {
      const clamped = Math.max(0, timeInSeconds);
      this.audio.currentTime = clamped;
      this.state.currentTime = this.audio.currentTime;
      this.notifyState();
    } catch {
      this.state.error = 'Seeking is not available until more of this stream is buffered.';
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
    if (this.state.currentTime > 3) {
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
    this.clearLoadingTimeout();
    this.state.isPlaying = false;
    this.state.isLoading = false;
    this.wantsPlayback = false;
    this.updateMediaSessionPlaybackState('paused');
    this.notifyState();
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
