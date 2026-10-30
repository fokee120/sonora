import React,{useEffect,useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,Music2,Mic2,Disc3,CalendarDays,CalendarCheck} from 'lucide-react';
import {periodBounds,dayLabel,numericDate,rankPlays,type PlayEntry,type WeeklySnapshot} from '../../lib/recap.js';
import type {Track} from '../../types/index.js';
import {Artwork} from '../common/Artwork.js';
import {RecapArtistArtwork} from '../common/RecapArtistArtwork.js';
import {useApp} from '../../context/AppContext.js';
import {usePlayer} from '../../hooks/usePlayer.js';
import {artistRoute} from '../../lib/ytmusic/catalog.js';
export function RecapPeriod({mode,entries,tracks,now,snapshot}:{snapshot?:WeeklySnapshot;mode:'daily'|'weekly';entries:PlayEntry[];tracks:Track[];now:number}){
 const [offset,setOffset]=useState(mode==='weekly'?-1:0),{navigate,isOnline,isDownloaded}=useApp(),{playTrack}=usePlayer({progress:false});
 useEffect(()=>{if(mode!=='weekly')return;const reset=()=>setOffset(-1);window.addEventListener('sonora:open-weekly-recap',reset);return()=>window.removeEventListener('sonora:open-weekly-recap',reset);},[mode]);
 const bounds=periodBounds(now,mode,offset),{start,end}=snapshot||bounds,weekly=mode==='weekly';
 const selected=useMemo(()=>snapshot?snapshot.entries:entries.filter(e=>e.playedAt>=start&&e.playedAt<end),[entries,start,end,snapshot]);
 const ranks=useMemo(()=>({song:rankPlays(selected,tracks,'song'),artist:rankPlays(selected,tracks,'artist'),genre:rankPlays(selected,tracks,'genre')}),[selected,tracks]);
 const first=ranks.song[0];
 return <section className={'recap-edition '+(weekly?'recap-edition-weekly':'recap-edition-daily')} aria-label={weekly?'Weekly recap':'Daily recap'}>
 <header className="recap-edition-heading"><div><p className="eyebrow">{weekly?'THE WEEK, WRAPPED':'ONE DAY. YOUR SOUND.'}</p><h2>{weekly?'Weekly recap':'Daily recap'}</h2></div>{weekly?<CalendarCheck size={24}/>:<CalendarDays size={24}/>}</header>
 <div className="recap-edition-date">{!weekly&&<button className="player-icon" aria-label={weekly?'Previous week':'Previous day'} onClick={()=>setOffset(o=>o-1)}><ChevronLeft size={20}/></button>}<strong aria-live="polite">{weekly?numericDate(start)+' – '+numericDate(end-1):dayLabel(start,now)}</strong>{!weekly&&<button className="player-icon" aria-label={weekly?'Next week':'Next day'} disabled={offset>=(weekly?-1:0)} onClick={()=>setOffset(o=>Math.min(weekly?-1:0,o+1))}><ChevronRight size={20}/></button>}</div>
 {weekly&&<p className="recap-edition-note">Frozen on Saturday · your week, saved</p>}
 {selected.length?<><div className="recap-spotlight">{first?.track&&<button disabled={!isOnline&&!isDownloaded(first.track.id)} className="recap-spotlight-cover" aria-label={'Play '+first.name} onClick={()=>void playTrack(first.track!)}><Artwork track={first.track}/></button>}<div><p className="eyebrow">MOST ON REPEAT</p><h3>{first?.name||'Your listening story'}</h3><p>{first?.track?.artist}</p><span>{first?.count||0} plays</span></div></div>
 <div className="recap-edition-totals"><div><strong>{selected.length.toLocaleString()}</strong><span>plays</span></div><div><strong>{new Set(selected.map(e=>e.trackId)).size}</strong><span>songs</span></div><div><strong>{new Set(selected.map(e=>(tracks.find(t=>t.id===e.trackId)||e.track)?.artist?.toLowerCase()).filter(Boolean)).size}</strong><span>artists</span></div></div>
 <div className="recap-edition-rankings">{(['song','artist','genre'] as const).map(kind=>{const Icon=kind==='song'?Music2:kind==='artist'?Mic2:Disc3;return <section className="recap-ranking" key={kind}><header><h3><Icon size={16}/>Top {kind==='song'?'songs':kind==='artist'?'artists':'genres'}</h3><span>03</span></header>{ranks[kind].length?ranks[kind].map((item,i)=><button className="recap-ranked-row" data-offline-unavailable={kind==='song'&&!isOnline&&!!item.track&&!isDownloaded(item.track.id)} key={item.name+i} disabled={kind==='genre'||kind==='song'&&(!item.track||!isOnline&&!isDownloaded(item.track.id))} onClick={()=>{if(kind==='song'&&item.track)void playTrack(item.track);if(kind==='artist'&&item.track)navigate(artistRoute(item.track));}}><span className="recap-rank">{String(i+1).padStart(2,'0')}</span>{item.track&&kind==='song'&&<Artwork track={item.track}/>} {item.track&&kind==='artist'&&<RecapArtistArtwork track={item.track}/>}<span className="recap-ranked-name"><strong>{item.name}</strong><small>{kind==='song'?item.track?.artist:item.unique.size+' tracks played'}</small></span><span className="recap-count"><strong>{item.count}</strong><small>plays</small></span></button>):<p className="taste-empty">Genre details aren’t available for these songs.</p>}</section>;})}</div></>:<div className="recap-edition-empty"><Music2 size={26}/><h3>{weekly?'No listening in this completed week.':'A fresh page in your diary.'}</h3><p>{weekly?'Your next weekly recap unlocks after Saturday ends.':'Play something you love. Your daily recap grows as you listen.'}</p></div>}
 </section>;
}
