import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  Track,
  Album,
  Artist,
  Playlist,
  ViewRoute,
  StorageQuotaInfo,
  AuthSession,
} from '../types/index.js';
import { dbService } from '../lib/db.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';
import { useNetworkState } from '../hooks/useNetworkState.js';
import { User } from 'firebase/auth';
import { readDriveDuration } from '../lib/audio/driveMetadata.js';
import { responseError } from '../lib/audio/audioSource.js';
import {
  initGoogleAuth,
  getDriveAccessToken,
  logoutGoogleDrive,
} from '../lib/googleAuth.js';
import {
  searchYoutubeMusic as searchYoutubeMusicApi,
  isYoutubeTrack,
} from '../lib/ytmusic/youtubeMusic.js';
import type { YtmFilter } from '../lib/ytmusic/youtubeMusic.js';

interface AppContextType {
  // Navigation
  route: ViewRoute;
  navigate: (route: ViewRoute) => void;

  // Connectivity
  isOnline: boolean;
  recheckConnection: () => Promise<boolean>;

  // Library data
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  favorites: Set<string>;
  history: { trackId: string; playedAt: number }[];
  isGcsConfigured: boolean;
  isR2Configured: boolean;
  isLoadingLibrary: boolean;
  libraryError: string | null;
  refreshLibrary: () => Promise<void>;
  rescanLibrary: () => Promise<void>;

  // Google Drive
  driveUser: User | null;
  isDriveConnected: boolean;
  isScanningDrive: boolean;
  scanGoogleDrive: (folderId?: string) => Promise<void>;
  setDriveUser: (user: User | null) => void;

  // YouTube Music
  ytResults: Track[];
  ytFilter: YtmFilter;
  isSearchingYt: boolean;
  ytSearchError: string | null;
  searchYoutubeMusic: (query: string, filter?: YtmFilter) => Promise<void>;
  clearYtResults: () => void;

  // Create Playlist Modal
  isCreatePlaylistOpen: boolean;
  createPlaylistInitialTrackId?: string;
  openCreatePlaylist: (initialTrackId?: string) => void;
  closeCreatePlaylist: () => void;

  // Filtered views based on online/offline state
  displayTracks: Track[];
  displayAlbums: Album[];
  displayArtists: Artist[];
  displayPlaylists: Playlist[];

  // Offline manager helpers
  isDownloaded: (trackId: string) => boolean;
  isDownloading: (trackId: string) => boolean;
  downloadTrack: (track: Track) => Promise<void>;
  removeDownload: (trackId: string) => Promise<void>;
  downloadAlbum: (album: Album) => Promise<void>;
  removeAlbumDownload: (album: Album) => Promise<void>;
  downloadPlaylist: (playlist: Playlist) => Promise<void>;
  removePlaylistDownload: (playlist: Playlist) => Promise<void>;
  clearAllDownloads: () => Promise<void>;

  // Storage
  storageInfo: StorageQuotaInfo | null;
  refreshStorageInfo: () => Promise<void>;
  requestPersistStorage: () => Promise<boolean>;

