import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  Track,
  Album,
  Artist,
  Playlist,
  DownloadState,
  AudioBlobRecord,
  ArtworkRecord,
} from '../types/index.js';

export interface HistoryItem {
  id: string; // timestamp_trackId
  trackId: string;
  playedAt: number;
}

export interface FavoriteItem {
  trackId: string;
  addedAt: number;
}

export interface SettingItem {
  key: string;
  value: any;
  updatedAt: number;
}

export interface MusicDBSchema extends DBSchema {
  tracks: {
    key: string;
    value: Track;
    indexes: { 'by-artist': string; 'by-album': string };
  };
  albums: {
    key: string;
    value: Album;
    indexes: { 'by-artist': string };
  };
  artists: {
    key: string;
    value: Artist;
    indexes: { 'by-name': string };
  };
  playlists: {
    key: string;
    value: Playlist;
    indexes: { 'by-updated': number };
  };
  downloads: {
    key: string; // trackId
    value: DownloadState;
    indexes: { 'by-status': string; 'by-downloaded': number };
  };
  audioBlobs: {
    key: string; // trackId
    value: AudioBlobRecord;
  };
  artworks: {
    key: string; // url or trackId
    value: ArtworkRecord;
  };
  settings: {
    key: string;
    value: SettingItem;
  };
  history: {
    key: string;
    value: HistoryItem;
    indexes: { 'by-playedAt': number };
  };
  favorites: {
    key: string;
    value: FavoriteItem;
    indexes: { 'by-addedAt': number };
  };
}

const DB_NAME = 'personal-music-player-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MusicDBSchema>> | null = null;

export function getDB(): Promise<IDBPDatabase<MusicDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<MusicDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion < 1) {
          // Tracks
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('by-artist', 'artist');
          trackStore.createIndex('by-album', 'album');

          // Albums
          const albumStore = db.createObjectStore('albums', { keyPath: 'id' });
          albumStore.createIndex('by-artist', 'artist');

          // Artists
          const artistStore = db.createObjectStore('artists', { keyPath: 'id' });
          artistStore.createIndex('by-name', 'name');

          // Playlists
          const playlistStore = db.createObjectStore('playlists', { keyPath: 'id' });
          playlistStore.createIndex('by-updated', 'updatedAt');

          // Downloads state
          const downloadStore = db.createObjectStore('downloads', { keyPath: 'trackId' });
          downloadStore.createIndex('by-status', 'status');
          downloadStore.createIndex('by-downloaded', 'downloadedAt');

          // Audio Blobs (raw binary Blobs, never base64)
          db.createObjectStore('audioBlobs', { keyPath: 'trackId' });

          // Artworks
          db.createObjectStore('artworks', { keyPath: 'id' });

          // Settings
          db.createObjectStore('settings', { keyPath: 'key' });

          // Play history
          const historyStore = db.createObjectStore('history', { keyPath: 'id' });
          historyStore.createIndex('by-playedAt', 'playedAt');

          // Favorites
          const favoritesStore = db.createObjectStore('favorites', { keyPath: 'trackId' });
          favoritesStore.createIndex('by-addedAt', 'addedAt');
        }
      },
    });
  }
  return dbPromise;
}

// ------------------------------------------------
// Database Access Helpers
// ------------------------------------------------

