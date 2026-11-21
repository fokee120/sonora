import React,{useEffect,useState} from 'react';
import {usePlayer} from '../../hooks/usePlayer.js';
import {bridgeHeaders} from '../../lib/audio/audioSource.js';
import {youtubeVideoId} from '../../lib/ytmusic/youtubeMusic.js';
export function AudioBackendIndicator(){
 const {currentTrack,playbackSource}=usePlayer({progress:false});const [source,setSource]=useState('Connecting…');
 useEffect(()=>{let active=true;const controller=new AbortController();setSource('Connecting…');const check=async()=>{try{const response=await fetch('/api/ytmusic/bridge/stream-source',{headers:bridgeHeaders(),cache:'no-store',signal:controller.signal});if(!response.ok)return;const data=await response.json();if(active)setSource(data.enabled&&currentTrack&&data.videoId===youtubeVideoId(currentTrack)?data.source||'Connecting…':'Connecting…');}catch{}};void check();const timer=setInterval(()=>void check(),1500);return()=>{active=false;controller.abort();clearInterval(timer);};},[currentTrack?.id,playbackSource]);
 return <small style={{display:'block',marginTop:4,fontSize:10,color:'var(--accent-readable)',fontWeight:600}} aria-live="polite">{playbackSource==='local'?'Saved audio':source}</small>;
}
