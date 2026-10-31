export type TrackSource = 'gdrive' | 'ytmusic';

export interface Track {
  artistId?: string;
  albumId?: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  duration: number; // in seconds
  metadataKey?: string;
  year?: number;
  genre?: string;
  artworkUrl?: string;
  cloudKey: string;
  lyrics?: string;
  sizeBytes?: number;
  format?: string;
  /** Which backend this track streams/downloads from. */
  source?: TrackSource;
  /** YouTube video ID when source === 'ytmusic'. */
  sourceId?: string;
}

export interface Album {
  artistId?: string;
  id: string;
  title: string;
  artist: string;
  year?: number;
  genre?: string;
  artworkUrl?: string;
  trackCount: number;
  duration: number;
  tracks?: Track[];
}

export interface Artist {
  id: string;
  name: string;
  artworkUrl?: string;
  trackCount: number;
  albumCount: number;
}

export interface EstimatedMatch {
  title: string;
  artist: string;
  artworkUrl?: string;
  trackId: string;
  added: boolean;
}

export type PlaylistSort = 'custom'|'date-new'|'date-old'|'artist'|'album'|'title';
export interface Playlist {
  customOrder?:string[];
  savedFrom?:{profileId:string;playlistId:string};
  playback?: {shuffle?:boolean;sort?:PlaylistSort};
  keepDownloaded?: boolean;
  estimatedMatches?: EstimatedMatch[];
  pinnedAt?: number;
  lastPlayedAt?: number;
  source?: { type: 'ytmusic' | 'youtube' | 'spotify' | 'file'; id: string; syncedAt?: number };
  id: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type DownloadStatus = 'idle' | 'queued' | 'downloading' | 'completed' | 'failed';

export interface DownloadState {
  trackId: string;
  status: DownloadStatus;
  progress: number; // 0 - 100
  phase?: 'preparing' | 'recording' | 'fetching' | 'finalizing' | 'waiting_transfer' | 'transferring' | 'validating';
  sourceBytesDownloaded?: number;
  sourceTotalBytes?: number;
  recordedSeconds?: number;
  sourceDuration?: number;
  bytesDownloaded: number;
  totalBytes: number;
  error?: string;
  downloadedAt?: number;
}

export interface AudioBlobRecord {
  trackId: string;
  blob: Blob;
  mimeType: string;
  size: number;
  cachedAt: number;
}

export interface ArtworkRecord {
  id: string; // url or trackId
  blob?: Blob;
  bytes?: ArrayBuffer;
  sourceUrl?: string;
  mimeType: string;
  cachedAt: number;
}

export interface QueueSource {playlistId:string;tracks:Track[];shuffle:boolean;}
export interface QueueItem {
  queueSource?:QueueSource;
  originPlaylistId?:string;
  originShuffle?:boolean;
  track: Track;
  queueId: string;
  manual?: boolean;
  contextIndex?: number;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  playlistProfileId?:string|null;
  playlistId?: string | null;
  currentTrack: Track | null;
  isPlaying: boolean;
  playbackSource: 'cloud' | 'local';
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  currentTime: number;
  duration: number;
  bufferedTime: number;
  isLoading: boolean;
  isPreview?: boolean;
  error?: string | null;
}

export interface StorageQuotaInfo {
  usage: number; // bytes
  quota: number; // bytes
  usageMB: number;
  quotaMB: number;
  percentUsed: number;
  persisted: boolean;
  trackCount: number;
  downloadSizeMB: number;
}

export type ViewRoute =
  | { type: 'home' }
  | { type: 'search'; query?: string }
  | { type: 'recap' }
  | { type: 'library' }
  | { type: 'artists' }
  | { type: 'artist'; id: string; name?: string }
  | { type: 'albums' }
  | { type: 'album'; id: string; artistId?: string; title?: string; artist?: string }
  | { type: 'playlists' }
  | { type: 'playlist'; id: string; profileId?: string }
  | { type: 'liked' }
  | { type: 'downloads' }
  | { type: 'profile'; id?: string }
  | { type: 'profile-listening'; id: string; section: 'recap'|'history' }
  | { type: 'settings' };
