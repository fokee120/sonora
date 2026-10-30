type ConnectionState={isOnline:boolean;isChecking:boolean;lastChecked:number};
let state:ConnectionState={isOnline:typeof navigator==='undefined'||navigator.onLine,isChecking:false,lastChecked:0};
const listeners=new Set<()=>void>();let pending:Promise<boolean>|null=null,revision=0;
const publish=(patch:Partial<ConnectionState>)=>{state={...state,...patch};for(const listener of listeners)listener();};
export const getConnectionState=()=>state;
export const subscribeConnection=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const isServerOnline=()=>state.isOnline&&(typeof navigator==='undefined'||navigator.onLine);
export function markNetworkOffline(){revision++;publish({isOnline:false,isChecking:false,lastChecked:Date.now()});}
export function checkServerConnection():Promise<boolean>{
 if(!navigator.onLine){markNetworkOffline();return Promise.resolve(false);}
 if(pending)return pending;
 const generation=revision,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);publish({isChecking:true});
 pending=(async()=>{let online=false;try{const response=await fetch('/api/health?t='+Date.now(),{signal:controller.signal,cache:'no-store'});online=response.ok&&!!response.headers.get('content-type')?.includes('application/json');await response.body?.cancel();}catch{online=false;}finally{clearTimeout(timer);}
 if(generation===revision)publish({isOnline:online&&navigator.onLine,isChecking:false,lastChecked:Date.now()});return isServerOnline();
 })().finally(()=>{pending=null;});return pending;
}
