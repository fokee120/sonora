export interface Track {
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
}

export interface Album {
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

export interface Playlist {
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
  blob: Blob;
  mimeType: string;
  cachedAt: number;
}

export interface QueueItem {
  track: Track;
  queueId: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
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

export interface AuthSession {
  user: {
    email: string;
    name?: string;
  } | null;
  isAuthenticated: boolean;
  authRequired: boolean;
  authorizedEmails: string[];
}

export type ViewRoute =
  | { type: 'home' }
  | { type: 'search'; query?: string }
  | { type: 'library' }
  | { type: 'artists' }
  | { type: 'artist'; id: string }
  | { type: 'albums' }
  | { type: 'album'; id: string }
  | { type: 'playlists' }
  | { type: 'playlist'; id: string }
  | { type: 'liked' }
  | { type: 'downloads' }
  | { type: 'settings' };
