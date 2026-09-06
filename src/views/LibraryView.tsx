import React, { useState } from 'react';
import { Music, Disc3, User, ListMusic, Play, Shuffle, Plus, RefreshCw, HardDrive } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';

type TabType = 'songs' | 'albums' | 'artists' | 'playlists';

export const LibraryView: React.FC = () => {
  const {
    displayTracks,
    displayAlbums,
    displayArtists,
    displayPlaylists,
    navigate,
    openCreatePlaylist,
    isDriveConnected,
    scanGoogleDrive,
    isScanningDrive,
  } = useApp();
  const { playTrack, setQueue } = usePlayer();
  const [activeTab, setActiveTab] = useState<TabType>('songs');

  const handlePlayAllSongs = (shuffle = false) => {
    if (displayTracks.length === 0) return;
    setQueue(displayTracks, displayTracks[0]);
    playTrack(displayTracks[0], displayTracks);
  };

  return (
    <div id="library-view" className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Your Library</h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            {displayTracks.length} tracks • {displayAlbums.length} albums • {displayArtists.length} artists
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isDriveConnected && (
            <button
              onClick={() => scanGoogleDrive()}
              disabled={isScanningDrive}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 font-medium text-xs flex items-center gap-1.5 transition"
              title="Rescan Google Drive for new MP3 audio files"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isScanningDrive ? 'animate-spin' : ''}`} />
              <span>{isScanningDrive ? 'Scanning...' : 'Sync Drive'}</span>
            </button>
          )}

          {activeTab === 'playlists' && (
            <button
              onClick={() => openCreatePlaylist()}
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 transition shadow-lg shadow-indigo-900/30"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Playlist</span>
            </button>
          )}

          {activeTab === 'songs' && displayTracks.length > 0 && (
            <>
              <button
                onClick={() => handlePlayAllSongs(false)}
                className="px-3.5 py-1.5 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-xs flex items-center gap-1.5 transition"
              >
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                <span>Play All</span>
              </button>
              <button
                onClick={() => handlePlayAllSongs(true)}
                className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 font-medium text-xs flex items-center gap-1.5 transition"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>Shuffle</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
        {(
          [
            { id: 'songs', label: 'Songs', icon: Music, count: displayTracks.length },
            { id: 'albums', label: 'Albums', icon: Disc3, count: displayAlbums.length },
            { id: 'artists', label: 'Artists', icon: User, count: displayArtists.length },
            { id: 'playlists', label: 'Playlists', icon: ListMusic, count: displayPlaylists.length },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition ${
                isActive
                  ? 'bg-zinc-800 text-white shadow-xs font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              <span className="text-[10px] text-zinc-500 font-mono">({tab.count})</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'songs' && (
        <div className="divide-y divide-zinc-900/60 rounded-2xl bg-zinc-900/20 border border-zinc-800/50 p-1">
          {displayTracks.length === 0 ? (
            <div className="py-16 text-center text-zinc-500 text-xs">No songs in library.</div>
          ) : (
            displayTracks.map((track, idx) => (
              <TrackRow
                key={`lib-track-${track.id}`}
                track={track}
                index={idx}
                tracksContext={displayTracks}
              />
            ))
          )}
        </div>
      )}

      {activeTab === 'albums' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {displayAlbums.map((album) => (
            <div
              key={album.id}
              onClick={() => navigate({ type: 'album', id: album.id })}
              className="p-3 rounded-2xl bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800/60 hover:border-zinc-700 transition cursor-pointer flex flex-col"
            >
              <img
                src={album.artworkUrl || '/icon.svg'}
                alt={album.title}
                className="w-full aspect-square object-cover rounded-xl bg-zinc-950 mb-3 shadow-md"
              />
              <p className="text-xs font-semibold text-zinc-200 truncate">{album.title}</p>
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">{album.artist}</p>
              <span className="text-[10px] text-zinc-500 mt-1 font-mono">
                {album.trackCount} tracks
              </span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'artists' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
          {displayArtists.map((artist) => (
            <div
              key={artist.id}
              onClick={() => navigate({ type: 'artist', id: artist.id })}
              className="p-3 rounded-2xl bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800/60 hover:border-zinc-700 transition cursor-pointer flex flex-col items-center text-center"
            >
              <img
                src={artist.artworkUrl || '/icon.svg'}
                alt={artist.name}
                className="w-24 h-24 rounded-full object-cover bg-zinc-950 mb-3 border border-zinc-800"
              />
              <p className="text-xs font-semibold text-zinc-200 truncate w-full">{artist.name}</p>
              <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
                {artist.trackCount} tracks
              </p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'playlists' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {/* Create New Playlist Card */}
          <div
            onClick={() => openCreatePlaylist()}
            className="p-4 rounded-2xl bg-indigo-950/20 hover:bg-indigo-900/30 border border-indigo-800/40 hover:border-indigo-600/60 transition cursor-pointer flex flex-col items-center justify-center text-center group min-h-[160px]"
          >
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 group-hover:scale-110 transition-transform mb-3 shadow-lg shadow-indigo-950/50">
              <Plus className="w-6 h-6" />
            </div>
            <p className="text-xs font-bold text-white group-hover:text-indigo-200">Create Playlist</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">Build your custom mix</p>
          </div>

          {displayPlaylists.map((pl) => (
            <div
              key={pl.id}
              onClick={() => navigate({ type: 'playlist', id: pl.id })}
              className="p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800/60 hover:border-zinc-700 transition cursor-pointer flex flex-col"
            >
              <div className="w-full aspect-square rounded-xl bg-gradient-to-tr from-indigo-950 via-zinc-900 to-purple-950 flex items-center justify-center mb-3 text-indigo-400 border border-zinc-800">
                <ListMusic className="w-12 h-12 opacity-80" />
              </div>
              <p className="text-xs font-semibold text-zinc-200 truncate">{pl.title}</p>
              <span className="text-[10px] text-zinc-500 mt-1 font-mono">
                {pl.trackIds.length} tracks
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
