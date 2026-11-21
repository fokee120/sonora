import {useEffect,useState} from 'react';
import {playerEngine} from '../../lib/audio/PlayerEngine.js';
export function ServerAccessNotice(){
 const [blocked,setBlocked]=useState(false);
 useEffect(()=>{
  let stopped=false,pending=false;
  const heartbeat=async()=>{
   if(pending||stopped)return;
   const state=playerEngine.getState(),visible=document.visibilityState==='visible';
   if(!visible&&!state.isPlaying)return;
   pending=true;
   try{
    const response=await fetch('/api/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playing:state.isPlaying,visible}),signal:AbortSignal.timeout(8000)});
    if(response.status===403){const body=await response.json();if(body.error==='access_blocked'&&!stopped){setBlocked(true);playerEngine.pause({hard:true});}}
    else if(response.ok&&!stopped)setBlocked(false);
   }catch{/* Offline playback never depends on presence. */}finally{pending=false;}
  };
  void heartbeat();const timer=setInterval(()=>void heartbeat(),15000);
  const changed=()=>void heartbeat();document.addEventListener('visibilitychange',changed);
  return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',changed);};
 },[]);
 if(!blocked)return null;
 return <div role="alertdialog" aria-label="Server access blocked" aria-modal="true" style={{position:'fixed',inset:0,zIndex:10000,display:'grid',placeContent:'center',textAlign:'center',padding:32,background:'var(--bg)',color:'var(--text-primary)'}}><h1 style={{fontSize:28,fontWeight:700}}>Access blocked</h1><p style={{marginTop:12,maxWidth:340}}>The server owner has blocked access from this account or browser. Access returns here automatically if they allow it again.</p></div>;
}
