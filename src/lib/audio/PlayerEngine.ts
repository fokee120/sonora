import { audioCache } from '../offline/AudioCache.js';
import { Track, PlayerState, RepeatMode, QueueItem, QueueSource } from '../../types/index.js';
import { offlineManager } from '../offline/OfflineManager.js';
import { dbService } from '../db.js';
import { youtubeStreamUrl, bridgeHeaders, prepareYoutubeBridge, fetchYoutubeAudio } from './audioSource.js';
import { isYoutubeTrack } from '../ytmusic/youtubeMusic.js';
import { logPerf, perfNow } from '../perf.js';
import { cacheArtwork, highQualityArtwork, readArtwork } from '../artwork.js';
import { reportMediaControls } from './mediaControlsDiagnostics.js';
import { assertAudioDuration, validateAudioBlob } from '../offline/audioCompleteness.js';

type StateListener = (state: PlayerState) => void;
export type PreviewState = {id: string | null; status: 'idle' | 'loading' | 'playing' | 'error'; error?: string};
type QueueListener = (queue: QueueItem[]) => void;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class PlayerEngine {
  private static instance: PlayerEngine;
  private audio: HTMLAudioElement;
  private currentObjectUrl: string | null = null;
  private loadController: AbortController | null = null;
  private stateListeners: Set<StateListener> = new Set();
  private queueListeners: Set<QueueListener> = new Set();

  private queue: QueueItem[] = [];
  private currentQueueIndex = -1;
  private recommendationTails = new Map<string, { ids: string[]; tracks: Track[] }>();
  public setPlaylistRecommendations(id: string, ids: string[], tracks: Track[]) { this.recommendationTails.set(id, {ids, tracks}); void dbService.setSetting('playlist_recommendations', [...this.recommendationTails.entries()]); }
  private extendWithRecommendations() {
    if (this.state.repeatMode !== 'off') return;
    const context = this.queue.filter(item => item.contextIndex !== undefined);
    for (const tail of this.recommendationTails.values()) {
      if (tail.ids.length !== context.length || !context.every(item => tail.ids.includes(item.track.id))) continue;
      const seen = new Set(this.queue.map(item => item.track.id));
      const extra = tail.tracks.filter(track => { if (seen.has(track.id)) return false; seen.add(track.id); return true; });
      if (extra.length) {
        const start = Math.max(-1, ...context.map(item => item.contextIndex!)) + 1;
        this.queue.push(...extra.map((track, index) => ({track, queueId: crypto.randomUUID(), contextIndex: start + index})));
        this.notifyQueue();
      }
      break;
    }
  }

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


  private previewSession: {id: string; track: Track | null; position: number; playing: boolean; source: 'cloud' | 'local'; retryCount: number; duration: number} | null = null;
  private previewGeneration = 0;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewState: PreviewState = {id: null, status: 'idle'};
  private previewListeners = new Set<(state: PreviewState) => void>();
  public getPreviewState(): PreviewState { return this.previewState; }
  public subscribePreview(listener: (state: PreviewState) => void): () => void {
    this.previewListeners.add(listener); listener(this.previewState);
    return () => { this.previewListeners.delete(listener); };
  }
  private updatePreview(state: PreviewState): void {
    this.previewState = state;
    for (const listener of this.previewListeners) listener(state);
  }
  private clearPreviewTimer(): void { if (this.previewTimer) clearTimeout(this.previewTimer); this.previewTimer = null; }

  /** Audition on the same native player, without changing the saved queue or history. */
  public async previewTrack(track: Track): Promise<void> {
    this.previewGeneration++;
    this.persistPosition(true);
    const previous = this.previewSession;
    this.previewSession = {...(previous ?? {track: this.state.currentTrack, position: this.pendingSeek ?? this.state.currentTime,
      playing: this.wantsPlayback, source: this.state.playbackSource, retryCount: this.retryCount, duration: this.state.duration}), id: track.id};
    this.clearPreviewTimer(); this.retryCount = 0;
    this.state.isPreview = true;
    this.updatePreview({id: track.id, status: 'loading'});
    await this.loadTrack(track, undefined, 0, true);
  }

  public async stopPreview(resume = true): Promise<void> {
    const previous = this.previewSession;
    if (!previous) { if (this.previewState.status === 'error') this.updatePreview({id: null, status: 'idle'}); return; }
    this.previewGeneration++;
    this.previewSession = null; this.clearPreviewTimer(); this.clearLoadingTimeout();
    this.loadController?.abort(); this.sourceAssigned = false; this.wantsPlayback = false;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    if (this.currentObjectUrl) { URL.revokeObjectURL(this.currentObjectUrl); this.currentObjectUrl = null; }
    this.sourceOffset = 0; this.pendingSeek = previous.track ? previous.position : null;
    this.retryCount = previous.retryCount;
    this.state = {...this.state, currentTrack: previous.track, currentTime: previous.position,
      duration: previous.duration, bufferedTime: 0, playbackSource: previous.source,
      isPlaying: false, isLoading: false, isPreview: false, error: null};
    this.updatePreview({id: null, status: 'idle'});
    if (previous.track) this.updateMediaSessionMetadata(previous.track);
    else { this.metadataSequence++; try { if ('mediaSession' in navigator) navigator.mediaSession.metadata = null; } catch {} }
    this.persistPosition(true); this.notifyQueue(); this.notifyState();
    this.updateMediaSessionPlaybackState(previous.track ? 'paused' : 'none');
    if (resume && previous.playing && previous.track) await this.loadTrack(previous.track, undefined, previous.position, true);
  }

  private pausedAt:number|null=null;
  private lastPositionWrite=0;
  private resumeBuffer:{id:string;duration:number;url:string;source:'local'|'cloud'}|null=null;
  private resumeRead:Promise<void>|null=null;
  private configureNativeAudioSession():void{
    try{const session=(navigator as any).audioSession;if(session&&session.type!=='playback')session.type='playback';}catch{/* Optional platform API. */}
  }
  private persistPosition(force=false):void{
    if (this.previewSession) return;
    const track=this.state.currentTrack,now=Date.now();
    if(!track||!force&&now-this.lastPositionWrite<5000)return;
    this.lastPositionWrite=now;
    const value={trackId:track.id,position:this.pendingSeek??this.state.currentTime,updatedAt:now};
    try{localStorage.setItem('sonora:player-resume:v1',JSON.stringify(value));}catch{}
    void dbService.setSetting('player_position',value).catch(()=>{});
  }
  private prepareResumeBuffer():void{
    const track=this.state.currentTrack;
    if(!isIOS()||!track||this.currentObjectUrl||!this.sourceAssigned||this.state.isPlaying||this.resumeRead||this.resumeBuffer?.id===track.id)return;
    const controller=this.loadController;
    this.resumeRead=(async()=>{
      const downloaded=offlineManager.isTrackDownloaded(track.id);
      const blob=downloaded?await offlineManager.audioStorage.get(track.id):audioCache.has(track.id)?await audioCache.get(track.id):null;
      if(!blob||this.state.currentTrack?.id!==track.id||this.loadController!==controller||controller?.signal.aborted||this.state.isPlaying)return;
      if(this.resumeBuffer)URL.revokeObjectURL(this.resumeBuffer.url);
      this.resumeBuffer={id:track.id,duration:track.duration,url:URL.createObjectURL(blob),source:downloaded?'local':'cloud'};
    })().catch(()=>{}).finally(()=>{this.resumeRead=null;});
  }
  private refreshNativeSession():void{
    this.configureNativeAudioSession();
    if(!this.state.currentTrack)return;
    this.setupMediaSession();
    this.updateMediaSessionMetadata(this.state.currentTrack);
    this.updateMediaSessionPosition();
    this.syncMediaSessionPlaybackState(true);
  }
  private sourceOffset = 0;
  private sourceAssigned = false;
  private validatePreparedLocal = false;
  private nativeSeekOnMetadata = 0;
  private pendingSeek: number | null = null;
  private wantsPlayback = false;
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private currentLoadStartedAt = 0;
  private metadataSequence = 0;
  private mediaRefresh:ReturnType<typeof setTimeout>|null=null;
  private audioListeners = new AbortController();
  private previousBuffered: { id: string; duration: number; url: string; source: 'local' | 'cloud' } | null = null;
  private preparedNext: { id: string; duration: number; url: string; source: 'local' | 'cloud' } | null = null;
  private preparingNext: { id: string; duration: number; controller: AbortController; promise: Promise<void> } | null = null;

  private constructor() {
    this.configureNativeAudioSession();
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.setupAudioListeners();
    this.setupMediaSession();
    this.restorePersistedState();
    // User interaction warms only the isolated browser, never a song.
    const warmup = () => { void prepareYoutubeBridge(); };
    document.addEventListener('pointerdown', warmup, { passive: true });
    document.addEventListener('keydown', warmup);
    window.addEventListener('pagehide',()=>this.persistPosition(true));
    window.addEventListener('pageshow',()=>this.refreshNativeSession());
    window.addEventListener('sonora:cache-changed',()=>{if(!this.wantsPlayback)this.prepareResumeBuffer();});
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState==='visible')this.refreshNativeSession();else {this.persistPosition(true);this.syncMediaSessionPlaybackState(true);}
      // A background preparation can be suspended by iOS. Once the app is
      // visible again, use its normal playback path instead of waiting for it.
      if (document.visibilityState !== 'visible' || !this.state.isLoading || this.sourceAssigned || !this.wantsPlayback || !this.state.currentTrack) return;
      const track = this.state.currentTrack;
      this.preparingNext?.controller.abort();
      this.preparingNext = null;
      void this.loadTrack(track, undefined, this.state.currentTime, true);
    });
  }

  public static getInstance(): PlayerEngine {
    if (!PlayerEngine.instance) {
      PlayerEngine.instance = new PlayerEngine();
    }
    return PlayerEngine.instance;
  }

  private async restorePersistedState(): Promise<void> {
    try {
      const tails=await dbService.getSetting<any[]>('playlist_recommendations',[]);for(const [id,tail] of tails)this.recommendationTails.set(id,tail);
      const savedVolume = 1.0;
      const savedRepeat = await dbService.getSetting<RepeatMode>('player_repeat', 'off');
      const savedShuffle = await dbService.getSetting<boolean>('player_shuffle', false);
      const savedPlaylist = await dbService.getSetting<string|null>('player_playlist', null);
      const savedPlaylistProfile=await dbService.getSetting<string|null>('player_playlist_profile',null);
      const savedManualBase=await dbService.getSetting<QueueItem[]|null>('player_queue_base',null);
      const savedQueue = await dbService.getSetting<QueueItem[]>('player_queue', []);
      const savedTrack = await dbService.getSetting<Track | null>('player_track', null);
      const savedCursor = await dbService.getSetting<string | null>('player_queue_cursor', null);
      let savedPosition=await dbService.getSetting<{trackId:string;position:number;updatedAt?:number}|null>('player_position',null);
      try{const local=JSON.parse(localStorage.getItem('sonora:player-resume:v1')||'null');if(local&&Number.isFinite(local.position)&&(!savedPosition||(local.updatedAt||0)>(savedPosition.updatedAt||0)))savedPosition=local;}catch{}
      if (this.loadController) return;

      this.state.volume = savedVolume;
      this.state.repeatMode = savedRepeat;
      this.state.shuffle = savedShuffle;
      this.state.playlistId = savedPlaylist;
      this.state.playlistProfileId=savedPlaylistProfile;
      this.manualBase=savedManualBase;
      this.audio.volume = savedVolume;

      if (savedQueue && savedQueue.length > 0) {
        // Repair legacy shared-array duplicates without changing library data.
        const ids = new Set<string>(), songs = new Set<string>();
        this.queue = savedQueue.filter(item => {
          if (!item?.track?.id || !item.queueId || ids.has(item.queueId) || (!savedCursor && songs.has(item.track.id))) return false;
          ids.add(item.queueId); songs.add(item.track.id); return true;
        }).map((item, index) => ({...item, contextIndex: item.manual ? item.contextIndex : item.contextIndex ?? index}));
        if (savedTrack) {
          this.state.currentTrack = savedTrack;
          this.state.duration = savedTrack.duration || 0;
          if(savedPosition?.trackId===savedTrack.id&&Number.isFinite(savedPosition.position))this.state.currentTime=Math.max(0,Math.min(savedPosition.position,savedTrack.duration||savedPosition.position));
          this.updateMediaSessionMetadata(savedTrack);
          this.currentQueueIndex = this.queue.findIndex(q => q.queueId === savedCursor && q.track.id === savedTrack.id);
          if (this.currentQueueIndex < 0) this.currentQueueIndex = this.queue.findIndex(q => q.track.id === savedTrack.id);
        }
        this.notifyQueue();
      }
      this.notifyState();
    } catch (err) {
      console.warn('Failed to restore player state:', err);
    }
  }

  private setupAudioListeners(): void {
    this.audioListeners.abort();
    this.audioListeners = new AbortController();
    const audio = this.audio;
    const controller = this.loadController;
    const listen = (event: string, callback: (event: Event) => void) => {
      audio.addEventListener(event, (event) => {
        if (this.audio !== audio || this.loadController !== controller || controller?.signal.aborted) return;
        // The reused iOS element still describes the old song while a source
        // is being prepared. Its queued events must not advance the new clock.
        if (!this.sourceAssigned && event.type !== 'pause') return;
        callback(event);
      }, { signal: this.audioListeners.signal });
    };
    listen('play', () => {
      if (!this.wantsPlayback) { audio.pause(); return; }
      // A play request is not evidence that decoded audio is flowing.
      this.state.isLoading = true;
      this.armLoadingTimeout();
      this.notifyState();
    });

    listen('pause', () => {
      // An iOS source change can deliver the old source's pause event after
      // the reused audio element has already started the replacement.
      if (!audio.paused || (this.wantsPlayback && this.state.isLoading)) return;
      if (this.previewSession) { void this.stopPreview(false); return; }
      this.state.isPlaying = false;
      this.wantsPlayback=false;
      this.pausedAt=Date.now();
      this.persistPosition(true);
      this.prepareResumeBuffer();
      this.updateMediaSessionPlaybackState('paused');
      this.updateMediaSessionPosition();
      this.notifyState();
    });

    listen('waiting', () => {
      if (!this.wantsPlayback) return;
      this.clearPreviewTimer();
      this.state.isLoading = true;
      this.armLoadingTimeout();
      this.notifyState();
    });

    listen('playing', () => {
      if (!this.wantsPlayback) { audio.pause(); return; }
      this.clearLoadingTimeout();
      this.state.isPlaying = true;
      this.pausedAt=null;
      // Restore commands first, then publish the audible state to Now Playing.
      this.setupMediaSession();
      // WebKit also activates the native session asynchronously after playing.
      for (const delay of [250, 1000]) setTimeout(() => {
        if (this.audio !== audio || this.loadController !== controller || controller?.signal.aborted
          || !this.wantsPlayback || !this.sourceAssigned || audio.paused || !this.state.isPlaying) return;
        if (delay === 250) this.setupMediaSession();
        this.updateMediaSessionPosition();
        this.syncMediaSessionPlaybackState(true);
      }, delay);
      this.state.isLoading = false;
      if (this.previewSession) {
        const preview = this.previewSession;
        this.updatePreview({id: preview.id, status: 'playing'});
        this.clearPreviewTimer();
        this.previewTimer = setTimeout(() => { if (this.previewSession === preview) void this.stopPreview(); }, Math.max(0, 30-this.state.currentTime)*1000);
      }
      this.prepareNextStream();
      reportMediaControls('playing', { source: this.state.playbackSource, visibility: document.visibilityState });
      if (this.currentLoadStartedAt) {
        logPerf('player playing', this.currentLoadStartedAt, { source: this.state.playbackSource });
        this.currentLoadStartedAt = 0;
      }
      this.notifyState();
    });

    listen('timeupdate', () => {
      this.state.currentTime = this.sourceOffset + this.audio.currentTime;
      if (this.previewSession && this.state.currentTime >= 30) { void this.stopPreview(); return; }
      this.persistPosition();
      if (!this.previewSession && !this.isLiveCapture() && !this.hasLocalCatalogDuration() && Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.state.duration = this.audio.duration;
      }
      this.updateMediaSessionPosition();
      this.syncMediaSessionPlaybackState();
      this.notifyState();
    });

    listen('progress', () => {
      if (this.audio.buffered.length > 0) {
        this.state.bufferedTime = this.sourceOffset + this.audio.buffered.end(this.audio.buffered.length - 1);
        this.notifyState();
      }
    });

    listen('loadedmetadata', () => {
      // Validate a prepared download on the active player. Creating a second
      // audio element for metadata can disrupt iOS's background media session.
      if (this.validatePreparedLocal) {
        this.validatePreparedLocal = false;
        try { if (Number.isFinite(audio.duration)) assertAudioDuration(audio.duration, this.state.currentTrack?.duration || 0); }
        catch (error) {
          this.failPlayback(error instanceof Error ? error.message : 'Downloaded audio could not be verified.');
          return;
        }
      }
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
    return !this.currentObjectUrl && this.state.playbackSource === 'cloud' && !!this.state.currentTrack && isYoutubeTrack(this.state.currentTrack);
  }

  private clearLoadingTimeout(): void {
    if (this.loadingTimer) clearTimeout(this.loadingTimer);
    this.loadingTimer = null;
  }

  private armLoadingTimeout(): void {
    if (this.loadingTimer) return;
    const audio = this.audio;
    const controller = this.loadController;
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = null;
      if (this.audio !== audio || this.loadController !== controller || !this.wantsPlayback) return;
      this.failPlayback('Audio loading timed out. Check your connection and press Play to retry.');
    }, 30_000);
  }

  private failPlayback(message: string): void {
    if (this.previewSession) {
      const id = this.previewSession.id;
      const restoring = this.stopPreview();
      const generation = this.previewGeneration;
      void restoring.then(() => { if (this.previewGeneration === generation) this.updatePreview({id, status: 'error', error: message}); });
      return;
    }
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
    return !!this.currentObjectUrl && !!track && isYoutubeTrack(track) && Number.isFinite(track.duration) && track.duration > 0;
  }

  private recordDuration(): void {
    if (this.previewSession) return;
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
    if (!('mediaSession' in navigator)) { reportMediaControls('unavailable'); return; }

    const ms = navigator.mediaSession;
    const registered: Record<string, string> = {};

    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler ? details => {
          reportMediaControls('command', { action });
          handler(details);
        } : null);
        registered[action] = handler ? 'enabled' : 'disabled';
      } catch (error) { registered[action] = error instanceof Error ? error.name : 'failed'; }
    };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('seekto', (details) => {
      if (this.state.isLoading) return;
      if (details.seekTime !== undefined && details.seekTime !== null) {
        this.seek(details.seekTime);
      }
    });
    // Advertise actual music track controls, never the short-seek buttons.
    set('seekbackward', null);
    set('seekforward', null);
    // A pending remote transition already owns the native audio session.
    // Repeated taps must not accumulate unseen queue changes behind its artwork.
    set('previoustrack', () => { if (!this.state.isLoading) this.previous(true); });
    set('nexttrack', () => { if (!this.state.isLoading) this.next(); });
    reportMediaControls('registered', registered);
    this.syncMediaSessionPlaybackState(true);
  }

  private updateMediaSessionMetadata(track: Track): void {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const sequence = ++this.metadataSequence;
    const publish = (artwork: MediaImage[]) => {
      if (sequence !== this.metadataSequence || this.state.currentTrack?.id !== track.id) return;
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album, artwork }); } catch {}
      // A decoded cover can arrive after playback or after a user pause.
      this.updateMediaSessionPosition();
      this.syncMediaSessionPlaybackState(true);
    };
    // One real high-resolution source, not the same tiny thumbnail relabelled
    // as 96/128/192/512px. Some WebKit versions select only the first entry.
    let initialArtwork = new URL('/pwa-512x512.png', location.href).href;
    try { if (track.artworkUrl) initialArtwork = new URL(highQualityArtwork(track.artworkUrl), location.href).href; } catch {}
    publish([{ src: initialArtwork, sizes: 'any' }]);
    void (async () => {
      const blob = navigator.onLine ? await cacheArtwork(track) : await readArtwork(track.id);
      if (!blob || sequence !== this.metadataSequence) return;
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      if (sequence !== this.metadataSequence) return;
      const image = new Image(); image.src = source; await image.decode();
      publish([{ src: source, sizes: `${image.naturalWidth}x${image.naturalHeight}`, type: blob.type }]);
    })().catch(() => {
      // Optional artwork must never interrupt audio or replace the next song's metadata.
    });
  }

  private syncMediaSessionPlaybackState(reactivate = false): void {
    if (!this.state.currentTrack) return;
    const playing = this.sourceAssigned && this.wantsPlayback && !this.audio.paused && !this.audio.ended;
    this.updateMediaSessionPlaybackState(playing ? 'playing' : 'paused', reactivate);
  }

  private updateMediaSessionPlaybackState(state: 'playing' | 'paused' | 'none', reactivate = false): void {
    if (!('mediaSession' in navigator)) return;
    try {
      const session = navigator.mediaSession;
      if(this.mediaRefresh){clearTimeout(this.mediaRefresh);this.mediaRefresh=null;}
      // Keep the native session owned during refresh. Yield a task so WebKit
      // does not coalesce the refresh into an ignored same-value assignment.
      if(reactivate&&isIOS()&&state==='playing'&&session.playbackState==='playing'){
        const audio=this.audio,controller=this.loadController,trackId=this.state.currentTrack?.id;
        session.playbackState='paused';
        this.mediaRefresh=setTimeout(()=>{this.mediaRefresh=null;if(this.audio!==audio||this.loadController!==controller||controller?.signal.aborted||this.state.currentTrack?.id!==trackId||!this.sourceAssigned||!this.wantsPlayback||audio.paused||audio.ended)return;try{session.playbackState='playing';this.updateMediaSessionPosition();}catch{}},0);
        return;
      }
      session.playbackState = state;
    } catch {
      // Optional lock-screen integration must never interrupt playback.
    }
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
    listener([...this.queue]);
    return () => this.queueListeners.delete(listener);
  }

  private notifyState(): void {
    for (const listener of this.stateListeners) {
      listener({ ...this.state });
    }
  }

  private queuePersistence: Promise<void> = Promise.resolve();
  private persistQueue(): void {
    const writes = [dbService.setSetting('player_queue_base', this.manualBase), dbService.setSetting('player_playlist', this.state.playlistId ?? null),dbService.setSetting('player_playlist_profile',this.state.playlistProfileId??null), dbService.setSetting('player_queue', this.queue),
      dbService.setSetting('player_queue_cursor', this.queue[this.currentQueueIndex]?.queueId ?? null)];
    const savedTrack = this.previewSession ? this.previewSession.track : this.state.currentTrack;
    if (savedTrack) writes.push(dbService.setSetting('player_track', savedTrack));
    this.queuePersistence = Promise.all(writes).then(() => {}).catch(error => {
      console.warn('Could not save playback queue:', error);
    });
  }

  private notifyQueue(): void {
    this.persistQueue();
    this.prepareNextStream();
    for (const listener of this.queueListeners) {
      listener([...this.queue]);
    }
  }

  /** Buffer one upcoming stream while audio keeps the iOS PWA active.
   * A complete validated MP3 avoids opening a fresh live recorder/decoder at EOF.
   * Memory only: never marked downloaded or saved to the user's offline library. */
  private prepareNextStream(requestedTrack?: Track): void {
    if (this.previewSession) return;
    if (!isIOS() || (!requestedTrack && !this.state.isPlaying)) return;
    const index = this.currentQueueIndex + 1;
    const next = requestedTrack || this.queue[index]?.track
      || (this.state.repeatMode === 'all' ? this.queue.find(item => !item.manual)?.track : undefined);
    const matches = (entry: { id: string; duration: number }) => next && entry.id === next.id && entry.duration === next.duration;
    if (this.preparedNext && !matches(this.preparedNext)) {
      URL.revokeObjectURL(this.preparedNext.url); this.preparedNext = null;
    }
    if (this.preparingNext && !matches(this.preparingNext)) {
      this.preparingNext.controller.abort(); this.preparingNext = null;
    }
    if (!next || (this.previousBuffered && matches(this.previousBuffered)) || this.preparedNext || this.preparingNext) return;
    const isDownloaded = offlineManager.isTrackDownloaded(next.id);
    if (!isDownloaded && !audioCache.has(next.id) && (!navigator.onLine || !isYoutubeTrack(next))) return;
    const job = { id: next.id, duration: next.duration, controller: new AbortController(), promise: Promise.resolve() };
    this.preparingNext = job;
    const timeout = setTimeout(() => job.controller.abort(), 30_000);
    job.promise = (async () => {
      const blob = isDownloaded ? await offlineManager.audioStorage.get(next.id) : await audioCache.ensure(next, job.controller.signal);
      job.controller.signal.throwIfAborted();
      if (!blob) throw new Error('Downloaded audio is missing');
      // Check the duration on the real player when this source starts. A
      // second audio element here can steal the iOS lock-screen session.
      job.controller.signal.throwIfAborted();
      this.preparedNext = { id: next.id, duration: next.duration, url: URL.createObjectURL(blob), source: isDownloaded ? 'local' : 'cloud' };
      reportMediaControls('prepared', { source: isDownloaded ? 'local' : 'cloud' });
    })().catch(error => {
      if (!job.controller.signal.aborted) reportMediaControls('prepare-failed', { error: error instanceof Error ? error.name : 'Error' });
      // Preflight failures retain normal playback/download error handling.
    }).finally(() => { clearTimeout(timeout); if (this.preparingNext === job) this.preparingNext = null; });
  }

  /**
   * Load and play a specific track
   */
  public async playTrack(track: Track, newQueue?: Track[]): Promise<void> {
    this.state.playlistId = null;
    if (this.previewSession) void this.stopPreview(false);
    await this.loadTrack(track, newQueue);
    await this.queuePersistence;
  }

  private async loadTrack(track: Track, newQueue?: Track[], offset = 0, recovery = false): Promise<void> {
    this.configureNativeAudioSession();
    const resumeSource=this.resumeBuffer?.id===track.id&&this.resumeBuffer.duration===track.duration?this.resumeBuffer:null;
    if(resumeSource)this.resumeBuffer=null;
    else if(this.resumeBuffer){URL.revokeObjectURL(this.resumeBuffer.url);this.resumeBuffer=null;}
    const retainedSource = resumeSource || (this.previousBuffered?.id === track.id && this.previousBuffered.duration === track.duration
      ? this.previousBuffered : null);
    if (retainedSource===this.previousBuffered) this.previousBuffered = null;
    this.pausedAt=null;
    const previousTrack = this.state.currentTrack;
    const previousSource = this.state.playbackSource;
    this.clearLoadingTimeout();
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    this.sourceAssigned = false;
    this.validatePreparedLocal = false;
    // iOS grants background playback to the audio element the user started.
    // Replacing that element per song loses its playback permission/session.
    // Desktop browsers retain isolated elements for protection from stale events.
    const previousAudio = this.audio;
    this.audioListeners.abort();
    if (!isIOS()) {
      previousAudio.pause();
      this.audio = new Audio();
      previousAudio.removeAttribute('src');
      previousAudio.load();
    } else if (this.audio instanceof HTMLAudioElement && !this.audio.isConnected) {
      this.audio.hidden = true;
      this.audio.dataset.sonoraPlayer = 'true';
      this.audio.setAttribute('playsinline', '');
      document.body.append(this.audio);
    }
    this.audio.preload = 'auto';
    this.audio.volume = this.state.isMuted ? 0 : this.state.volume;
    this.setupAudioListeners();
    this.state.isPlaying = false;
    if (!this.previewSession) {
      if (newQueue && newQueue.length > 0) {
        this.setQueue(newQueue, track);
      } else if (this.queue.length === 0) {
        this.setQueue([track], track);
      } else if (this.queue[this.currentQueueIndex]?.track.id !== track.id) {
        const index = this.queue.findIndex(item => item.track.id === track.id);
        if (index >= 0) this.currentQueueIndex = index;
        else {
          // Playing a standalone discovery result must not leave the cursor on an unrelated song.
          this.queue.splice(this.currentQueueIndex + 1, 0, {track, queueId: crypto.randomUUID()});
          this.currentQueueIndex++;
        }
      }
    }
    this.state.currentTrack = track;
    if (!this.previewSession) { this.notifyQueue(); void audioCache.played(track); }

    this.state.isLoading = true;
    this.sourceOffset = isYoutubeTrack(track) ? offset : 0;
    this.nativeSeekOnMetadata = isYoutubeTrack(track) ? 0 : offset;
    this.pendingSeek = null;
    this.wantsPlayback = true;
    this.state.currentTime = offset;
    this.persistPosition(true);
    this.state.duration = this.previewSession ? Math.min(track.duration || 30, 30) : track.duration || 0;
    this.state.bufferedTime = 0;
    this.state.error = null;
    if (!recovery) this.retryCount = 0;
    this.currentLoadStartedAt = perfNow();
    this.armLoadingTimeout();
    this.notifyState();

    // Persist current track
    if (!recovery && !this.previewSession) {
      void dbService.addHistory(track.id, track).catch(() => {});
    }

    // Keep the native title attached to the audible source during buffering.
    if (!isIOS()) this.updateMediaSessionMetadata(track);

    // Clean previous object URL if any
    if (this.currentObjectUrl) {
      if (isIOS() && previousTrack) {
        if (this.previousBuffered && this.previousBuffered.url !== this.currentObjectUrl) URL.revokeObjectURL(this.previousBuffered.url);
        this.previousBuffered = { id: previousTrack.id, duration: previousTrack.duration, url: this.currentObjectUrl, source: previousSource };
      } else URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    try {
      // A lock-screen skip may arrive before prebuffering finishes. Join that
      // preparation instead of opening a competing live stream that stays silent
      // in the background. Rapid skips are guarded by the current load controller.
      if (isIOS() && (!recovery || offset === 0)
        && !retainedSource
        && (document.visibilityState === 'hidden' || this.preparingNext?.id === track.id)) {
        this.prepareNextStream(track);
        const pending = this.preparingNext;
        if (pending?.id === track.id) {
          // Do not drop an audible iOS session merely to await a new source.
          // The current song continues briefly until its replacement is ready.
          if (this.audio.paused) this.updateMediaSessionPlaybackState('paused');
          reportMediaControls('handoff', { source: offlineManager.isTrackDownloaded(track.id) ? 'local' : 'cloud', prepared: 'waiting', visibility: document.visibilityState });
          await pending.promise;
          controller.signal.throwIfAborted();
          if (!this.wantsPlayback) return;
        }
        if (document.visibilityState === 'hidden' && this.preparedNext?.id !== track.id && !offlineManager.isTrackDownloaded(track.id)) {
          throw new Error('This song could not be buffered for background playback. Open Sonora to retry.');
        }
      }
      // Start the prepared stream synchronously in the native ended/skip event.
      const prepared = retainedSource || this.preparedNext;
      if (prepared?.id === track.id && prepared.duration === track.duration) {
        if (prepared === this.previousBuffered) this.previousBuffered = null;
        if (prepared === this.preparedNext) this.preparedNext = null;
        this.currentObjectUrl = prepared.url;
        this.state.playbackSource = prepared.source;
        this.sourceOffset = 0;
        this.nativeSeekOnMetadata = offset;
        this.sourceAssigned = true;
        this.validatePreparedLocal = prepared.source === 'local';
        this.audio.src = prepared.url;
        if (isIOS()) this.updateMediaSessionMetadata(track);
        this.updateMediaSessionPosition();
        reportMediaControls('handoff', { source: prepared.source, prepared: 'yes', visibility: document.visibilityState });
        const playing = this.audio.play();
        await playing;
        if (controller.signal.aborted) return;
        if (this.wantsPlayback && !this.audio.paused) {
          this.state.isPlaying = true;
          this.setupMediaSession();
        }
        this.notifyState();
        return;
      }
      reportMediaControls('handoff', { source: offlineManager.isTrackDownloaded(track.id) ? 'local' : 'cloud', prepared: 'no', visibility: document.visibilityState });
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
          this.sourceAssigned = true;
          this.audio.src = objectUrl;
          if (isIOS()) this.updateMediaSessionMetadata(track);
          if (!this.wantsPlayback) return;
          await this.audio.play();
          if (controller.signal.aborted) return;
          this.notifyState();
          return;
        }
      }

      const cached = audioCache.has(track.id) ? await audioCache.get(track.id) : null;
      controller.signal.throwIfAborted();
      if (cached) {
        this.currentObjectUrl = URL.createObjectURL(cached);
        this.state.playbackSource = 'cloud'; this.sourceOffset = 0; this.nativeSeekOnMetadata = offset;
        this.sourceAssigned = true; this.audio.src = this.currentObjectUrl;
        if (isIOS()) this.updateMediaSessionMetadata(track);
        if (!this.wantsPlayback) return;
        await this.audio.play(); return;
      }

      // If offline and track not downloaded, reject
      if (!navigator.onLine) {
        throw new Error('This track is not downloaded for offline playback.');
      }

      this.state.playbackSource = 'cloud';
      if (isYoutubeTrack(track)) {
        void prepareYoutubeBridge();
        controller.signal.throwIfAborted();
        this.sourceAssigned = true;
        this.audio.src = youtubeStreamUrl(track, offset);
        if (isIOS()) this.updateMediaSessionMetadata(track);
        logPerf('youtube stream src assigned', this.currentLoadStartedAt, { trackId: track.id });
      } else {
        throw new Error('Search for this song again to stream it.');
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
      reportMediaControls('play-error', { error: err.name || 'Error' });
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
    this.configureNativeAudioSession();
    this.setupMediaSession();
    this.state.error = null;
    this.wantsPlayback = true;
    // A second lock-screen Play while buffering must not resume the old source.
    if (this.state.isLoading && !this.sourceAssigned && !this.loadController?.signal.aborted) return;
    if (this.state.currentTrack) {
      // A paused live capture may have expired while iOS suspended the page.
      // Prefer a complete cached source; otherwise reconnect at the saved time.
      if(isIOS()&&this.isLiveCapture()&&this.pausedAt!==null&&Date.now()-this.pausedAt>=30_000){
        const position=this.pendingSeek??this.state.currentTime;
        await this.loadTrack(this.state.currentTrack,undefined,position,true);return;
      }
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
    if (this.previewSession) { void this.stopPreview(false); return; }
    this.clearLoadingTimeout();
    const wasLoading = this.state.isLoading;
    this.pausedAt=Date.now();
    if(this.sourceAssigned&&this.pendingSeek===null&&Number.isFinite(this.audio.currentTime))this.state.currentTime=this.sourceOffset+this.audio.currentTime;
    this.persistPosition(true);
    this.wantsPlayback = false;
    this.state.isLoading = false;
    // No new source has been installed yet: invalidate the waiting load even
    // when the previous source was a buffered blob rather than a live capture.
    // Play then loads the selected song, instead of resuming the old source.
    if (!this.sourceAssigned) this.loadController?.abort();
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
    this.setupMediaSession();
    this.updateMediaSessionPosition();
    this.prepareResumeBuffer();
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
    this.prepareNextStream();
    dbService.setSetting('player_repeat', mode);
    this.notifyState();
  }

  public cycleRepeatMode(): void {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const next = modes[(modes.indexOf(this.state.repeatMode) + 1) % modes.length];
    this.setRepeatMode(next);
  }

  private savePlaylistMode(id:string, shuffle:boolean, started=false):void {
    void dbService.mutatePlaylist(id, playlist=>({...playlist,playback:{...playlist.playback,shuffle},...(started?{lastPlayedAt:Date.now()}: {})})).then(()=>window.dispatchEvent(new Event('sonora:playlist-playback-changed'))).catch(error=>console.warn('Could not save playlist playback mode',error));
  }

  /** Select queue context and mode once, then use the existing native playback path. */
  public async playPlaylist(playlistId:string, tracks:Track[], shuffle:boolean, startTrack?:Track,profileId?:string):Promise<void> {
    if(!tracks.length)return;
    if(this.previewSession)void this.stopPreview(false);
    const active=startTrack || tracks[shuffle?Math.floor(Math.random()*tracks.length):0];
    this.state.shuffle=shuffle;
    void dbService.setSetting('player_shuffle',shuffle);
    this.setQueue(tracks,active,playlistId);
    this.state.playlistProfileId=profileId??null;
    void dbService.setSetting('player_playlist_profile',profileId??null);
    if(!profileId)this.savePlaylistMode(playlistId,shuffle,true);
    this.notifyState();
    await this.loadTrack(active);
    await this.queuePersistence;
  }

  public toggleShuffle(): void {
    this.state.shuffle = !this.state.shuffle;
    void dbService.setSetting('player_shuffle', this.state.shuffle);
    if(this.state.playlistId)this.savePlaylistMode(this.state.playlistId,this.state.shuffle);
    const history = this.queue.slice(0, this.currentQueueIndex + 1);
    const upcoming = this.queue.slice(this.currentQueueIndex + 1);
    const manual = upcoming.filter(item => item.manual);
    const context = upcoming.filter(item => !item.manual);
    if (this.state.shuffle) this.shuffleItems(context);
    else context.sort((a,b) => (a.contextIndex ?? 0) - (b.contextIndex ?? 0));
    this.queue = [...history, ...manual, ...context];
    this.notifyQueue(); this.notifyState();
  }

  private shuffleItems(items: QueueItem[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  public next(): void {
    if (this.previewSession) void this.stopPreview(false);
    if (!this.queue.length) return;
    if (this.currentQueueIndex + 1 >= this.queue.length) this.extendWithRecommendations();
    let index = this.currentQueueIndex + 1;
    if (index >= this.queue.length) {
      if (this.state.repeatMode !== 'all') return;
      // A manual request is consumed once; repeat applies to the listening context.
      this.queue = this.queue.filter(item => !item.manual || item.contextIndex !== undefined).map(item => ({...item, manual: false}));
      if (!this.state.shuffle) this.queue.sort((a,b) => (a.contextIndex ?? 0) - (b.contextIndex ?? 0));
      index = 0;
    }
    const item = this.queue[index];
    if (item) void this.playQueueItem(item.queueId);
  }

  public previous(skipCurrent = false): void {
    if (this.previewSession) void this.stopPreview(false);
    if (!skipCurrent && this.state.currentTime > 3) { this.seek(0); return; }
    if (!this.queue.length) return;
    const index = this.currentQueueIndex > 0 ? this.currentQueueIndex - 1
      : this.state.repeatMode === 'all' ? this.queue.length - 1 : 0;
    void this.playQueueItem(this.queue[index].queueId);
  }

  public async playQueueItem(queueId: string): Promise<void> {
    if (this.previewSession) void this.stopPreview(false);
    const index = this.queue.findIndex(item => item.queueId === queueId);
    if (index < 0) return;
    this.currentQueueIndex = index;
    if(!this.queue.slice(index+1).some(item=>item.manual))this.manualBase=null;
    const origin=this.queue[index];
    if(origin.originPlaylistId){if(this.state.playlistId!==origin.originPlaylistId)this.state.playlistProfileId=null;this.state.playlistId=origin.originPlaylistId;this.state.shuffle=origin.originShuffle??false;void dbService.setSetting('player_shuffle',this.state.shuffle);}
    await this.loadTrack(this.queue[index].track);
    await this.queuePersistence;
  }

  private handleTrackEnded(): void {
    if (this.previewSession) { void this.stopPreview(); return; }
    reportMediaControls('ended', { queued: this.currentQueueIndex + 1 < this.queue.length ? 'yes' : 'no' });
    if (this.state.repeatMode === 'one' && !this.queue[this.currentQueueIndex]?.manual && !this.queue[this.currentQueueIndex + 1]?.manual) {
      this.seek(0);
      this.play();
      return;
    }
    if (this.currentQueueIndex + 1 >= this.queue.length) this.extendWithRecommendations();
    if (this.currentQueueIndex + 1 < this.queue.length || (this.state.repeatMode === 'all' && this.queue.length > 0)) {
      // Keep the native session active across the handoff instead of announcing
      // a pause before trying to start the next song in the background.
      this.next();
      return;
    }
    this.clearLoadingTimeout();
    this.state.isPlaying = false;
    this.state.isLoading = false;
    this.wantsPlayback = false;
    this.updateMediaSessionPlaybackState('paused');
    this.notifyState();
  }

  // The queue is a timeline: played items, current item, manual requests, context.
  public setQueue(tracks: Track[], activeTrack?: Track, playlistId:string|null = null): void {
    this.state.playlistId = playlistId;
    this.state.playlistProfileId=null;
    this.manualBase = null;
    const manual = this.queue.slice(this.currentQueueIndex + 1).filter(item => item.manual);
    const seen = new Set<string>();
    this.queue = tracks.filter(track => { if (seen.has(track.id)) return false; seen.add(track.id); return true; })
      .map((track, contextIndex) => ({track, contextIndex, queueId: crypto.randomUUID()}));
    const activeId = activeTrack?.id ?? this.state.currentTrack?.id ?? tracks[0]?.id;
    this.currentQueueIndex = this.queue.findIndex(item => item.track.id === activeId);
    if (this.currentQueueIndex < 0 && this.queue.length) this.currentQueueIndex = 0;
    if (this.state.shuffle && this.currentQueueIndex >= 0) {
      const current = this.queue.splice(this.currentQueueIndex, 1)[0];
      this.shuffleItems(this.queue); this.queue.unshift(current); this.currentQueueIndex = 0;
    }
    const prefix = this.queue.slice(0, this.currentQueueIndex + 1);
    const future = this.queue.slice(this.currentQueueIndex + 1);
    const picks = manual.map(item => ({...item, contextIndex: future.find(next => next.track.id === item.track.id)?.contextIndex}));
    const requested = new Set(picks.map(item => item.track.id));
    this.queue = [...prefix, ...this.retargetManuals([...picks, ...future.filter(item => !requested.has(item.track.id))])];
    this.notifyQueue();
  }

  private manualBase:QueueItem[]|null=null;
  private retargetManuals(upcoming:QueueItem[]):QueueItem[]{
    const manual=upcoming.filter(item=>item.manual),last=manual.at(-1),ids=new Set(manual.map(item=>item.track.id));
    if(!last?.queueSource){if(!this.manualBase)return upcoming;const base=this.manualBase;this.manualBase=null;return [...manual,...base.filter(item=>!ids.has(item.track.id))];}
    this.manualBase??=upcoming.filter(item=>!item.manual);
    const source=last.queueSource,index=source.tracks.findIndex(t=>t.id===last.track.id);
    const tracks=source.shuffle?source.tracks.filter(t=>t.id!==last.track.id):source.tracks.slice(index+1);
    const tail=tracks.filter(t=>!ids.has(t.id)).map((track,contextIndex)=>({track,contextIndex,queueId:crypto.randomUUID(),originPlaylistId:source.playlistId,originShuffle:source.shuffle}));
    if(source.shuffle)this.shuffleItems(tail);return [...manual,...tail];
  }
  private enqueueManual(track: Track, first: boolean, source?:QueueSource): boolean {
    const upcoming = this.queue.slice(this.currentQueueIndex + 1);
    const existing = upcoming.find(item => item.track.id === track.id && item.manual);
    if (existing && !first) return false;
    const item: QueueItem = {...(existing ?? upcoming.find(item => item.track.id === track.id)), track,
      queueId: existing?.queueId ?? crypto.randomUUID(), manual: true, ...(source?{queueSource:source,originPlaylistId:source.playlistId,originShuffle:source.shuffle}:{})};
    const rest = upcoming.filter(entry => entry.track.id !== track.id);
    const insertAt = first ? 0 : rest.filter(entry => entry.manual).length;
    rest.splice(insertAt, 0, item);
    this.queue = [...this.queue.slice(0, this.currentQueueIndex + 1), ...this.retargetManuals(rest)];
    this.notifyQueue();
    return true;
  }

  public playNext(track: Track, source?:QueueSource): void { this.enqueueManual(track, true,source); }
  public addToQueue(track: Track, source?:QueueSource): boolean { return this.enqueueManual(track, false,source); }

  public removeFromQueue(queueId: string): void {
    const index = this.queue.findIndex(item => item.queueId === queueId);
    if (index < 0 || index === this.currentQueueIndex) return;
    const removed=this.queue[index];
    this.queue = this.queue.filter(item => item.queueId !== queueId);
    if(removed.manual&&index>this.currentQueueIndex)this.queue=[...this.queue.slice(0,this.currentQueueIndex+1),...this.retargetManuals(this.queue.slice(this.currentQueueIndex+1))];
    if (index < this.currentQueueIndex) this.currentQueueIndex--;
    this.notifyQueue();
  }

  public clearQueue(): void {
    this.manualBase=null;
    const current = this.queue[this.currentQueueIndex];
    this.queue = current ? [{...current, manual: false}] : [];
    this.currentQueueIndex = current ? 0 : -1;
    this.notifyQueue();
  }

  public getQueueIndex(): number { return this.currentQueueIndex; }

  public getQueue(): QueueItem[] {
    return [...this.queue];
  }

  public getState(): PlayerState {
    return { ...this.state };
  }
}

export const playerEngine = PlayerEngine.getInstance();
