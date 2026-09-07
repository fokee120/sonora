import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, Music, Disc3, User, WifiOff, Youtube, Loader2, AlertCircle } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { TrackRow } from '../components/common/TrackRow.js';
import type { YtmFilter } from '../lib/ytmusic/youtubeMusic.js';

type SearchSource = 'vault' | 'youtube';

const YT_FILTERS: YtmFilter[] = ['songs', 'videos', 'albums', 'artists'];

export const SearchView: React.FC = () => {
  const {
    displayTracks,
    displayAlbums,
    displayArtists,
    navigate,
    isOnline,
    ytResults,
    ytFilter,
    isSearchingYt,
    ytSearchError,
    searchYoutubeMusic,
    clearYtResults,
  } = useApp();

  const [source, setSource] = useState<SearchSource>('vault');
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'songs' | 'albums' | 'artists'>('all');
  const [localYtError, setLocalYtError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Trigger debounced YouTube Music search when typing in YT mode
  useEffect(() => {
    if (source !== 'youtube') return;
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q) {
      clearYtResults();
      setLocalYtError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      searchYoutubeMusic(q, ytFilter).catch((err: any) => {
        if (err?.name === 'AbortError') return;
        setLocalYtError(err?.message || 'YouTube Music search failed');
      });
    }, 450);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source, ytFilter]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const switchSource = (next: SearchSource) => {
    setSource(next);
    setLocalYtError(null);
    if (next === 'vault') {
      clearYtResults();
    } else if (query.trim()) {
      // Re-run immediately when switching to YouTube with a live query
      searchYoutubeMusic(query, ytFilter).catch((err: any) => {
        setLocalYtError(err?.message || 'YouTube Music search failed');
      });
    }
  };

  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return { tracks: [], albums: [], artists: [] };
    }

    const matchedTracks = displayTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        (t.genre && t.genre.toLowerCase().includes(q))
    );

    const matchedAlbums = displayAlbums.filter(
      (a) => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
    );

    const matchedArtists = displayArtists.filter((art) => art.name.toLowerCase().includes(q));

    return {
      tracks: matchedTracks,
      albums: matchedAlbums,
      artists: matchedArtists,
    };
  }, [query, displayTracks, displayAlbums, displayArtists]);

  const hasQuery = query.trim().length > 0;
  const totalMatches =
    filteredResults.tracks.length + filteredResults.albums.length + filteredResults.artists.length;

  return (
    <div id="search-view" className="space-y-6 pb-12">
      {/* Search Header & Input */}
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">Search</h1>

        {!isOnline && source === 'youtube' && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/40 border border-amber-800/40 text-xs text-amber-300">
            <WifiOff className="w-3.5 h-3.5" />
            <span>YouTube Music search needs an internet connection</span>
          </div>
        )}
        {!isOnline && source === 'vault' && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/40 border border-amber-800/40 text-xs text-amber-300">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Searching within offline downloaded songs only</span>
          </div>
        )}

        {/* Source Toggle */}
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-zinc-900/70 border border-zinc-800">
          <button
            onClick={() => switchSource('vault')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              source === 'vault'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Disc3 className="w-3.5 h-3.5" />
            <span>My Vault</span>
          </button>
          <button
            onClick={() => switchSource('youtube')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              source === 'youtube'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Youtube className="w-3.5 h-3.5" />
            <span>YouTube Music</span>
          </button>
        </div>

        <div className="relative max-w-xl">
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            id="search-input"
            type="text"
            placeholder={
              source === 'youtube'
                ? 'Search the YouTube Music catalog...'
                : 'Search songs, artists, albums, genres...'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-11 pr-10 py-3 bg-zinc-900/80 border border-zinc-800 focus:border-indigo-500 rounded-2xl text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-hidden transition shadow-lg"
            autoFocus
          />
          {isSearchingYt && (
            <Loader2 className="w-4 h-4 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2 text-red-400" />
          )}
          {query && !isSearchingYt && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        {hasQuery && source === 'vault' && (
          <div className="flex items-center gap-2">
            {(['all', 'songs', 'albums', 'artists'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition ${
                  filterType === type
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        )}

        {hasQuery && source === 'youtube' && (
          <div className="flex items-center gap-2">
            {YT_FILTERS.map((type) => (
              <button
                key={type}
                onClick={() => searchYoutubeMusic(query, type).catch((err: any) => {
                  setLocalYtError(err?.message || 'YouTube Music search failed');
                })}
                className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition ${
                  ytFilter === type
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results View */}
      {hasQuery ? (
        source === 'youtube' ? (
          /* ---- YouTube Music results ---- */
          (isSearchingYt && ytResults.length === 0) ? (
            <div className="py-16 text-center text-zinc-500 text-sm flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-red-400" />
              <span>Searching YouTube Music…</span>
            </div>
          ) : (localYtError || ytSearchError) && ytResults.length === 0 ? (
            <div className="py-14 text-center text-sm text-rose-300 bg-rose-950/20 border border-rose-900/30 rounded-2xl flex flex-col items-center gap-2">
              <AlertCircle className="w-6 h-6" />
              <span>{localYtError || ytSearchError}</span>
              <span className="text-xs text-zinc-500">
                The YouTube Music search runs server-side; check the server logs if this keeps happening.
              </span>
            </div>
          ) : ytResults.length === 0 ? (
            <div className="py-16 text-center text-zinc-500 text-sm">
              <Youtube className="w-8 h-8 mx-auto mb-2 opacity-40 text-red-400" />
              <p>No YouTube Music results for &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <Music className="w-4 h-4 text-red-400" />
                  <span>YouTube Music ({ytResults.length})</span>
                </h2>
                <p className="text-[11px] text-zinc-500 hidden sm:block">
                  Press the download icon to keep a song offline in browser storage
                </p>
              </div>
              <div className="divide-y divide-zinc-900/60 rounded-2xl bg-zinc-900/20 border border-zinc-800/50 p-1">
                {ytResults.map((track, idx) => (
                  <TrackRow
                    key={`yt-${track.id}`}
                    track={track}
                    index={idx}
                    tracksContext={ytResults}
                  />
                ))}
              </div>
            </div>
          )
        ) : /* ---- Vault results ---- */
        totalMatches === 0 ? (
          <div className="py-16 text-center text-zinc-500 text-sm">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-40 text-zinc-400" />
            <p>No results found for &ldquo;{query}&rdquo;</p>
            <p className="text-xs text-zinc-600 mt-1">
              Not in your vault?{' '}
              <button
                onClick={() => switchSource('youtube')}
                className="text-red-400 hover:text-red-300 underline underline-offset-2"
              >
                Search YouTube Music
              </button>
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Albums Results */}
            {(filterType === 'all' || filterType === 'albums') &&
              filteredResults.albums.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                    <Disc3 className="w-4 h-4 text-indigo-400" />
                    <span>Albums ({filteredResults.albums.length})</span>
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {filteredResults.albums.map((album) => (
                      <div
                        key={album.id}
                        onClick={() => navigate({ type: 'album', id: album.id })}
                        className="p-2.5 rounded-xl bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800 transition cursor-pointer"
                      >
                        <img
                          src={album.artworkUrl || '/icon.svg'}
                          alt={album.title}
                          className="w-full aspect-square object-cover rounded-lg bg-zinc-950 mb-2"
                        />
                        <p className="text-xs font-medium text-zinc-200 truncate">{album.title}</p>
                        <p className="text-[11px] text-zinc-500 truncate">{album.artist}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Artists Results */}
            {(filterType === 'all' || filterType === 'artists') &&
              filteredResults.artists.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                    <User className="w-4 h-4 text-indigo-400" />
                    <span>Artists ({filteredResults.artists.length})</span>
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                    {filteredResults.artists.map((artist) => (
                      <div
                        key={artist.id}
                        onClick={() => navigate({ type: 'artist', id: artist.id })}
                        className="p-3 rounded-xl bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800 transition cursor-pointer flex flex-col items-center text-center"
                      >
                        <img
                          src={artist.artworkUrl || '/icon.svg'}
                          alt={artist.name}
                          className="w-16 h-16 rounded-full object-cover bg-zinc-950 mb-2 border border-zinc-800"
                        />
                        <p className="text-xs font-medium text-zinc-200 truncate w-full">
                          {artist.name}
                        </p>
                        <p className="text-[10px] text-zinc-500 font-mono">
                          {artist.trackCount} tracks
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Songs Results */}
            {(filterType === 'all' || filterType === 'songs') &&
              filteredResults.tracks.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                    <Music className="w-4 h-4 text-indigo-400" />
                    <span>Songs ({filteredResults.tracks.length})</span>
                  </h2>
                  <div className="divide-y divide-zinc-900/60 rounded-2xl bg-zinc-900/20 border border-zinc-800/50 p-1">
                    {filteredResults.tracks.map((track, idx) => (
                      <TrackRow
                        key={`search-${track.id}`}
                        track={track}
                        index={idx}
                        tracksContext={filteredResults.tracks}
                      />
                    ))}
                  </div>
                </div>
              )}
          </div>
        )
      ) : (
        <div className="py-20 text-center text-zinc-500 text-xs">
          {source === 'youtube'
            ? 'Search the full YouTube Music catalog, then download songs to keep them offline.'
            : 'Type to search your personal music files, or switch to YouTube Music to pull new songs.'}
        </div>
      )}
    </div>
  );
};
