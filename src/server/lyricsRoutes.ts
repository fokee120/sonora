import express from 'express';
import {TransferSlots} from './ytmusic/transferSlots.js';
const router=express.Router(),slots=new TransferSlots(6,64);
const pending=new Map<string,Promise<any>>(),cache=new Map<string,{at:number;value:any}>();
const fold=(s:string)=>s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
router.get('/api/lyrics',async(req,res)=>{
 const title=String(req.query.title||'').slice(0,300),artist=String(req.query.artist||'').slice(0,300),album=String(req.query.album||'').slice(0,300),duration=Number(req.query.duration)||0;
 if(!title||!artist)return res.status(400).json({error:'Missing song details'});
 const key=JSON.stringify([title,artist,album,Math.round(duration)]),saved=cache.get(key);res.setHeader('Cache-Control','no-store');
 if(saved&&Date.now()-saved.at<3600000)return res.status(saved.value?200:404).json(saved.value||{missing:true});
 let task=pending.get(key);
 if(!task){task=(async()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);let release:(()=>void)|undefined;
  try{release=await slots.acquire(controller.signal);
   const query=new URLSearchParams({track_name:title,artist_name:artist});if(album)query.set('album_name',album);if(duration>0&&duration<3600)query.set('duration',String(Math.round(duration)));
   let failures=0,instrumental=false;
   const primarySignal=AbortSignal.any([controller.signal,AbortSignal.timeout(2500)]);
   // Start the fallback concurrently so a primary miss never adds another timeout.
   const fallback=(async()=>{try{const r=await fetch('https://api.lyrics.ovh/v1/'+encodeURIComponent(artist)+'/'+encodeURIComponent(title),{signal:controller.signal});if(r.status===404)return null;if(!r.ok)throw Error('Fallback unavailable');const data=await r.json();return typeof data.lyrics==='string'&&data.lyrics.trim()?{text:data.lyrics.trim(),source:'lyrics.ovh'}:null;}catch{failures++;return null;}})();
   const read=async(url:string,search=false)=>{try{const r=await fetch(url,{signal:primarySignal,headers:{'User-Agent':'Sonora/1.0 (personal music player)'}});if(r.status===404)return null;if(!r.ok)throw Error('Lyrics provider unavailable');let value=await r.json();if(search)value=value.filter((row:any)=>fold(row.trackName||'')===fold(title)&&fold(row.artistName||'')===fold(artist)&&(!duration||Math.abs(row.duration-duration)<8)).sort((a:any,b:any)=>Number(!!b.syncedLyrics)-Number(!!a.syncedLyrics))[0];if(value?.instrumental){instrumental=true;return null;}const text=value?.syncedLyrics||value?.plainLyrics;return typeof text==='string'&&text.trim()?{text,source:'lrclib'}:null;}catch{failures++;return null;}};
   // A failed exact match must never delay the search request behind it.
   const requests=[read('https://lrclib.net/api/get?'+query),read('https://lrclib.net/api/search?'+new URLSearchParams({track_name:title,artist_name:artist}),true)];
   const primary=await new Promise<any>(resolve=>{let remaining=requests.length;for(const request of requests)void request.then(value=>{if(value)resolve(value);else if(!--remaining)resolve(null);});});
   const result=primary||(instrumental?null:await fallback);
   if(!result&&failures&&!instrumental)throw Error('Lyrics provider unavailable');
   cache.set(key,{at:Date.now(),value:result});if(cache.size>1000)cache.delete(cache.keys().next().value!);return result;
  }finally{clearTimeout(timer);controller.abort();release?.();}
 })().finally(()=>pending.delete(key));pending.set(key,task);}
 try{const value=await task;res.status(value?200:404).json(value||{missing:true});}catch{res.status(503).json({error:'Lyrics temporarily unavailable'});}
});
export default router;
