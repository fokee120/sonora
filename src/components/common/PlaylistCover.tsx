import React from 'react';
import { ListMusic } from 'lucide-react';
import { Artwork } from './Artwork.js';
import type { Playlist, Track } from '../../types/index.js';
export function PlaylistCover({ playlist, tracks, className = '' }: { playlist: Playlist; tracks: Track[]; className?: string }) {
  const covers = playlist.trackIds.map(id => tracks.find(t => t.id === id)).filter((t): t is Track => !!t?.artworkUrl).slice(0, 4);
  return <span className={'playlist-cover ' + (covers.length >= 4 && !playlist.artworkUrl ? 'cover-mosaic ' : '') + className}>
    {playlist.artworkUrl ? <img src={playlist.artworkUrl} alt="" loading="lazy" /> : covers.length ? (covers.length >= 4 ? covers : covers.slice(0, 1)).map(t => <span key={t.id} className="cover-cell"><Artwork track={t} /></span>) : <><ListMusic size={36} /><span className="cover-monogram" aria-hidden="true">{playlist.title.slice(0, 1).toUpperCase()}</span></>}
  </span>;
}
