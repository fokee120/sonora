import {resumeImports,autoSyncImports} from '../lib/importJobs.js';
import { audioCache } from '../lib/offline/AudioCache.js';
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Track,
  Album,
  Artist,
  Playlist,
  ViewRoute,
  StorageQuotaInfo,
} from '../types/index.js';
import { migrateLegacyCatalog } from '../lib/legacyCatalogMigration.js';
import { dbService } from '../lib/db.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';
import { useNetworkState } from '../hooks/useNetworkState.js';
import {
  cachedSearchYoutubeMusic as searchYoutubeMusicApi,
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
  recentHistory: { trackId: string; playedAt: number }[];
  isLoadingLibrary: boolean;
  libraryError: string | null;
  refreshLibrary: () => Promise<void>;
  addTracksToLibrary: (tracks: Track[]) => Promise<void>;

  // YouTube Music
  ytResults: Track[];
  ytFilter: YtmFilter;
  isSearchingYt: boolean;
  ytSearchError: string | null;
  searchYoutubeMusic: (query: string, filter?: YtmFilter, signal?: AbortSignal) => Promise<void>;
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
  updatePlaylist: (id: string, patch: Partial<Playlist>) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;

  // Favorites
  toggleFavorite: (trackId: string) => Promise<void>;
  isFavorite: (trackId: string) => boolean;

}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isOnline, recheck: recheckConnection } = useNetworkState();
  const [route, setRoute] = useState<ViewRoute>(() => ({ type: new URLSearchParams(location.search).has('spotify') ? 'settings' : 'home' }));
  useEffect(() => {
    try { localStorage.removeItem('gdrive_access_token'); localStorage.removeItem('gdrive_user'); } catch {}
  }, []);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<{ trackId: string; playedAt: number }[]>([]);
  const [recentHistory, setRecentHistory] = useState<{ trackId: string; playedAt: number }[]>([]);

  const [isLoadingLibrary, setIsLoadingLibrary] = useState<boolean>(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [storageInfo, setStorageInfo] = useState<StorageQuotaInfo | null>(null);
  const [downloadCounter, setDownloadCounter] = useState<number>(0); // To trigger reactivity on downloads

  // YouTube Music search state
  const [ytResults, setYtResults] = useState<Track[]>([]);
  const [ytFilter, setYtFilter] = useState<YtmFilter>('songs');
  const [isSearchingYt, setIsSearchingYt] = useState<boolean>(false);
  const ytErrorRef = useRef<string | null>(null);
  const ytSearchSequence = useRef(0);

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
    let completed = '';
    const unsub = offlineManager.subscribe(() => {
      setDownloadCounter((prev) => prev + 1);
      const next = [...offlineManager.getAllDownloadedTrackIds()].sort().join('\u0000');
      if (next !== completed) { completed = next; void refreshStorageInfo(); }
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

  // User-owned catalog only; an empty server library must never replace local imports.
  const refreshLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    setLibraryError(null);
    try {
      await migrateLegacyCatalog();
      setTracks(await dbService.getAllTracks());
      setAlbums(await dbService.getAllAlbums());
      setArtists(await dbService.getAllArtists());
    } catch (err: any) {
      setLibraryError(err.message || 'Failed to load local library.');
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  const addTracksToLibrary = useCallback(async (incoming: Track[]) => {
    if (incoming.length === 0) return;
    await dbService.saveTracks(incoming);
    setTracks((previous) => {
      const byId = new Map(previous.map((track) => [track.id, track]));
      for (const track of incoming) byId.set(track.id, track);
      return Array.from(byId.values());
    });
  }, []);

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

      const hist = await dbService.getPlayHistory(300);
      setHistory(hist.map((h) => ({ trackId: h.trackId, playedAt: h.playedAt })));
      setRecentHistory(await dbService.getRecentHistory(30));
    } catch (err) {
      console.warn('Error loading user data:', err);
    }
  }, []);

  useEffect(() => {
    refreshLibrary();
    loadUserData();
    refreshStorageInfo();
  }, [refreshLibrary, loadUserData, refreshStorageInfo]);

  useEffect(() => {
    const update = () => { void Promise.all([dbService.getPlayHistory(300), dbService.getRecentHistory(30)])
      .then(([plays, recent]) => { setHistory(plays); setRecentHistory(recent); }); };
    window.addEventListener('sonora:history-changed', update);
    return () => window.removeEventListener('sonora:history-changed', update);
  }, []);

  // React to download completions: newly saved YT tracks join the library
  useEffect(() => {
    let completed = '';
    const unsub = offlineManager.subscribe(() => {
      const next = [...offlineManager.getAllDownloadedTrackIds()].sort().join('\u0000');
      if (next !== completed) { completed = next; void mergeSavedYoutubeTracks(); }
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
  const searchYoutubeMusic = useCallback(async (query: string, filter: YtmFilter = 'songs', signal?: AbortSignal) => {
    const trimmed = query.trim();
    const sequence = ++ytSearchSequence.current;
    setYtFilter(filter);
    if (!trimmed) {
      setYtResults([]);
      return;
    }
    setIsSearchingYt(true);
    try {
      const tracks = await searchYoutubeMusicApi(trimmed, filter, signal);
      if (sequence !== ytSearchSequence.current || signal?.aborted) return;
      ytErrorRef.current = null;
      setYtResults(tracks);
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) return;
      if (sequence !== ytSearchSequence.current) return;
      ytErrorRef.current = err?.message || 'YouTube Music search failed';
      setYtResults([]);
      throw err;
    } finally {
      if (sequence === ytSearchSequence.current) setIsSearchingYt(false);
    }
  }, []);

  const clearYtResults = useCallback(() => {
    ++ytSearchSequence.current;
    ytErrorRef.current = null;
    setYtResults([]);
    setIsSearchingYt(false);
  }, []);

  const ytSearchError = ytErrorRef.current;

  // Offline filtering: when offline, show ONLY what is downloaded locally
  const downloadedTrackIds = useMemo(() => offlineManager.getAllDownloadedTrackIds(), [downloadCounter]);

  const displayTracks = useMemo(
    () => isOnline ? tracks : tracks.filter((t) => (downloadedTrackIds.has(t.id) || audioCache.has(t.id))),
    [downloadedTrackIds, isOnline, tracks]
  );

  const displayAlbums = useMemo(
    () => isOnline
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
          .filter((a): a is Album => a !== null),
    [albums, downloadedTrackIds, isOnline]
  );

  const displayArtists = useMemo(
    () => isOnline
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
          .filter((a): a is Artist => a !== null),
    [artists, displayTracks, isOnline]
  );

  const displayPlaylists = useMemo(
    () => isOnline
      ? playlists
      : playlists.filter((pl) => pl.trackIds.some((id) => downloadedTrackIds.has(id) || audioCache.has(id))),
    [downloadedTrackIds, isOnline, playlists]
  );

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

  useEffect(() => { if (isOnline) audioCache.enqueue(tracks); }, [tracks, isOnline]);

  useEffect(()=>{const refresh=()=>{void dbService.getAllPlaylists().then(setPlaylists);void dbService.getAllTracks().then(setTracks);};window.addEventListener('sonora:imports-changed',refresh);let cacheTimer: ReturnType<typeof setTimeout> | undefined;const cacheChanged=()=>{if(cacheTimer) return;cacheTimer=setTimeout(()=>{cacheTimer=undefined;setDownloadCounter(n=>n+1);void dbService.getAllTracks().then(setTracks);},500);};window.addEventListener('sonora:cache-changed',cacheChanged);void resumeImports();const timer=setInterval(()=>{if(navigator.onLine){void resumeImports();void autoSyncImports();}},60000);return()=>{window.removeEventListener('sonora:imports-changed',refresh);window.removeEventListener('sonora:cache-changed',cacheChanged);if(cacheTimer)clearTimeout(cacheTimer);clearInterval(timer);};},[]);
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

  const updatePlaylist = useCallback(async (id: string, patch: Partial<Playlist>) => {
    const updated=await dbService.mutatePlaylist(id, latest=>({...latest,...patch,id,updatedAt:Date.now()}));
    if(updated)setPlaylists(previous=>previous.map(p=>p.id===id?updated:p));
  }, []);

  const deletePlaylist = useCallback(async (id: string) => {
    await dbService.deletePlaylist(id);
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addTrackToPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      const updated=await dbService.mutatePlaylist(playlistId, pl=>({...pl,trackIds:[...new Set([...pl.trackIds,trackId])],updatedAt:Date.now()}));
      if(updated)setPlaylists(previous=>previous.map(p=>p.id===playlistId?updated:p));
    },
    [playlists]
  );

  const removeTrackFromPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      const updated=await dbService.mutatePlaylist(playlistId, pl=>({...pl,trackIds:pl.trackIds.filter(id=>id!==trackId),updatedAt:Date.now()}));
      if(updated)setPlaylists(previous=>previous.map(p=>p.id===playlistId?updated:p));
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
        recentHistory,
        isLoadingLibrary,
        libraryError,
        refreshLibrary,
        addTracksToLibrary,
        ytResults,
        ytFilter,
        isSearchingYt,
        ytSearchError,
        searchYoutubeMusic,
        clearYtResults,
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
        updatePlaylist,
        deletePlaylist,
        addTrackToPlaylist,
        removeTrackFromPlaylist,
        toggleFavorite,
        isFavorite,
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
