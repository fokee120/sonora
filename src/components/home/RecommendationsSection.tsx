import React, {useEffect, useMemo, useState} from 'react';
import {Sparkles, RefreshCw, Play} from 'lucide-react';
import {useApp} from '../../context/AppContext.js';
import {usePlayer} from '../../hooks/usePlayer.js';
import {TrackRow} from '../common/TrackRow.js';
import {dbService} from '../../lib/db.js';
import {buildTaste, type TasteSignal} from '../../lib/taste.js';
import {recommendFromLibrary, suggestedQueries} from '../../lib/recommendations.js';
import {fetchYoutubeRadio, searchYoutubeMusic, youtubeVideoId} from '../../lib/ytmusic/youtubeMusic.js';
import {audioCache} from '../../lib/offline/AudioCache.js';
import {defaultPreferences, type AccountPreferences} from '../../lib/accounts.js';
import type {Track} from '../../types/index.js';
export const songIdentity=(track:Track)=>[track.artist,track.title].map(value=>value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()).join('|');

export const RecommendationsSection:React.FC=()=>{
 const {tracks,favorites,history,playlists,isOnline,isDownloaded,navigate}=useApp();
 const {playTrack}=usePlayer();
 const [catalog,setCatalog]=useState<Track[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(false),[radio,setRadio]=useState(false),[refresh,setRefresh]=useState(0);
 const [prefs,setPrefs]=useState<AccountPreferences>(defaultPreferences());
 useEffect(()=>{let active=true;const update=()=>void dbService.getSetting<AccountPreferences|null>('sonora:account:preferences',null).then(saved=>{if(active&&saved)setPrefs(saved);});update();window.addEventListener('sonora:preferences-changed',update);return()=>{active=false;window.removeEventListener('sonora:preferences-changed',update);};},[]);
 const byId=useMemo(()=>{const map=new Map(tracks.map(t=>[t.id,t]));for(const entry of history)if(entry.track&&!map.has(entry.trackId))map.set(entry.trackId,entry.track);return map;},[tracks,history]);
 const saved=useMemo(()=>{
  const ids=new Set(playlists.flatMap(p=>p.trackIds));return {ids,identities:new Set(tracks.filter(t=>ids.has(t.id)).map(songIdentity))};
 },[playlists,tracks]);
 const profile=useMemo(()=>{
  const signals:TasteSignal[]=[];
  for(const h of history){const t=byId.get(h.trackId);if(t)signals.push({artist:t.artist,genre:t.genre,source:'play',playedAt:h.playedAt});}
  for(const id of favorites){const t=byId.get(id);if(t)signals.push({artist:t.artist,genre:t.genre,source:'favorite'});}
  for(const id of saved.ids){const t=byId.get(id);if(t)signals.push({artist:t.artist,genre:t.genre,source:'playlist'});}
  return buildTaste(signals,prefs);
 },[byId,history,favorites,saved,prefs]);
 const seeds=useMemo(()=>{
  const ids=[...history.map(h=>h.trackId),...favorites,...saved.ids];const seen=new Set<string>(),pool:Track[]=[];
  for(const id of ids){const t=byId.get(id);if(t&&/^[\w-]{11}$/.test(youtubeVideoId(t))&&!seen.has(t.id)){seen.add(t.id);pool.push(t);}}
  const rotated=[...pool.slice(refresh%Math.max(1,pool.length)),...pool.slice(0,refresh%Math.max(1,pool.length))];
  const artists=new Set<string>();return rotated.filter(t=>{const key=t.artist.toLowerCase();if(artists.has(key))return false;artists.add(key);return true;}).slice(0,3);
 },[byId,history,favorites,saved,refresh]);
 const seedKey=seeds.map(t=>youtubeVideoId(t)).join(',');
 const queries=suggestedQueries(profile,2),queryKey=queries.join('|');
 useEffect(()=>{
  if(!isOnline){setLoading(false);return;}
  if(!seedKey&&!queryKey)return;
  const controller=new AbortController();setLoading(true);setError(false);
  void(async()=>{
   const results=await Promise.allSettled(seedKey.split(',').filter(Boolean).map(id=>fetchYoutubeRadio(id,controller.signal)));
   let lists=results.flatMap(result=>result.status==='fulfilled'&&result.value.length?[result.value]:[]);
   const isRadio=lists.length>0;
   if(!lists.length&&queryKey){const fallback=await Promise.allSettled(queryKey.split('|').map(query=>searchYoutubeMusic(query,'songs',controller.signal)));lists=fallback.flatMap(r=>r.status==='fulfilled'&&r.value.length?[r.value]:[]);}
   // Interleave seed radios instead of letting one artist dominate the entire page.
   const merged:Track[]=[];for(let i=0;i<50;i++)for(const list of lists)if(list[i])merged.push(list[i]);
   if(!controller.signal.aborted){setCatalog(merged);setRadio(isRadio);setError(!merged.length);setLoading(false);}
  })().catch(()=>{if(!controller.signal.aborted){setError(true);setLoading(false);}});
  return()=>controller.abort();
 },[seedKey,queryKey,isOnline,refresh]);
 const mixed=useMemo(()=>{
  const isSaved=(t:Track)=>saved.ids.has(t.id)||saved.identities.has(songIdentity(t));
  const local=recommendFromLibrary(tracks.filter(t=>!isSaved(t)),profile,{playedTrackIds:new Set(history.map(h=>h.trackId)),favoriteTrackIds:favorites,limit:tracks.length}).map(r=>r.track);
  const radioOffset=refresh*11%Math.max(1,catalog.length),radioMix=[...catalog.slice(radioOffset),...catalog.slice(0,radioOffset)];
  const candidates:Track[]=[];const offset=refresh%Math.max(1,local.length);const localMix=[...local.slice(offset),...local.slice(0,offset)];
  for(let i=0;i<Math.max(catalog.length,localMix.length);i++){if(radioMix[i])candidates.push(radioMix[i]);if(i%3===0&&localMix[Math.floor(i/3)])candidates.push(localMix[Math.floor(i/3)]);}
  candidates.push(...localMix);
  const seen=new Set<string>(),artists=new Map<string,number>();const out:Track[]=[];
  for(const t of candidates){const key=songIdentity(t),artist=t.artist.toLowerCase();if(isSaved(t)||seen.has(key)||(artists.get(artist)||0)>=3)continue;seen.add(key);artists.set(artist,(artists.get(artist)||0)+1);out.push(t);if(out.length===16)break;}
  return out;
 },[catalog,tracks,profile,history,favorites,saved,refresh]);
 useEffect(()=>{audioCache.enqueue(mixed,1);},[mixed]);
 return <section className="section-stack home-discovery" aria-label="Music recommendations">
  <div className="section-heading"><div><p className="eyebrow">YOUR NEXT FAVORITES</p><h2>Recommended for you</h2></div><div className="discovery-actions"><button className="player-icon" aria-label="Refresh recommendations" title="Refresh recommendations" disabled={loading||!isOnline} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={18} className={loading?'animate-spin':''}/></button>{mixed.length>0&&<button className="text-button" disabled={!mixed.some(t=>isOnline||isDownloaded(t.id))} onClick={()=>{const ready=mixed.filter(t=>isOnline||isDownloaded(t.id));if(ready.length)void playTrack(ready[0],ready);}}><Play size={14} fill="currentColor"/>Play all</button>}</div></div>
  <p className="discovery-caption">{radio?'YouTube Music radio, inspired by your listening.':!isOnline?'Discoveries based on your saved listening.':'A fresh mix of new finds and songs you might love.'}</p>
  {loading&&!mixed.length&&<div role="status" aria-label="Finding your next favorites" className="skeleton-rows"><i/><i/><i/></div>}
  {mixed.length>0&&<div className="song-list">{mixed.map((track,index)=><TrackRow key={track.id} track={track} index={index} tracksContext={mixed}/>)}</div>}
  {!loading&&!mixed.length&&<div className="taste-empty"><Sparkles size={20}/><p>{!isOnline?'Connect to find new music.':error?'Discovery couldn’t load right now. Try again in a moment.':'Listen to a few favorites and we’ll build your mix here.'}</p><button className="text-button" onClick={()=>error?setRefresh(n=>n+1):navigate({type:'search'})}>{error?'Try again':'Find music'}</button></div>}
 </section>;
};
