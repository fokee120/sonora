import {getConnectionState,subscribeConnection} from './serverConnection.js';
import {useSyncExternalStore} from 'react';
import {dbService,getDB} from './db.js';
type Collections=Record<string,Record<string,any>>;
type Profile={uid:string;email?:string;displayName?:string;photoURL?:string};
type AccountState={profile:Profile|null;clientId:string;nonce:string;status:string;busy:boolean;ready:boolean;authenticated:boolean;offlineUntil?:number;sessionUnavailable?:boolean};
const stores=['tracks','playlists','favorites','history','albums','artists'] as const;
let state:AccountState={profile:null,clientId:'',nonce:'',status:'',busy:false,ready:false,authenticated:false},started=false,running=false,applying=false,switching=false;
let runningTask:Promise<void>|null=null;
let sessionRefresh:Promise<void>|null=null, sessionVersion=0;
const listeners=new Set<()=>void>();const emit=(patch:Partial<AccountState>)=>{state={...state,...patch};for(const fn of listeners)fn();window.dispatchEvent(new Event('sonora:account-access'));};
export const useCloudAccount=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);
export const accountSnapshot=()=>state;
// A server-verified session can open its on-device library while we reconnect.
export const hasAccountAccess=()=>state.ready&&!!state.profile&&(state.offlineUntil||0)>Date.now();
const equal=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
export function libraryDiff(base:Collections,next:Collections){const changes:any[]=[];for(const collection of [...stores,'preferences']){const old=base[collection]||{},current=next[collection]||{};for(const id of new Set([...Object.keys(old),...Object.keys(current)]))if(!equal(old[id],current[id]))changes.push({collection,id,value:current[id]??null,base:old[id]??null});}return changes;}
function fromRows(rows:any[][],preferences:any):Collections{const result:Collections={};stores.forEach((name,i)=>{result[name]=Object.fromEntries(rows[i].map(value=>[name==='favorites'?value.trackId:value.id,value]));});result.preferences=preferences?{listening:preferences}:{};return result;}
async function readSnapshot():Promise<Collections>{const db=await getDB();const tx=db.transaction([...stores,'settings'],'readonly');const values=await Promise.all(stores.map(name=>tx.objectStore(name).getAll()));const prefs=await tx.objectStore('settings').get('sonora:account:preferences');await tx.done;return fromRows(values,prefs?.value);}
async function applyRemote(remote:Collections,captured:Collections,uid:string,revision:number){const db=await getDB(),tx=db.transaction([...stores,'settings'],'readwrite');const values=await Promise.all(stores.map(name=>tx.objectStore(name).getAll()));const prefs=await tx.objectStore('settings').get('sonora:account:preferences');const current=fromRows(values,prefs?.value),merged=structuredClone(remote);
 for(const op of libraryDiff(captured,current)){merged[op.collection]??={};if(op.value===null)delete merged[op.collection][op.id];else merged[op.collection][op.id]=op.value;}
 for(const name of stores){const store=tx.objectStore(name);await store.clear();for(const value of Object.values(merged[name]||{}))await (store as any).put(value);}
 const settings=tx.objectStore('settings');await settings.put({key:'cloud:revision:'+uid,value:revision,updatedAt:Date.now()});if(merged.preferences?.listening)await settings.put({key:'sonora:account:preferences',value:merged.preferences.listening,updatedAt:Date.now()});else await settings.delete('sonora:account:preferences');await settings.put({key:'cloud:baseline:'+uid,value:remote,updatedAt:Date.now()});await tx.done;
 for(const [id,playlist]of Object.entries(merged.playlists||{}))if(!equal(current.playlists?.[id],playlist))window.dispatchEvent(new CustomEvent('sonora:playlist-saved',{detail:{playlist,previous:current.playlists?.[id]}}));
 if(!equal(current,merged)){window.dispatchEvent(new Event('sonora:cloud-library-changed'));window.dispatchEvent(new Event('sonora:history-changed'));window.dispatchEvent(new Event('sonora:preferences-changed'));}
}
export function syncCloudLibrary():Promise<void>{if(runningTask)return runningTask.then(()=>syncCloudLibrary());if(switching)return Promise.resolve();runningTask=performCloudSync().finally(()=>{runningTask=null;});return runningTask;}
export async function beginCloudSignIn(){switching=true;sessionVersion++;if(runningTask)await runningTask;}
export function finishCloudSignIn(){switching=false;}
async function performCloudSync(){if(!state.profile||!state.authenticated||!navigator.onLine)return;running=true;const uid=state.profile.uid;emit({status:'Syncing your library…'});try{const baseline=await dbService.getSetting<Collections>('cloud:baseline:'+uid,{}),captured=await readSnapshot();const revision=await dbService.getSetting<number>('cloud:revision:'+uid,-1);const changes=libraryDiff(baseline,captured);const bytes=new TextEncoder().encode(uid+JSON.stringify(changes));const batch=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');const response=await fetch('/api/account/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountUid:uid,revision,batch,changes})});if(response.status===401){void refreshCloudSession();throw Error('Rechecking your session. Your changes are saved on this device.');}if(!response.ok)throw Error('Sync couldn’t finish. Your changes are saved on this device.');const data=await response.json();if(state.profile?.uid!==uid)return;if(!data.unchanged){applying=true;await applyRemote(data.collections||{},captured,uid,data.revision);}emit({status:'Library up to date'});}catch(e){emit({status:e instanceof Error?e.message:'Sync couldn’t finish.'});}finally{applying=false;running=false;}}
async function backup(owner:string){await dbService.setSetting('cloud:local:'+owner,{collections:await readSnapshot(),downloads:await dbService.getAllDownloads()});}
async function restore(owner:string){const saved=await dbService.getSetting<any>('cloud:local:'+owner,null);const db=await getDB(),tx=db.transaction([...stores,'downloads','settings'],'readwrite');for(const name of stores){await tx.objectStore(name).clear();for(const value of Object.values(saved?.collections?.[name]||{}))await (tx.objectStore(name) as any).put(value);}await tx.objectStore('downloads').clear();for(const value of saved?.downloads||[])await tx.objectStore('downloads').put(value);const settings=tx.objectStore('settings');await settings.delete('sonora:account:preferences');if(saved?.collections?.preferences?.listening)await settings.put({key:'sonora:account:preferences',value:saved.collections.preferences.listening,updatedAt:Date.now()});for(const key of ['player_track','player_queue','player_queue_cursor','player_position','player_playlist','player_queue_base','player_playlist_profile'])await settings.delete(key);await tx.done;localStorage.removeItem('sonora:player-resume:v1');}
export async function adoptCloudAccount(profile:Profile,expiresAt=Date.now()+30*86400000){
 switching=true;
 let reload=false;
 try{
  if(runningTask)await runningTask;
  const owner=await dbService.getSetting<string|null>('cloud:owner',null);
  if(owner!==profile.uid){
   await backup(owner||'guest');
   if(owner||await dbService.getSetting('cloud:baseline:'+profile.uid,null)||Object.values(await readSnapshot()).some(rows=>Object.keys(rows).length>0)){
    await restore(profile.uid);
    reload=true;
   }
   await dbService.setSetting('cloud:owner',profile.uid);
  }
  await dbService.setSetting('cloud:profile',profile);
  await dbService.setSetting('cloud:verified-until',expiresAt);
  emit({profile,busy:false,ready:true,authenticated:true,offlineUntil:expiresAt,sessionUnavailable:false});
 }finally{switching=false;}
 await syncCloudLibrary();
 window.dispatchEvent(new Event('sonora:cloud-library-changed'));
 if(reload)location.reload();
}
export async function signOutCloud(){sessionVersion++;emit({busy:true});try{await syncCloudLibrary();switching=true;const response=await fetch('/api/account/logout',{method:'POST'});if(!response.ok)throw Error('Connect to sign out.');const owner=await dbService.getSetting<string|null>('cloud:owner',null);if(owner)await backup(owner);emit({profile:null,authenticated:false,offlineUntil:0});await dbService.setSetting('cloud:verified-until',0);await restore('guest');await dbService.setSetting('cloud:owner',null);await dbService.setSetting('cloud:profile',null);location.reload();}catch(e){switching=false;emit({busy:false,status:e instanceof Error?e.message:'Couldn’t sign out.'});}}
export function refreshCloudSession():Promise<void>{
 if(switching||state.busy)return Promise.resolve();
 if(sessionRefresh)return sessionRefresh;
 const version=sessionVersion;
 const isCurrent=()=>version===sessionVersion&&!switching;
 sessionRefresh=(async()=>{
  if(!state.ready){
   // Cached access belongs to the account that owns the current local library.
   try{
    const [profile,owner,expiresAt]=await Promise.all([
     dbService.getSetting<Profile|null>('cloud:profile',null),
     dbService.getSetting<string|null>('cloud:owner',null),
     dbService.getSetting<number>('cloud:verified-until',0),
    ]);
    if(isCurrent()&&profile&&profile.uid===owner&&expiresAt>Date.now()){
     emit({profile,ready:true,offlineUntil:expiresAt,status:'Connecting to your account…'});
    }
   }catch{/* A valid server session can still be checked without a local record. */}
  }
  if(!isCurrent())return;
  try{
   const response=await fetch('/api/account/session',{cache:'no-store',signal:AbortSignal.timeout(7000)});
   if(!response.ok)throw Error('Session check failed');
   const data=await response.json();
   if(!isCurrent())return;
   const config={clientId:data.clientId||'',nonce:data.nonce||'',sessionUnavailable:false};
   if(data.profile===null){
    emit({...config,profile:null,ready:true,authenticated:false,offlineUntil:0,status:''});
    await dbService.setSetting('cloud:verified-until',0);
    return;
   }
   if(typeof data.profile?.uid!=='string'||!data.profile.uid||typeof data.expiresAt!=='number'||!Number.isFinite(data.expiresAt)||data.expiresAt<=Date.now()){
    throw Error('Invalid session response');
   }
   emit(config);
   await adoptCloudAccount(data.profile,data.expiresAt);
  }catch{
   if(isCurrent())emit({ready:true,sessionUnavailable:true,status:'Waiting for the server. Your library is saved on this device.'});
  }
 })().finally(()=>{sessionRefresh=null;});
 return sessionRefresh;
}

export function initializeCloudAccount(){
 if(started)return;
 started=true;
 void refreshCloudSession();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const local=()=>{
  if(applying)return;
  if(timer)clearTimeout(timer);
  timer=setTimeout(()=>void syncCloudLibrary(),1000);
 };
 const retryOrSync=()=>{
  if(state.sessionUnavailable||(state.profile&&(!state.authenticated||!hasAccountAccess())))void refreshCloudSession();
  else void syncCloudLibrary();
 };
 let online=getConnectionState().isOnline;
 subscribeConnection(()=>{
  const connected=getConnectionState().isOnline;
  const restored=connected&&!online;
  online=connected;
  if(restored)retryOrSync();
 });
 window.addEventListener('sonora:library-local-changed',local);
 window.addEventListener('online',retryOrSync);
 window.addEventListener('focus',retryOrSync);
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')retryOrSync();
 });
 setInterval(()=>{
  if(document.visibilityState==='visible'&&getConnectionState().isOnline)retryOrSync();
 },15000);
}
