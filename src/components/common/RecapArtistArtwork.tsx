import React,{useEffect,useState} from 'react';
import {Mic2} from 'lucide-react';
import {Artwork} from '../common/Artwork.js';
import {getCatalogPage,resolveArtist} from '../../lib/ytmusic/catalog.js';
import type {Track} from '../../types/index.js';
export function RecapArtistArtwork({track}:{track:Track}){
 const [artist,setArtist]=useState<{id:string;url:string}|null>(null);
 useEffect(()=>{const controller=new AbortController();setArtist(null);void(async()=>{try{const id=track.artistId||await resolveArtist(track.artist,controller.signal);const page=await getCatalogPage(id,controller.signal);if(!controller.signal.aborted&&page.artworkUrl)setArtist({id,url:page.artworkUrl});}catch{}})();return()=>controller.abort();},[track.artistId,track.artist]);
 return artist?<Artwork track={{id:'artist:'+artist.id,artworkUrl:artist.url}} alt=""/>:<span className="recap-artist-placeholder" aria-hidden="true"><Mic2 size={18}/></span>;
}
