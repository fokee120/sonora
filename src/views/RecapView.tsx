import {useWeeklyArchive} from '../lib/weeklyArchive.js';
import {RecapPeriod} from '../components/player/RecapPeriod.js';
import React, {useEffect, useMemo, useState} from 'react';
import {ChevronLeft, ChevronRight, ChartNoAxesCombined, Music2, Mic2, Disc3, History} from 'lucide-react';
import {useApp} from '../context/AppContext.js';
import {usePlayer} from '../hooks/usePlayer.js';
import {dbService} from '../lib/db.js';
import {dayLabel, numericDate, periodBounds, rankPlays, type PlayEntry} from '../lib/recap.js';
import {artistRoute} from '../lib/ytmusic/catalog.js';
import {RecapArtistArtwork} from '../components/common/RecapArtistArtwork.js';
import {Artwork} from '../components/common/Artwork.js';

export function RecapView({shared}:{shared?:{name:string;entries:PlayEntry[];showRecap:boolean;showHistory:boolean;profileId?:string}}={}){
  const {tracks:localTracks, navigate, isOnline, isDownloaded}=useApp();
  const tracks=shared?shared.entries.map(e=>e.track).filter((t):t is NonNullable<typeof t>=>!!t):localTracks;
  const {playTrack}=usePlayer();
  const [entries,setEntries]=useState<PlayEntry[]>([]);
  const [now,setNow]=useState(Date.now());
  const [archiveOpen,setArchiveOpen]=useState(false),[archiveIndex,setArchiveIndex]=useState(0);
  const weeks=useWeeklyArchive(entries,now,shared?.profileId);
  const weekend=[6,0].includes(new Date(now).getDay());
  const featured=weeks[0]&&now-weeks[0].release<2*86400000?weeks[0]:null;
  const [limit,setLimit]=useState(100);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(false);
  useEffect(()=>{
    if(shared){setEntries(shared.entries);setLoading(false);return;}
    let active=true;
    const load=()=>{setError(false);void dbService.getPlayHistory(Infinity).then(plays=>{if(active){setEntries(plays);setLoading(false);}}).catch(()=>{if(active){setError(true);setLoading(false);}});};
    load(); window.addEventListener('sonora:history-changed',load);
    window.addEventListener('sonora:recap-retry',load);

    return ()=>{active=false;window.removeEventListener('sonora:history-changed',load);window.removeEventListener('sonora:recap-retry',load);};
  },[shared]);
  useEffect(()=>{const refresh=()=>setNow(Date.now());const timer=setInterval(refresh,60000);for(const event of ['focus','sonora:open-weekly-recap'])window.addEventListener(event,refresh);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);for(const event of ['focus','sonora:open-weekly-recap'])window.removeEventListener(event,refresh);document.removeEventListener('visibilitychange',refresh);};},[]);
  const byId=useMemo(()=>new Map(tracks.map(t=>[t.id,t])),[tracks]);
  const groups=useMemo(()=>{
    const days=new Map<string,PlayEntry[]>();
    for(const entry of entries.slice(0,limit)){const date=new Date(entry.playedAt);const key=[date.getFullYear(),date.getMonth(),date.getDate()].join('-');const group=days.get(key)||[];group.push(entry);days.set(key,group);}
    return [...days.values()];
  },[entries,limit]);
  return <div id="recap-view" className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">{shared?shared.name+'’S LISTENING DIARY':'YOUR LISTENING DIARY'}</p><h1>On repeat.</h1><p className="recap-subtitle">The sounds that stayed with you.</p></div><ChartNoAxesCombined size={28}/></header>
    {loading?<div className="skeleton-rows" role="status" aria-label="Loading recap"><i/><i/><i/></div>:error?<div className="error-card" role="alert"><p>Your listening history couldn’t load.</p><button className="action-button" onClick={()=>window.dispatchEvent(new Event('sonora:recap-retry'))}>Try again</button></div>:<>
      {(!shared||shared.showRecap)&&<div className="recap-editions">{weekend&&featured&&<RecapPeriod mode="weekly" entries={featured.entries} tracks={featured.entries.flatMap(e=>e.track?[e.track]:[])} now={now} snapshot={featured}/>}<RecapPeriod mode="daily" entries={entries} tracks={tracks} now={now}/><button className="weekly-archive-button" onClick={()=>setArchiveOpen(v=>!v)} aria-expanded={archiveOpen}><History size={17}/>Previous weekly recaps<span>{weeks.length}</span></button>{archiveOpen&&<section className="weekly-archive"><h2>Weekly archive</h2>{weeks.length?<><select aria-label="Choose weekly recap" value={archiveIndex} onChange={e=>setArchiveIndex(Number(e.target.value))}>{weeks.map((w,i)=><option key={w.release} value={i}>{numericDate(w.start)} – {numericDate(w.end-1)}</option>)}</select>{weeks[archiveIndex]&&<RecapPeriod mode="weekly" entries={weeks[archiveIndex].entries} tracks={weeks[archiveIndex].entries.flatMap(e=>e.track?[e.track]:[])} now={now} snapshot={weeks[archiveIndex]}/>}</>:<p>Your first weekly recap arrives on Saturday.</p>}</section>}</div>}{(!shared||shared.showHistory)&&<section className="section-stack recap-history"><div className="section-heading"><div><p className="eyebrow">EVERY LISTEN</p><h2><History size={20}/>Full history</h2></div><span className="recap-subtitle">Newest first</span></div>
      {!entries.length?<div className="empty-state"><Music2 size={30}/><h2>Your story starts with a song.</h2><p>Play something and your daily and weekly recap will grow here.</p><button className="action-button" onClick={()=>navigate({type:'search'})}>Find music</button></div>:groups.map(group=><div className="recap-day" key={group[0].id}><h3>{dayLabel(group[0].playedAt,now)}<span>{group.length} {group.length===1?'play':'plays'}{entries.length>limit&&group===groups[groups.length-1]?' shown':''}</span></h3>{group.map(entry=>{const track=byId.get(entry.trackId)||entry.track;return <button className="recap-history-row" key={entry.id} disabled={!track||!isOnline&&!isDownloaded(track.id)} onClick={()=>track&&playTrack(track)}>{track?<Artwork track={track}/>:<Music2 size={22}/>}<span><strong>{track?.title||'Unavailable song'}</strong><small>{track?.artist||'Song information is no longer on this device'}</small></span><time dateTime={new Date(entry.playedAt).toISOString()}>{new Date(entry.playedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</time></button>;})}</div>)}
      {entries.length>limit&&<button className="action-button recap-more" onClick={()=>setLimit(n=>n+100)}>Show more history</button>}
      <p className="recap-footnote">A play is counted when a song starts. {shared?'Shared by '+shared.name+'.':'Recap uses listening history saved on this device.'}</p></section>}
    </>}
  </div>;
}
