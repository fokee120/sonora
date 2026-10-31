import {importedTrackQuery} from '../../lib/playlistImport.js';
import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, Loader2, Sparkles, X, Check, Search } from 'lucide-react';
import { dbService } from '../../lib/db.js';
import { dismissMissing, manuallyMatchMissing, finalizeEstimatedMatches, retryImport, type ImportJob } from '../../lib/importJobs.js';
import { cachedSearchYoutubeMusic } from '../../lib/ytmusic/youtubeMusic.js';
import { playerEngine, type PreviewState } from '../../lib/audio/PlayerEngine.js';
import { useApp } from '../../context/AppContext.js';
import { Artwork } from '../common/Artwork.js';
import { notify } from '../common/ToastHost.js';
import type { ImportedTrack } from '../../lib/playlistImport.js';
import type { Track } from '../../types/index.js';
const entryKey = (entry: ImportedTrack) => `${entry.title}\u0000${entry.artist}\u0000${entry.album||''}`;
const duration = (seconds:number) => seconds>0?Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0'):'';
export function ImportProgressAuto({playlistId}:{playlistId:string}) {
 const {playlists,isOnline}=useApp();
 const [job,setJob]=useState<ImportJob>();
 const [results,setResults]=useState<Record<string,Track[]>>({});
 const [queries,setQueries]=useState<Record<string,string>>({});
 const [error,setError]=useState('');
 const [pending,setPending]=useState<Set<string>>(()=>new Set());
 const [estimating,setEstimating]=useState(false);
 const [preview,setPreview]=useState<PreviewState>(playerEngine.getPreviewState());
 const requested=useRef(new Set<string>()),ownedPreviews=useRef(new Set<string>()),cancelEstimate=useRef(false);
 const searchVersion=useRef(new Map<string,number>()),estimateController=useRef<AbortController|null>(null);
 const playlist=playlists.find(item=>item.id===playlistId);
 useEffect(()=>playerEngine.subscribePreview(setPreview),[]);
 useEffect(()=>{
  let active=true;const refresh=()=>void dbService.getSetting<ImportJob[]>('playlist_import_jobs',[]).then(jobs=>{if(active)setJob(jobs.find(item=>item.playlistId===playlistId));});
  refresh();window.addEventListener('sonora:imports-changed',refresh);
  return()=>{active=false;cancelEstimate.current=true;estimateController.current?.abort();window.removeEventListener('sonora:imports-changed',refresh);if(ownedPreviews.current.has(playerEngine.getPreviewState().id||''))void playerEngine.stopPreview();};
 },[playlistId]);
 const search=async(entry:ImportedTrack,query:string,signal?:AbortSignal)=>{
  const key=entryKey(entry),version=(searchVersion.current.get(key)||0)+1;searchVersion.current.set(key,version);
  try{const found=(await cachedSearchYoutubeMusic(query,'songs',signal)).slice(0,3);if(!signal?.aborted&&searchVersion.current.get(key)===version)setResults(current=>({...current,[key]:found}));return found;}
  catch(reason){if(!signal?.aborted)setError(reason instanceof Error?reason.message:'Search failed. Try again.');return[];}
 };
 useEffect(()=>{
  if(job?.status==='running'||!isOnline)return;
  const controller=new AbortController();const entries=(job?.missingEntries||[]).filter(entry=>!requested.current.has(entryKey(entry)));
  for(const entry of entries)requested.current.add(entryKey(entry));
  void(async()=>{for(const entry of entries){if(controller.signal.aborted)break;await search(entry,importedTrackQuery(entry),controller.signal);}})();
  return()=>{controller.abort();for(const entry of entries)requested.current.delete(entryKey(entry));};
 },[job?.missingEntries,job?.status,isOnline]);
 const choose=async(entry:ImportedTrack,track:Track,estimated=false)=>{
  const key=entryKey(entry);setPending(current=>new Set(current).add(key));setError('');
  if(ownedPreviews.current.has(playerEngine.getPreviewState().id||''))void playerEngine.stopPreview();
  try{await manuallyMatchMissing(playlistId,entry,track,estimated);setJob(current=>current?{...current,missingEntries:(current.missingEntries||[]).filter(item=>entryKey(item)!==key)}:current);}
  catch(reason){setError(reason instanceof Error?reason.message:'Couldn’t save the match. Try again.');throw reason;}
  finally{setPending(current=>{const next=new Set(current);next.delete(key);return next;});}
 };
 const estimateAll=async()=>{
  setEstimating(true);cancelEstimate.current=false;estimateController.current=new AbortController();setError('');let added=0;
  try{for(const entry of missing){if(cancelEstimate.current)break;const found=results[entryKey(entry)]??await search(entry,queries[entryKey(entry)]||importedTrackQuery(entry),estimateController.current.signal);if(cancelEstimate.current)break;if(found[0]){await choose(entry,found[0]);added++;}}if(added)notify(added+' estimated '+(added===1?'match':'matches')+' added');}
  catch{/* The failed row stays available with its error. */}finally{setEstimating(false);}
 };
 const audition=(track:Track)=>{if(preview.id===track.id&&preview.status!=='error')void playerEngine.stopPreview();else{ownedPreviews.current.add(track.id);void playerEngine.previewTrack(track);}};
 const missing=job?.status==='running'?[]:(job?.missingEntries||[]).filter(entry=>!pending.has(entryKey(entry)));
 useEffect(()=>{if(playlist?.estimatedMatches?.length)void finalizeEstimatedMatches(playlistId).catch(reason=>setError(reason.message));},[playlistId,playlist?.estimatedMatches?.length]);
 if(!job?.playlist.warning && job?.status!=='running' && job?.status!=='failed' && !missing.length && !error && !(preview.status==='error'&&ownedPreviews.current.has(preview.id||''))) return null;
 return <section className="import-matching section-stack" aria-label="Playlist matching">
  {job?.playlist.warning&&<p role="note" className="inline-message">{job.playlist.warning}</p>}
  {job?.status==='running'&&<div className="matching-toolbar"><p role="status">Importing {job.cursor} of {job.playlist.tracks.length} songs…</p></div>}
  {job?.status==='failed'&&<div className="matching-toolbar"><p role="alert">Import paused: {job.error}</p><button className="action-button" disabled={!isOnline} onClick={()=>void retryImport(playlistId).catch(reason=>setError(reason.message))}>Retry import</button></div>}
  {!!missing.length&&<><div className="section-heading matching-heading"><div><h2>Unmatched songs <small>{missing.length}</small></h2><p>Listen to a preview, then choose the right recording.</p></div>{estimating?<button className="action-button" onClick={()=>{cancelEstimate.current=true;estimateController.current?.abort();}}>Stop estimating</button>:<button className="action-button" disabled={!isOnline||pending.size>0} onClick={()=>void estimateAll()}><Sparkles size={15}/>Estimate matches</button>}</div><p className="matching-estimate-note">Estimate matches adds the top search results straight to your playlist. Results may be approximate.</p>
   <div className="unmatched-list">{missing.map(entry=>{const key=entryKey(entry),found=results[key];return <section key={key} className="unmatched-entry" aria-label={'Match '+entry.title}>
    <header><Artwork track={{id:'import:'+key,artworkUrl:entry.artworkUrl||found?.[0]?.artworkUrl}}/><div><strong>{entry.title}</strong><small>{entry.artist||entry.album}{entry.durationSeconds?' · '+duration(entry.durationSeconds):''}</small></div><button className="player-icon" disabled={estimating} aria-label={'Dismiss '+entry.title} title="Dismiss unmatched song" onClick={()=>void dismissMissing(playlistId,entry).catch(reason=>setError(reason.message))}><X size={16}/></button></header>
    {found===undefined?<p className="matching-empty">{isOnline?'Finding matches…':'Connect to find matches.'}</p>:!found.length?<p className="matching-empty">No matches found. Try another search.</p>:<div className="match-candidates">{found.map((track,index)=>{const active=preview.id===track.id&&preview.status!=='error';return <div className="match-candidate" key={track.id}>
      <button className="match-preview" disabled={!isOnline} aria-label={(active?'Stop preview of ':'Preview ')+track.title} title={active?'Stop preview':'Preview up to 30 seconds'} onClick={()=>audition(track)}><Artwork track={track}/><span>{active&&preview.status==='loading'?<Loader2 size={15} className="animate-spin"/>:active?<Square size={13} fill="currentColor"/>:<Play size={14} fill="currentColor"/>}</span></button>
      <button className="match-select" disabled={estimating} aria-label={'Use '+track.title+' — '+track.artist} onClick={()=>void choose(entry,track).catch(()=>{})}><strong>{track.title}</strong><small>{track.artist}{track.duration?' · '+duration(track.duration):''}</small><span>{active?'Previewing · up to 30 seconds':index===0?'Top search result':'Alternative recording'}</span></button>
      <button className="player-icon" disabled={estimating} aria-label={'Choose recording: '+track.title+' — '+track.artist} title="Use this recording" onClick={()=>void choose(entry,track).catch(()=>{})}><Check size={18}/></button>
     </div>;})}</div>}
    {found?.[0]&&<button className="text-button estimate-one" disabled={estimating} onClick={()=>void choose(entry,found[0]).catch(()=>{})}><Sparkles size={13}/>Use top result as estimate</button>}
    <form className="match-search" onSubmit={event=>{event.preventDefault();void search(entry,queries[key]??importedTrackQuery(entry));}}><input aria-label={'Search for '+entry.title} placeholder="Search manually" value={queries[key]??importedTrackQuery(entry)} onChange={event=>setQueries(current=>({...current,[key]:event.target.value}))}/><button className="player-icon" type="submit" disabled={!isOnline||estimating} aria-label={'Search matches for '+entry.title}><Search size={18}/></button></form>
   </section>;})}</div></>}
  {preview.status==='error'&&ownedPreviews.current.has(preview.id||'')&&<p role="alert">Preview couldn’t play. Try again or choose another recording.</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