  // Playlists
  createPlaylist: (
    title: string,
    description?: string,
    initialTrackIds?: string[]
  ) => Promise<Playlist>;
  deletePlaylist: (id: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;

  // Favorites
  toggleFavorite: (trackId: string) => Promise<void>;
  isFavorite: (trackId: string) => boolean;

  // Auth
  authSession: AuthSession;
  login: (email: string, name?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isOnline, recheck: recheckConnection } = useNetworkState();
  const [route, setRoute] = useState<ViewRoute>({ type: 'home' });

  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<{ trackId: string; playedAt: number }[]>([]);

  const [isGcsConfigured, setIsGcsConfigured] = useState<boolean>(false);
  const [isR2Configured, setIsR2Configured] = useState<boolean>(false);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState<boolean>(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [storageInfo, setStorageInfo] = useState<StorageQuotaInfo | null>(null);
  const [, setDownloadCounter] = useState<number>(0); // To trigger reactivity on downloads

  const [authSession, setAuthSession] = useState<AuthSession>({
    user: null,
    isAuthenticated: false,
    authRequired: false,
    authorizedEmails: [],
  });

  // Google Drive Integration State
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [isDriveConnected, setIsDriveConnected] = useState<boolean>(false);
  const [isScanningDrive, setIsScanningDrive] = useState<boolean>(false);
  const driveScanController = useRef<AbortController | null>(null);

  // YouTube Music search state
  const [ytResults, setYtResults] = useState<Track[]>([]);
  const [ytFilter, setYtFilter] = useState<YtmFilter>('songs');
  const [isSearchingYt, setIsSearchingYt] = useState<boolean>(false);
  const ytErrorRef = useRef<string | null>(null);

  const saveDuration = useCallback(async (track: Track, duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const updated = { ...track, duration };
    setTracks(previous => previous.map(item => item.id === track.id ? { ...item, duration } : item));
    setAlbums(previous => previous.map(album => {
      if (!album.tracks?.some(item => item.id === track.id)) return album;
      const albumTracks = album.tracks.map(item => item.id === track.id ? { ...item, duration } : item);
      return { ...album, tracks: albumTracks, duration: albumTracks.reduce((total, item) => total + item.duration, 0) };
    }));
    try {
      await dbService.saveTracks([updated]);
      await dbService.setSetting(`duration:${track.id}`, { key: track.metadataKey, duration });
    } catch (err) {
      console.warn('Could not cache track duration:', err);
    }
  }, []);

  useEffect(() => {
    const onDuration = (event: Event) => {
      const { track, duration } = (event as CustomEvent<{ track: Track; duration: number }>).detail;
      void saveDuration(track, duration);
    };
    window.addEventListener('track-duration', onDuration);
    return () => window.removeEventListener('track-duration', onDuration);
  }, [saveDuration]);

  useEffect(() => () => driveScanController.current?.abort(), []);

  // Playlist Modal Controls
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState<boolean>(false);
  const [createPlaylistInitialTrackId, setCreatePlaylistInitialTrackId] = useState<string | undefined>(undefined);

  const openCreatePlaylist = useCallback((initialTrackId?: string) => {
    setCreatePlaylistInitialTrackId(initialTrackId);
    setIsCreatePlaylistOpen(true);
  }, []);

  const closeCreatePlaylist = useCallback(() => {
    setIsCreatePlaylistOpen(false);
    setCreatePlaylistInitialTrackId(undefined);
  }, []);

  // Subscribe to offline manager updates
  useEffect(() => {
    const unsub = offlineManager.subscribe(() => {
      setDownloadCounter((prev) => prev + 1);
      refreshStorageInfo();
    });
    return unsub;
  }, []);

  // Storage info refresh
  const refreshStorageInfo = useCallback(async () => {
    try {
      const info = await offlineManager.getStorageEstimate();
      setStorageInfo(info);
    } catch (err) {
      console.warn('Storage info error:', err);
    }
  }, []);

  // Check auth session
  const checkSession = useCallback(async () => {
    try {
      const token = localStorage.getItem('music_auth_token');
      const res = await fetch('/api/auth/session', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setAuthSession(data);
      }
    } catch {
      // Offline fallback: check stored user
      const stored = localStorage.getItem('music_auth_user');
      if (stored) {
        try {
          const user = JSON.parse(stored);
          setAuthSession({
            user,
            isAuthenticated: true,
            authRequired: false,
            authorizedEmails: [],
          });
        } catch {
          // ignore
        }
      }
    }
  }, []);

  // Fetch Library from server or IndexedDB cache
  const refreshLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    setLibraryError(null);

    // Try fetching from API when online
    if (navigator.onLine && !getDriveAccessToken()) {
      try {
        const token = localStorage.getItem('music_auth_token');
        const res = await fetch('/api/library', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (res.ok) {
          const data = await res.json();
          if (getDriveAccessToken()) return;
          setTracks(data.tracks || []);
          setAlbums(data.albums || []);
          setArtists(data.artists || []);
          const gcsConf = Boolean(data.isGcsConfigured ?? data.isR2Configured);
          setIsGcsConfigured(gcsConf);
          setIsR2Configured(gcsConf);

          // Cache in IndexedDB for offline access
          await dbService.saveTracks(data.tracks || []);
          await dbService.saveAlbums(data.albums || []);
          await dbService.saveArtists(data.artists || []);
          setIsLoadingLibrary(false);
          return;
        }
      } catch (err: any) {
        console.warn('Network fetch failed, falling back to local DB cache:', err);
      }
    }

    // Offline or fallback to local IndexedDB
    try {
      const cachedTracks = await dbService.getAllTracks();
      const cachedAlbums = await dbService.getAllAlbums();
      const cachedArtists = await dbService.getAllArtists();

      if (cachedTracks.length > 0) {
        setTracks(cachedTracks);
        setAlbums(cachedAlbums);
        setArtists(cachedArtists);
      } else {
        setLibraryError('No cached tracks found. Please connect to the internet to load the music library.');
      }
    } catch (dbErr: any) {
      setLibraryError(dbErr.message || 'Failed to load local database.');
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  // Force a fresh scan on Google Cloud Storage and update immediately
  const rescanLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    setLibraryError(null);

    try {
      const token = localStorage.getItem('music_auth_token');
      const res = await fetch('/api/storage/rescan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prefix: 'music/' }),
      });

      if (res.ok) {
        const payload = await res.json();
        const data = payload.result || payload;
        setTracks(data.tracks || []);
        setAlbums(data.albums || []);
        setArtists(data.artists || []);
        const gcsConf = Boolean(data.isGcsConfigured ?? data.isR2Configured);
        setIsGcsConfigured(gcsConf);
        setIsR2Configured(gcsConf);

        await dbService.saveTracks(data.tracks || []);
        await dbService.saveAlbums(data.albums || []);
        await dbService.saveArtists(data.artists || []);
        return;
      }
    } catch (err: any) {
      console.warn('Rescan network request failed, falling back to normal refresh:', err);
    }

    await refreshLibrary();
  }, [refreshLibrary]);

  // Scan Google Drive audio files and extract metadata (using server-side or client token)
  const scanGoogleDrive = useCallback(async (folderId?: string) => {
    const token = getDriveAccessToken();
    driveScanController.current?.abort();
    const controller = new AbortController();
    driveScanController.current = controller;

    setIsScanningDrive(true);
    setLibraryError(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token && token !== 'server-active-token') {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/drive/scan', {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          accessToken: token && token !== 'server-active-token' ? token : undefined,
          folderId,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setIsDriveConnected(false);
          setDriveUser(null);
        }
        throw await responseError(res, 'Failed to scan Google Drive');
      }

      const data = await res.json();
      const scannedTracks: Track[] = data.tracks || [];
      for (const track of scannedTracks) {
        const cached = await dbService.getSetting<{ key?: string; duration: number } | null>(`duration:${track.id}`, null);
        if (cached && cached.key === track.metadataKey) track.duration = cached.duration;
      }
      controller.signal.throwIfAborted();
      const byId = new Map(scannedTracks.map(track => [track.id, track]));
      data.albums = (data.albums || []).map((album: Album) => {
        const albumTracks = (album.tracks || []).map(track => byId.get(track.id) || track);
        return { ...album, tracks: albumTracks, duration: albumTracks.reduce((sum, track) => sum + track.duration, 0) };
      });
      setTracks(data.tracks || []);
      setAlbums(data.albums || []);
      setArtists(data.artists || []);

      if (data.tracks && data.tracks.length > 0) {
        // Persist to IndexedDB
        await dbService.saveTracks(data.tracks);
        await dbService.saveAlbums(data.albums || []);
        await dbService.saveArtists(data.artists || []);
        // Limit parallel range reads so indexing stays responsive during playback.
        const pending = scannedTracks.filter(track => !track.duration);
        const worker = async () => {
          while (pending.length && !controller.signal.aborted) {
            const track = pending.shift()!;
            try {
              const duration = await readDriveDuration(track, controller.signal);
              if (!controller.signal.aborted) await saveDuration(track, duration);
            } catch (err) {
              if (!controller.signal.aborted) console.warn('Could not read audio duration:', track.id, err);
            }
          }
        };
        void Promise.all([worker(), worker()]);
      } else if (data.debug) {
        const sampleNames = (data.debug.sampleFiles || [])
          .map((file: { name: string }) => file.name)
          .filter(Boolean)
          .slice(0, 3)
          .join(', ');
        setLibraryError(
          `Google Drive scan found ${data.debug.visibleFiles} visible files and ${data.debug.audioFiles} audio files. ${sampleNames ? `Sample files: ${sampleNames}` : 'Try disconnecting and signing in again with Drive permission.'}`
        );
      }
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.error('Failed scanning Google Drive:', err);
      setLibraryError(err.message || 'Failed scanning Google Drive');
    } finally {
      if (driveScanController.current === controller) setIsScanningDrive(false);
    }
  }, [saveDuration]);

  // Google Drive Auth listener & Server-side session verification
  useEffect(() => {
    let initialScanTriggered = false;
    const unsub = initGoogleAuth((user, token) => {
      setDriveUser(user);
      setIsDriveConnected(Boolean(user && token));
      if (user && token && !initialScanTriggered) {
        initialScanTriggered = true;
        scanGoogleDrive();
      }
    });
    return unsub;
  }, [scanGoogleDrive]);

  // Merge YouTube Music tracks saved via offline downloads (IndexedDB)
  // into the active library so they show up in Library/Downloads/Search.
  const mergeSavedYoutubeTracks = useCallback(async () => {
    try {
      const allCached = await dbService.getAllTracks();
      const ytTracks = allCached.filter((t) => isYoutubeTrack(t));
      if (ytTracks.length === 0) return;
      setTracks((prev) => {
        const known = new Set(prev.map((t) => t.id));
        const additions = ytTracks.filter((t) => !known.has(t.id));
        return additions.length > 0 ? [...additions, ...prev] : prev;
      });
    } catch (err) {
      console.warn('Could not merge saved YouTube tracks:', err);
    }
  }, []);

  // Load Playlists, Favorites, and History
  const loadUserData = useCallback(async () => {
    try {
      const pls = await dbService.getAllPlaylists();
      setPlaylists(pls);

      const favs = await dbService.getFavorites();
      setFavorites(new Set(favs));

      const hist = await dbService.getRecentHistory(30);
      setHistory(hist.map((h) => ({ trackId: h.trackId, playedAt: h.playedAt })));
    } catch (err) {
      console.warn('Error loading user data:', err);
    }
  }, []);

  useEffect(() => {
    checkSession();
    refreshLibrary();
    loadUserData();
    refreshStorageInfo();
  }, [checkSession, refreshLibrary, loadUserData, refreshStorageInfo]);

  // React to download completions: newly saved YT tracks join the library
  useEffect(() => {
    const unsub = offlineManager.subscribe(() => {
      void mergeSavedYoutubeTracks();
    });
    return unsub;
  }, [mergeSavedYoutubeTracks]);

  // Re-merge saved YT tracks whenever the base library or connection changes
  useEffect(() => {
    void mergeSavedYoutubeTracks();
  }, [isOnline, isLoadingLibrary, mergeSavedYoutubeTracks]);

  // When connection changes, reload library
  useEffect(() => {
    if (isOnline) {
      refreshLibrary();
    }
  }, [isOnline, refreshLibrary]);

  // YouTube Music catalog search (server-proxied)
  const searchYoutubeMusic = useCallback(async (query: string, filter: YtmFilter = 'songs') => {
    const trimmed = query.trim();
    setYtFilter(filter);
    if (!trimmed) {
      setYtResults([]);
      return;
    }
    setIsSearchingYt(true);
    try {
      const tracks = await searchYoutubeMusicApi(trimmed, filter);
      ytErrorRef.current = null;
      setYtResults(tracks);
    } catch (err: any) {
      ytErrorRef.current = err?.message || 'YouTube Music search failed';
      setYtResults([]);
      throw err;
    } finally {
      setIsSearchingYt(false);
    }
  }, []);

  const ytSearchError = ytErrorRef.current;

  // Offline filtering: when offline, show ONLY what is downloaded locally
  const downloadedTrackIds = offlineManager.getAllDownloadedTrackIds();

  const displayTracks = isOnline
    ? tracks
    : tracks.filter((t) => downloadedTrackIds.has(t.id));

  const displayAlbums = isOnline
    ? albums
    : albums
        .map((album) => {
          const matchingTracks = (album.tracks || []).filter((t) =>
            downloadedTrackIds.has(t.id)
          );
          if (matchingTracks.length === 0) return null;
          return {
            ...album,
            tracks: matchingTracks,
            trackCount: matchingTracks.length,
          };
        })
        .filter((a): a is Album => a !== null);

  const displayArtists = isOnline
    ? artists
    : artists
        .map((artist) => {
          const artistTracks = displayTracks.filter((t) => t.artist === artist.name);
          if (artistTracks.length === 0) return null;
          return {
            ...artist,
            trackCount: artistTracks.length,
          };
        })
        .filter((a): a is Artist => a !== null);

  const displayPlaylists = isOnline
    ? playlists
    : playlists.filter((pl) => pl.trackIds.some((id) => downloadedTrackIds.has(id)));

  // Offline helpers
  const isDownloaded = useCallback(
    (trackId: string) => offlineManager.isTrackDownloaded(trackId),
    []
  );

  const isDownloading = useCallback(
    (trackId: string) => offlineManager.isTrackDownloading(trackId),
    []
  );

  const downloadTrack = useCallback(async (track: Track) => {
    await offlineManager.downloadTrack(track);
  }, []);

  const removeDownload = useCallback(async (trackId: string) => {
    await offlineManager.removeTrackDownload(trackId);
  }, []);

  const downloadAlbum = useCallback(async (album: Album) => {
    await offlineManager.downloadAlbum(album);
  }, []);

  const removeAlbumDownload = useCallback(async (album: Album) => {
    await offlineManager.removeAlbumDownload(album);
  }, []);

  const downloadPlaylist = useCallback(
    async (playlist: Playlist) => {
      await offlineManager.downloadPlaylist(playlist, tracks);
    },
    [tracks]
  );

  const removePlaylistDownload = useCallback(async (playlist: Playlist) => {
    await offlineManager.removePlaylistDownload(playlist);
  }, []);

  const clearAllDownloads = useCallback(async () => {
    await offlineManager.clearAllDownloads();
    await refreshStorageInfo();
  }, [refreshStorageInfo]);

  const requestPersistStorage = useCallback(async () => {
    const success = await offlineManager.requestPersistentStorage();
    await refreshStorageInfo();
    return success;
  }, [refreshStorageInfo]);

  // Playlist management
  const createPlaylist = useCallback(
    async (
      title: string,
      description?: string,
      initialTrackIds?: string[]
    ): Promise<Playlist> => {
      const newPl: Playlist = {
        id: 'pl_' + Math.random().toString(36).substring(2, 10),
        title: title.trim(),
        description: description?.trim() || '',
        trackIds: initialTrackIds ? Array.from(new Set(initialTrackIds)) : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await dbService.savePlaylist(newPl);
      setPlaylists((prev) => [newPl, ...prev]);
      return newPl;
    },
    []
  );

  const deletePlaylist = useCallback(async (id: string) => {
    await dbService.deletePlaylist(id);
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addTrackToPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      const pl = playlists.find((p) => p.id === playlistId);
      if (!pl) return;
      if (pl.trackIds.includes(trackId)) return;

      const updated: Playlist = {
        ...pl,
        trackIds: [...pl.trackIds, trackId],
        updatedAt: Date.now(),
      };
      await dbService.savePlaylist(updated);
      setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)));
    },
    [playlists]
  );

  const removeTrackFromPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      const pl = playlists.find((p) => p.id === playlistId);
      if (!pl) return;

      const updated: Playlist = {
        ...pl,
        trackIds: pl.trackIds.filter((id) => id !== trackId),
        updatedAt: Date.now(),
      };
      await dbService.savePlaylist(updated);
      setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)));
    },
    [playlists]
  );

  // Favorites
  const toggleFavorite = useCallback(
    async (trackId: string) => {
      const isFav = favorites.has(trackId);
      if (isFav) {
        await dbService.removeFavorite(trackId);
        setFavorites((prev) => {
          const next = new Set(prev);
          next.delete(trackId);
          return next;
        });
      } else {
        await dbService.addFavorite(trackId);
        setFavorites((prev) => {
          const next = new Set(prev);
          next.add(trackId);
          return next;
        });
      }
    },
    [favorites]
  );

  const isFavorite = useCallback(
    (trackId: string) => favorites.has(trackId),
    [favorites]
  );

  // Auth
  const login = useCallback(
    async (email: string, name?: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.error || 'Login failed' };
        }

        if (data.token) {
          localStorage.setItem('music_auth_token', data.token);
          localStorage.setItem('music_auth_user', JSON.stringify(data.user));
          setAuthSession((prev) => ({
            ...prev,
            user: data.user,
            isAuthenticated: true,
          }));
          refreshLibrary();
          return { success: true };
        }
        return { success: false, error: 'No token received' };
      } catch (err: any) {
        return { success: false, error: err.message || 'Network error logging in' };
      }
    },
    [refreshLibrary]
  );

  const logout = useCallback(async () => {
    try {
      const token = localStorage.getItem('music_auth_token');
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // ignore
    }
    localStorage.removeItem('music_auth_token');
    localStorage.removeItem('music_auth_user');
    setAuthSession((prev) => ({
      ...prev,
      user: null,
      isAuthenticated: false,
    }));
  }, []);

  return (
    <AppContext.Provider
      value={{
        route,
        navigate: setRoute,
        isOnline,
        recheckConnection,
        tracks,
        albums,
        artists,
        playlists,
        favorites,
        history,
        isGcsConfigured,
        isR2Configured,
        isLoadingLibrary,
        libraryError,
        refreshLibrary,
        rescanLibrary,
        driveUser,
        isDriveConnected,
        isScanningDrive,
        scanGoogleDrive,
        setDriveUser,
        ytResults,
        ytFilter,
        isSearchingYt,
        ytSearchError,
        searchYoutubeMusic,
        clearYtResults: () => {
          ytErrorRef.current = null;
          setYtResults([]);
        },
        isCreatePlaylistOpen,
        createPlaylistInitialTrackId,
        openCreatePlaylist,
        closeCreatePlaylist,
        displayTracks,
        displayAlbums,
        displayArtists,
        displayPlaylists,
        isDownloaded,
        isDownloading,
        downloadTrack,
        removeDownload,
        downloadAlbum,
        removeAlbumDownload,
        downloadPlaylist,
        removePlaylistDownload,
        clearAllDownloads,
        storageInfo,
        refreshStorageInfo,
        requestPersistStorage,
        createPlaylist,
        deletePlaylist,
        addTrackToPlaylist,
        removeTrackFromPlaylist,
        toggleFavorite,
        isFavorite,
        authSession,
        login,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}
