import React, { useEffect, useState } from 'react';
import { ArrowLeft, Play, Shuffle, Download, CheckCircle2, Disc3, RefreshCw, WifiOff, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { Artwork } from '../components/common/Artwork.js';
import { notify } from '../components/common/ToastHost.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';
import { getCatalogPage, resolveAlbum, pageAlbum, artistRoute, type CatalogPage } from '../lib/ytmusic/catalog.js';
import type { Album } from '../types/index.js';
export const AlbumDetailView:React.FC<{albumId:string}>=({albumId})=>{
 const {route,displayAlbums,displayTracks,navigate,isOnline,downloadAlbum,removeAlbumDownload}=useApp(),{playTrack}=usePlayer();
 const local=displayAlbums.find(a=>a.id===albumId);
 let hint={title:local?.title||'',artist:local?.artist||''};if(albumId.startsWith('name:'))try{hint=JSON.parse(decodeURIComponent(albumId.slice(5)));}catch{}
 if(route.type==='album')hint={title:route.title||hint.title,artist:route.artist||hint.artist};
 const [page,setPage]=useState<CatalogPage|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[moreBusy,setMoreBusy]=useState(false),[,setRevision]=useState(0);
 useEffect(()=>offlineManager.subscribe(()=>setRevision(n=>n+1)),[]);
 useEffect(()=>{const controller=new AbortController();setPage(null);setError('');if(local&&!albumId.startsWith('catalog:')&&!albumId.startsWith('name:'))return;setLoading(true);void(async()=>{try{const id=albumId.startsWith('catalog:')?albumId.slice(8):await resolveAlbum(hint.title,hint.artist,controller.signal);const result=await getCatalogPage(id,controller.signal);if(!controller.signal.aborted)setPage(result);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Couldn’t load this album.');}finally{if(!controller.signal.aborted)setLoading(false);}})();return()=>controller.abort();},[albumId,isOnline,retry]);
 const fallbackTracks=displayTracks.filter(t=>t.album===hint.title&&t.artist===hint.artist);
 const album:Album=page?pageAlbum(page):local||{id:albumId,...hint,tracks:fallbackTracks,trackCount:fallbackTracks.length,duration:fallbackTracks.reduce((n,t)=>n+t.duration,0)};
 const tracks=album.tracks||[],artistId=page?.artistId||(route.type==='album'?route.artistId:undefined)||album.artistId;
 const downloading=tracks.filter(t=>offlineManager.isTrackDownloading(t.id)).length,downloaded=tracks.length>0&&tracks.every(t=>offlineManager.isTrackDownloaded(t.id));
 const back=()=>navigate(artistId?{type:'artist',id:'catalog:'+artistId,name:album.artist}:{type:'search'});
 const play=(shuffle=false)=>{const queue=[...tracks];if(!queue.length)return;if(shuffle)for(let i=queue.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[queue[i],queue[j]]=[queue[j],queue[i]];}playTrack(queue[0],queue);};
 return <div id="album-detail-view" className="page-stack"><button className="text-button self-start" onClick={back}><ArrowLeft size={17}/>{artistId?'Back to artist':'Back to Search'}</button>
 <header className="album-profile"><div className="album-profile-art">{album.artworkUrl?<Artwork track={{id:albumId,artworkUrl:album.artworkUrl}} alt={album.title}/>:<Disc3 size={52}/>}</div><div><p className="eyebrow">ALBUM{album.year?' / '+album.year:''}</p><h1>{album.title||'Album'}</h1>{album.artist&&<button className="album-artist-link" onClick={()=>navigate(artistRoute({artist:album.artist,artistId}))}>{album.artist} ↗</button>}<p className="collection-count">{tracks.length} songs{album.duration?' · '+Math.round(album.duration/60)+' min':''}</p><div className="album-actions"><button className="primary-button" disabled={!tracks.length} onClick={()=>play()}><Play size={17} fill="currentColor"/>Play</button><button className="action-button" disabled={!tracks.length} onClick={()=>play(true)}><Shuffle size={17}/>Shuffle</button><button className="player-icon outlined-icon" title={downloading?'Cancel album downloads':downloaded?'Remove album download':'Download album'} aria-label={downloading?'Cancel album downloads':downloaded?'Remove album download':'Download album'} disabled={!tracks.length||!isOnline&&!downloaded&&!downloading} onClick={async()=>{try{if(downloading){tracks.forEach(t=>{if(offlineManager.isTrackDownloading(t.id))offlineManager.cancelDownload(t.id);});notify('Album downloads cancelled');}else if(downloaded){await removeAlbumDownload(album);notify('Album download removed');}else{await downloadAlbum(album);notify('Album added to downloads');}}catch{notify('Couldn’t update album downloads.',true);}}}>{downloading?<Loader2 className="animate-spin" size={19}/>:downloaded?<CheckCircle2 size={19}/>:<Download size={19}/>}</button></div></div></header>
 {(page?.offline||!isOnline)&&<p className="inline-message"><WifiOff size={16}/>Saved album page. Downloaded and cached songs are available offline.</p>}
 {error&&<div role="alert" className="error-card"><p>{error}</p><button className="action-button" onClick={()=>setRetry(n=>n+1)}><RefreshCw size={16}/>Try again</button></div>}
 {loading&&<div role="status" aria-label="Loading album" className="skeleton-rows"><i/><i/><i/></div>}
 {tracks.length>0&&<section className="section-stack"><h2>Tracks</h2><div className="song-list">{tracks.map((track,index)=><TrackRow key={track.id} track={track} index={index} tracksContext={tracks} showAlbum={false}/>)}</div></section>}
 {page?.continuation&&<button className="action-button self-start" disabled={moreBusy||!isOnline} onClick={async()=>{setMoreBusy(true);try{const next=await getCatalogPage(page.browseId,undefined,page.continuation);setPage(previous=>previous?{...previous,songs:[...new Map([...previous.songs,...next.songs].map(s=>[s.videoId,s])).values()],continuation:next.continuation}:next);}catch{setError('Couldn’t load more songs. Try again.');}finally{setMoreBusy(false);}}}>{moreBusy?'Loading…':'Load more songs'}</button>}
 </div>;
};
