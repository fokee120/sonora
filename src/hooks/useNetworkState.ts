import {useEffect,useSyncExternalStore} from 'react';
import {checkServerConnection,reconnectToServer,getConnectionState,subscribeConnection,markNetworkOffline} from '../lib/serverConnection.js';
export interface NetworkStatus {isOnline:boolean;isChecking:boolean;lastChecked:number;recheck:()=>Promise<boolean>;}
export function useNetworkState():NetworkStatus{
 const state=useSyncExternalStore(subscribeConnection,getConnectionState);
 useEffect(()=>{const check=()=>{void checkServerConnection();};const offline=()=>{markNetworkOffline();check();};const visible=()=>{if(document.visibilityState==='visible')check();};
 window.addEventListener('online',check);window.addEventListener('offline',offline);window.addEventListener('focus',check);document.addEventListener('visibilitychange',visible);
 check();const timer=setInterval(()=>{if(document.visibilityState==='visible')check();},10000);
 return()=>{clearInterval(timer);window.removeEventListener('online',check);window.removeEventListener('offline',markNetworkOffline);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',visible);};},[]);
 return {...state,recheck:reconnectToServer};
}
