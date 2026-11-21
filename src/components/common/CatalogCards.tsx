import React from 'react';
import { Check, UserRound, Disc3 } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { Artwork } from './Artwork.js';
import type { CatalogArtist, CatalogAlbum } from '../../lib/ytmusic/catalog.js';
export function ArtistCards({artists,onSelect}:{artists:CatalogArtist[];onSelect?:()=>void}){
 const {navigate}=useApp();
 return <div className="catalog-grid artist-grid">{artists.map(artist=><button key={artist.browseId} className="catalog-card" onClick={()=>{onSelect?.();navigate({type:'artist',id:'catalog:'+artist.browseId,name:artist.name});}}><span className="catalog-cover artist-cover">{artist.artworkUrl?<Artwork track={{id:'artist:'+artist.browseId,artworkUrl:artist.artworkUrl}} alt=""/>:<UserRound size={40}/>}</span><strong>{artist.name}</strong><small>Artist</small></button>)}</div>;
}
export function AlbumCards({ albums, fromLibrary = false, onSelect, selection }: {
  albums: CatalogAlbum[];
  fromLibrary?: boolean;
  onSelect?: () => void;
  selection?: { ids: ReadonlySet<string>; toggle: (id: string) => void };
}) {
  const { navigate } = useApp();
  return <div className="catalog-grid">{albums.map(album => {
    const id = !fromLibrary && album.browseId.startsWith('MPRE') ? 'catalog:' + album.browseId : album.browseId;
    const selected = selection?.ids.has(id);
    return <button key={id} className="catalog-card" data-library-selection-id={fromLibrary ? id : undefined}
      aria-pressed={selected} onClick={() => {
      if (selection) { selection.toggle(id); return; }
      onSelect?.();
      navigate({ type: 'album', id, artistId: album.artistId, title: album.title, artist: album.artist, fromLibrary });
    }}>
      <span className="catalog-cover">{album.artworkUrl
        ? <Artwork track={{ id: 'album:' + id, artworkUrl: album.artworkUrl }} alt="" />
        : <Disc3 size={40} />}
        {selection && <span className="library-selection-check" data-selected={selected} aria-hidden="true">{selected && <Check size={15} />}</span>}
      </span>
      <strong>{album.title}</strong>
      <small>{[album.year, album.kind || 'Album', album.artist].filter(Boolean).join(' · ')}</small>
    </button>;
  })}</div>;
}
