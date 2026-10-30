import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,X,AlertCircle} from 'lucide-react';
export function notify(message:string,error=false){window.dispatchEvent(new CustomEvent('sonora:notice',{detail:{message,error,id:Date.now()}}));try{navigator.vibrate?.(error?[12,35,12]:10);}catch{}}
export function ToastHost(){
 const [notice,setNotice]=useState<{message:string;error:boolean;id:number}|null>(null);
 useEffect(()=>{const receive=(event:Event)=>setNotice((event as CustomEvent).detail);window.addEventListener('sonora:notice',receive);return()=>window.removeEventListener('sonora:notice',receive);},[]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),3200);return()=>clearTimeout(timer);},[notice]);
 if(!notice)return null;
 return createPortal(<div className={'overlay-notice toast'+(notice.error?' toast-error':'')} role={notice.error?'alert':'status'}>{notice.error?<AlertCircle size={15}/>:<Check size={15}/>}<span>{notice.message}</span><button className="player-icon" aria-label="Dismiss notification" onClick={()=>setNotice(null)}><X size={16}/></button></div>,document.body);
}
