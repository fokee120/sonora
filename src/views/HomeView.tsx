import React from 'react';
import {
  Play,
  Shuffle,
  HardDriveDownload,
  Disc3,
  Sparkles,
  ArrowRight,
  Heart,
  Cloud,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';

export const HomeView: React.FC = () => {
  const {
    displayTracks,
    displayAlbums,
    displayArtists,
    displayPlaylists,
    favorites,
    history,
    navigate,
    isOnline,
    isR2Configured,
    storageInfo,
    downloadAlbum,
  } = useApp();

  const { playTrack, setQueue } = usePlayer();

  // Find recently played tracks from history
  const recentTracks = history
    .map((h) => displayTracks.find((t) => t.id === h.trackId))
    .filter((t): t is typeof displayTracks[0] => Boolean(t))
    .slice(0, 6);

  // Liked tracks
  const likedTracks = displayTracks.filter((t) => favorites.has(t.id));

  // Quick Play handler
  const handlePlayAll = (tracksToPlay: typeof displayTracks, shuffle = false) => {
    if (tracksToPlay.length === 0) return;
    setQueue(tracksToPlay, tracksToPlay[0]);
    playTrack(tracksToPlay[0], tracksToPlay);
  };

  return (
    <div id="home-view" className="space-y-8 pb-12">
      {/* Welcome Atmospheric Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 glass border border-white/10 shadow-2xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1.5 shadow-[0_0_12px_rgba(59,130,246,0.15)]">
                <Sparkles className="w-3 h-3 text-blue-400" />
                <span>Personal Streaming Vault</span>
              </span>
              {!isOnline && (
                <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                  <span>Offline Active</span>
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-white">
              {isOnline ? 'Your Personal Music Library' : 'Offline Mode — Ready to Play'}
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {isOnline
                ? isR2Configured
                  ? 'Connected to your GCS bucket. Stream private master recordings or store offline in IndexedDB.'
                  : 'Welcome! Explore your library with instant streaming, high-fidelity caching, and complete offline playback.'
                : `Internet connection unavailable. You have ${storageInfo?.trackCount || 0} tracks cached in persistent storage ready for offline listening.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => handlePlayAll(displayTracks)}
              disabled={displayTracks.length === 0}
              className="px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-2 transition shadow-lg shadow-blue-900/40 disabled:opacity-40"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>Play All</span>
            </button>

            <button
              onClick={() => handlePlayAll(displayTracks, true)}
              disabled={displayTracks.length === 0}
              className="px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white font-medium text-xs flex items-center gap-2 border border-white/10 transition disabled:opacity-40"
            >
              <Shuffle className="w-4 h-4" />
              <span>Shuffle</span>
            </button>
          </div>
        </div>

        {/* Ambient atmospheric radial gradient inside hero */}
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Offline Downloads Quick Bar */}
      {storageInfo && storageInfo.trackCount > 0 && (
        <div
          onClick={() => navigate({ type: 'downloads' })}
          className="glass rounded-2xl p-4 border border-emerald-500/20 bg-emerald-950/10 hover:border-emerald-500/40 transition cursor-pointer flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.2)]">
              <HardDriveDownload className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                <span>Downloaded Offline Vault</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/40 font-mono">
                  {storageInfo.trackCount} Tracks
                </span>
              </p>
              <p className="text-[11px] text-zinc-400">
                {storageInfo.downloadSizeMB} MB stored safely in local IndexedDB
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300">
            <span>View Downloads</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </div>
      )}

      {/* Recently Played */}
      {recentTracks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white tracking-tight">Recently Played</h2>
          </div>
          <div className="divide-y divide-white/5 rounded-2xl glass-card p-1">
            {recentTracks.map((track, idx) => (
              <TrackRow
                key={`recent-${track.id}`}
                track={track}
                index={idx}
                tracksContext={recentTracks}
              />
            ))}
          </div>
        </section>
      )}

      {/* Albums Shelf */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">Albums</h2>
            <p className="text-xs text-zinc-400">Master album collections in your vault</p>
          </div>
          {displayAlbums.length > 4 && (
            <button
              onClick={() => navigate({ type: 'albums' })}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 transition"
            >
              <span>See all</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {displayAlbums.length === 0 ? (
          <div className="p-8 rounded-2xl glass-card text-center text-xs text-zinc-500">
            No albums available.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {displayAlbums.slice(0, 5).map((album) => (
              <div
                key={album.id}
                onClick={() => navigate({ type: 'album', id: album.id })}
                className="group p-3 rounded-2xl glass-card glass-card-hover transition cursor-pointer flex flex-col"
              >
                <div className="relative aspect-square rounded-xl overflow-hidden bg-zinc-950 mb-3 shadow-md border border-white/5">
                  <img
                    src={album.artworkUrl || '/icon.svg'}
                    alt={album.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/icon.svg';
                    }}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (album.tracks && album.tracks.length > 0) {
                        playTrack(album.tracks[0], album.tracks);
                      }
                    }}
                    className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xl opacity-0 group-hover:opacity-100 hover:scale-105 transition"
                    title={`Play ${album.title}`}
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </button>
                </div>
                <p className="text-xs font-semibold text-zinc-100 truncate group-hover:text-blue-400 transition-colors">
                  {album.title}
                </p>
                <p className="text-[11px] text-zinc-400 truncate mt-0.5">{album.artist}</p>
                <span className="text-[10px] text-zinc-500 mt-1 font-mono">
                  {album.trackCount} track{album.trackCount === 1 ? '' : 's'}
                  {album.year ? ` • ${album.year}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Featured All Tracks Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">Songs in Vault</h2>
            <p className="text-xs text-zinc-400">{displayTracks.length} tracks indexed</p>
          </div>
          {displayTracks.length > 10 && (
            <button
              onClick={() => navigate({ type: 'library' })}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 transition"
            >
              <span>View full library</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="divide-y divide-white/5 rounded-2xl glass-card p-1">
          {displayTracks.slice(0, 10).map((track, idx) => (
            <TrackRow
              key={`home-track-${track.id}`}
              track={track}
              index={idx}
              tracksContext={displayTracks}
            />
          ))}
        </div>
      </section>

      {/* Artists Shelf */}
      {displayArtists.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white tracking-tight">Artists</h2>
            {displayArtists.length > 4 && (
              <button
                onClick={() => navigate({ type: 'artists' })}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 transition"
              >
                <span>See all</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
            {displayArtists.slice(0, 5).map((artist) => (
              <div
                key={artist.id}
                onClick={() => navigate({ type: 'artist', id: artist.id })}
                className="group p-3.5 rounded-2xl glass-card glass-card-hover transition cursor-pointer flex flex-col items-center text-center"
              >
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-zinc-950 mb-3 shadow-lg border border-white/10">
                  <img
                    src={artist.artworkUrl || '/icon.svg'}
                    alt={artist.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/icon.svg';
                    }}
                  />
                </div>
                <p className="text-xs font-semibold text-zinc-100 truncate w-full group-hover:text-blue-400 transition-colors">
                  {artist.name}
                </p>
                <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
                  {artist.trackCount} song{artist.trackCount === 1 ? '' : 's'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
