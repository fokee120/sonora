import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Play, UserRound, RefreshCw, WifiOff } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { Artwork } from '../components/common/Artwork.js';
import { AlbumCards } from '../components/common/CatalogCards.js';
import { getCatalogPage, resolveArtist, pageTracks, type CatalogPage, type CatalogAlbum } from '../lib/ytmusic/catalog.js';
export const ArtistDetailView:React.FC<{artistId:string}>=({artistId})=>{
 const {route,displayTracks,displayArtists,displayAlbums,navigate,isOnline}=useApp(),{playTrack}=usePlayer();
 const local=displayArtists.find(a=>a.id===artistId);
 const hint=route.type==='artist'&&route.name?route.name:artistId.startsWith('name:')?decodeURIComponent(artistId.slice(5)):local?.name||'';
 const [page,setPage]=useState<CatalogPage|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[moreBusy,setMoreBusy]=useState(false);
 useEffect(()=>{const controller=new AbortController();setPage(null);setLoading(true);setError('');void(async()=>{try{const id=artistId.startsWith('catalog:')?artistId.slice(8):await resolveArtist(hint,controller.signal);const result=await getCatalogPage(id,controller.signal);if(!controller.signal.aborted)setPage(result);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Couldn’t load this artist.');}finally{if(!controller.signal.aborted)setLoading(false);}})();return()=>controller.abort();},[artistId,hint,isOnline,retry]);
 const name=page?.title||hint||local?.name||'Artist';
 const songs=useMemo(()=>{const list=[...(page?pageTracks(page):[]),...displayTracks.filter(t=>t.artist.toLowerCase()===name.toLowerCase())];return [...new Map(list.map(t=>[t.id,t])).values()];},[page,displayTracks,name]);
 const albums:CatalogAlbum[]=page?.albums||displayAlbums.filter(a=>a.artist.toLowerCase()===name.toLowerCase()).map(a=>({browseId:a.id,title:a.title,artist:a.artist,year:a.year,artworkUrl:a.artworkUrl}));
 return <div id="artist-detail-view" className="page-stack"><button className="text-button self-start" onClick={()=>navigate({type:'search'})}><ArrowLeft size={17}/>Back to Search</button>
 <header className="artist-profile"><div className="artist-profile-art">{page?.artworkUrl||local?.artworkUrl?<Artwork track={{id:artistId,artworkUrl:page?.artworkUrl||local?.artworkUrl}} alt={name}/>:<UserRound size={52}/>}</div><div><p className="eyebrow">ARTIST</p><h1>{name}</h1>{page?.description&&<p className="artist-description">{page.description}</p>}<button className="primary-button" disabled={!songs.length} onClick={()=>playTrack(songs[0],songs)}><Play size={17} fill="currentColor"/>Play songs</button></div></header>
 {(page?.offline||!isOnline)&&<p className="inline-message"><WifiOff size={16}/>Saved artist page. Downloaded and cached songs are available offline.</p>}
 {error&&<div role="alert" className="error-card"><p>{error}</p><button className="action-button" onClick={()=>setRetry(n=>n+1)}><RefreshCw size={16}/>Try again</button></div>}
 {loading&&<div role="status" aria-label="Loading artist" className="skeleton-rows"><i/><i/><i/></div>}
 {albums.length>0&&<section className="section-stack"><div className="section-heading"><h2>Albums & releases</h2><span className="collection-count">{albums.length} releases</span></div><AlbumCards albums={albums}/></section>}
 {songs.length>0&&<section className="section-stack"><div className="section-heading"><h2>Songs</h2></div><div className="song-list">{songs.map((track,index)=><TrackRow key={track.id} track={track} index={index} tracksContext={songs}/>)}</div></section>}
 {!loading&&!error&&!albums.length&&!songs.length&&<div className="empty-state"><h2>More music is on the way.</h2><p>No releases are available for this artist right now.</p></div>}
 {page?.continuation&&<button className="action-button self-start" disabled={moreBusy||!isOnline} onClick={async()=>{setMoreBusy(true);try{const next=await getCatalogPage(page.browseId,undefined,page.continuation);setPage(previous=>previous?{...previous,songs:[...previous.songs,...next.songs],albums:[...new Map([...previous.albums,...next.albums].map(a=>[a.browseId,a])).values()],continuation:next.continuation}:next);}catch{setError('Couldn’t load more releases. Try again.');}finally{setMoreBusy(false);}}}>{moreBusy?'Loading…':'Load more'}</button>}
 </div>;
};
