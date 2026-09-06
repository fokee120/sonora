import React, { useState, useMemo } from 'react';
import { Search, X, Music, Disc3, User, WifiOff } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { TrackRow } from '../components/common/TrackRow.js';

export const SearchView: React.FC = () => {
  const { displayTracks, displayAlbums, displayArtists, navigate, isOnline } = useApp();
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'songs' | 'albums' | 'artists'>('all');

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
        <h1 className="text-2xl font-bold tracking-tight text-white">Search Vault</h1>

        {!isOnline && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/40 border border-amber-800/40 text-xs text-amber-300">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Searching within offline downloaded songs only</span>
          </div>
        )}

        <div className="relative max-w-xl">
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            id="search-input"
            type="text"
            placeholder="Search songs, artists, albums, genres..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-11 pr-10 py-3 bg-zinc-900/80 border border-zinc-800 focus:border-indigo-500 rounded-2xl text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-hidden transition shadow-lg"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        {hasQuery && (
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
      </div>

      {/* Results View */}
      {hasQuery ? (
        totalMatches === 0 ? (
          <div className="py-16 text-center text-zinc-500 text-sm">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-40 text-zinc-400" />
            <p>No results found for &ldquo;{query}&rdquo;</p>
            <p className="text-xs text-zinc-600 mt-1">Try checking for typos or searching by artist.</p>
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
          Type to search your personal music files.
        </div>
      )}
    </div>
  );
};
