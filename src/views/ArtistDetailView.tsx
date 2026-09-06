import React from 'react';
import { ArrowLeft, Play, Disc3, Music } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';

interface ArtistDetailViewProps {
  artistId: string;
}

export const ArtistDetailView: React.FC<ArtistDetailViewProps> = ({ artistId }) => {
  const { displayArtists, displayTracks, displayAlbums, navigate } = useApp();
  const { playTrack, setQueue } = usePlayer();

  const artist = displayArtists.find((a) => a.id === artistId);

  if (!artist) {
    return (
      <div className="py-20 text-center text-zinc-500 text-sm">
        <p>Artist not found.</p>
        <button
          onClick={() => navigate({ type: 'library' })}
          className="mt-3 px-4 py-1.5 rounded-xl bg-zinc-800 text-xs text-zinc-300 hover:text-white"
        >
          Back to Library
        </button>
      </div>
    );
  }

  const artistTracks = displayTracks.filter(
    (t) => t.artist.toLowerCase() === artist.name.toLowerCase()
  );

  const artistAlbums = displayAlbums.filter(
    (a) => a.artist.toLowerCase() === artist.name.toLowerCase()
  );

  const handlePlayArtist = () => {
    if (artistTracks.length === 0) return;
    setQueue(artistTracks, artistTracks[0]);
    playTrack(artistTracks[0], artistTracks);
  };

  return (
    <div id="artist-detail-view" className="space-y-8 pb-12">
      {/* Back button */}
      <button
        onClick={() => navigate({ type: 'library' })}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Library</span>
      </button>

      {/* Artist Hero Header */}
      <div className="flex flex-col sm:flex-row items-center gap-6 p-6 rounded-3xl bg-zinc-900/50 border border-zinc-800/80 shadow-xl">
        <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full overflow-hidden bg-zinc-950 shadow-2xl border-2 border-zinc-700 shrink-0">
          <img
            src={artist.artworkUrl || '/icon.svg'}
            alt={artist.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/icon.svg';
            }}
          />
        </div>

        <div className="flex-1 min-w-0 text-center sm:text-left space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-indigo-400">
            Artist
          </span>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white truncate">
            {artist.name}
          </h1>
          <p className="text-xs text-zinc-400">
            {artistTracks.length} tracks • {artistAlbums.length} albums in your vault
          </p>

          <div className="pt-2">
            <button
              onClick={handlePlayArtist}
              disabled={artistTracks.length === 0}
              className="px-5 py-2.5 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 font-semibold text-xs flex items-center gap-2 transition shadow-lg disabled:opacity-40"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>Play All</span>
            </button>
          </div>
        </div>
      </div>

      {/* Discography / Albums by Artist */}
      {artistAlbums.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <Disc3 className="w-4 h-4 text-indigo-400" />
            <span>Albums</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {artistAlbums.map((album) => (
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
                <span className="text-[10px] text-zinc-500 mt-1 font-mono">
                  {album.trackCount} tracks {album.year ? `• ${album.year}` : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Songs by Artist */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <Music className="w-4 h-4 text-indigo-400" />
          <span>Songs</span>
        </h2>
        <div className="divide-y divide-zinc-900/60 rounded-2xl bg-zinc-900/20 border border-zinc-800/50 p-1">
          {artistTracks.map((track, idx) => (
            <TrackRow
              key={track.id}
              track={track}
              index={idx}
              tracksContext={artistTracks}
              showAlbum={true}
            />
          ))}
        </div>
      </section>
    </div>
  );
};