export const dbService = {
  // Tracks
  async saveTracks(tracks: Track[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('tracks', 'readwrite');
    for (const track of tracks) {
      await tx.store.put(track);
    }
    await tx.done;
  },

  async getTrack(id: string): Promise<Track | undefined> {
    const db = await getDB();
    return db.get('tracks', id);
  },

  async getAllTracks(): Promise<Track[]> {
    const db = await getDB();
    return db.getAll('tracks');
  },

  // Albums
  async saveAlbums(albums: Album[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('albums', 'readwrite');
    for (const album of albums) {
      await tx.store.put(album);
    }
    await tx.done;
  },

  async getAllAlbums(): Promise<Album[]> {
    const db = await getDB();
    return db.getAll('albums');
  },

  // Artists
  async saveArtists(artists: Artist[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('artists', 'readwrite');
    for (const artist of artists) {
      await tx.store.put(artist);
    }
    await tx.done;
  },

  async getAllArtists(): Promise<Artist[]> {
    const db = await getDB();
    return db.getAll('artists');
  },

  // Audio Blobs
  async saveAudioBlob(trackId: string, blob: Blob, mimeType = 'audio/mpeg'): Promise<void> {
    const db = await getDB();
    await db.put('audioBlobs', {
      trackId,
      blob,
      mimeType,
      size: blob.size,
      cachedAt: Date.now(),
    });
  },

  async getAudioBlob(trackId: string): Promise<Blob | null> {
    const db = await getDB();
    const record = await db.get('audioBlobs', trackId);
    return record?.blob || null;
  },

  async removeAudioBlob(trackId: string): Promise<void> {
    const db = await getDB();
    await db.delete('audioBlobs', trackId);
  },

  async hasAudioBlob(trackId: string): Promise<boolean> {
    const db = await getDB();
    const count = await db.count('audioBlobs', trackId);
    return count > 0;
  },

  // Downloads Metadata
  async saveDownloadState(download: DownloadState): Promise<void> {
    const db = await getDB();
    await db.put('downloads', download);
  },

  async getDownloadState(trackId: string): Promise<DownloadState | undefined> {
    const db = await getDB();
    return db.get('downloads', trackId);
  },

  async getAllDownloads(): Promise<DownloadState[]> {
    const db = await getDB();
    return db.getAll('downloads');
  },

  async getCompletedDownloads(): Promise<DownloadState[]> {
    const db = await getDB();
    const all = await db.getAll('downloads');
    return all.filter((d) => d.status === 'completed');
  },

  async removeDownloadState(trackId: string): Promise<void> {
    const db = await getDB();
    await db.delete('downloads', trackId);
  },

  // Playlists
  async getAllPlaylists(): Promise<Playlist[]> {
    const db = await getDB();
    return db.getAll('playlists');
  },

  async getPlaylist(id: string): Promise<Playlist | undefined> {
    const db = await getDB();
    return db.get('playlists', id);
  },

  async savePlaylist(playlist: Playlist): Promise<void> {
    const db = await getDB();
    await db.put('playlists', playlist);
  },

  async deletePlaylist(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('playlists', id);
  },

  // Favorites
  async getFavorites(): Promise<string[]> {
    const db = await getDB();
    const all = await db.getAll('favorites');
    return all.map((f) => f.trackId);
  },

  async addFavorite(trackId: string): Promise<void> {
    const db = await getDB();
    await db.put('favorites', { trackId, addedAt: Date.now() });
  },

  async removeFavorite(trackId: string): Promise<void> {
    const db = await getDB();
    await db.delete('favorites', trackId);
  },

  async isFavorite(trackId: string): Promise<boolean> {
    const db = await getDB();
    const fav = await db.get('favorites', trackId);
    return Boolean(fav);
  },

  // History
  async addHistory(trackId: string): Promise<void> {
    const db = await getDB();
    const id = `${Date.now()}_${trackId}`;
    await db.put('history', { id, trackId, playedAt: Date.now() });
  },

  async getRecentHistory(limit = 30): Promise<HistoryItem[]> {
    const db = await getDB();
    const all = await db.getAllFromIndex('history', 'by-playedAt');
    return all.reverse().slice(0, limit);
  },

  // Settings
  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const db = await getDB();
      const item = await db.get('settings', key);
      return item ? item.value : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  async setSetting(key: string, value: any): Promise<void> {
    const db = await getDB();
    await db.put('settings', { key, value, updatedAt: Date.now() });
  },

  // Purge all offline downloads
  async clearAllDownloads(): Promise<void> {
    const db = await getDB();
    await db.clear('audioBlobs');
    await db.clear('downloads');
  },
};
