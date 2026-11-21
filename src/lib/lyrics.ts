import {useEffect,useState} from 'react';
import {dbService} from './db.js';
import type {Track} from '../types/index.js';
export type SongLyrics={plain:string;lines:{time:number;text:string}[]};
export function parseLyrics(text:string):SongLyrics{const lines:SongLyrics['lines']=[];for(const row of text.split(/\r?\n/)){const stamps=[...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)],words=row.replace(/\[[^\]]*\]/g,'').trim();for(const stamp of stamps)lines.push({time:Number(stamp[1])*60+Number(stamp[2]),text:words});}lines.sort((a,b)=>a.time-b.time);return {plain:lines.length?lines.map(l=>l.text).join('\n'):text,lines};}
const pending=new Map<string,Promise<SongLyrics|null>>();
export async function ensureSongLyrics(track:Track):Promise<SongLyrics|null>{
 const key='lyrics:v1:'+track.id;
 if(track.lyrics?.trim()){const value=parseLyrics(track.lyrics);await dbService.setSetting(key,{value,at:Date.now(),providers:2});return value;}
 const saved=await dbService.getSetting<{value:SongLyrics|null;at:number;providers?:number}|null>(key,null);
 // Successful lyrics are durable offline song data, never blocked by network freshness.
 if(saved?.value)return saved.value;
 if(saved?.providers===2&&Date.now()-saved.at<86400000)return null;
 if(!navigator.onLine)return null;
 let task=pending.get(track.id);if(!task){task=(async()=>{
  const query=new URLSearchParams({title:track.title,artist:track.artist,album:track.album||'',duration:String(track.duration||0)});
  const response=await fetch('/api/lyrics?'+query,{signal:AbortSignal.timeout(8500),cache:'no-store'});
  if(!response.ok&&response.status!==404)throw Error('Lyrics unavailable');
  const data=response.status===404?null:await response.json(),value=data?.text?.trim()?parseLyrics(data.text):null;
  await dbService.setSetting(key,{value,at:Date.now()});return value;
 })().finally(()=>pending.delete(track.id));pending.set(track.id,task);}return task;
}
export function useSongLyrics(track:Track|null,enabled:boolean){const [state,setState]=useState<{id:string;value:SongLyrics|null}|null>(null);
 useEffect(()=>{if(!track||!enabled)return;let active=true;void ensureSongLyrics(track).then(value=>{if(active)setState({id:track.id,value});}).catch(()=>{});return()=>{active=false;};},[track?.id,track?.lyrics,enabled]);
 return state?.id===track?.id?state?.value??null:null;
}
