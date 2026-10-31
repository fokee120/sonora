import React, { useEffect, useState } from 'react';
import { audioCache } from '../../lib/offline/AudioCache.js';
import { notify } from '../common/ToastHost.js';
export function AudioCacheCard() {
 const [stats,setStats]=useState({bytes:0,count:0,gb:2,queued:0,working:0,error:'',failed:0});
 const [limit,setLimit]=useState('2'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;const refresh=()=>void audioCache.stats().then(s=>{if(active)setStats(s);});refresh();void audioCache.stats().then(s=>{if(active)setLimit(String(s.gb));});window.addEventListener('sonora:cache-changed',refresh);return()=>{active=false;window.removeEventListener('sonora:cache-changed',refresh);};},[]);
 const run=async(action:()=>Promise<unknown>,message:string)=>{setBusy(true);setError('');try{await action();notify(message);}catch(e){setError(e instanceof Error?e.message:'Couldn’t update the cache. Try again.');}finally{setBusy(false);}};
 return <section className="settings-card"><div className="section-heading"><h2>Automatic song cache</h2><span className="cache-badge">{stats.gb===0?'Off':'On'}</span></div><p>Keep music close without managing every download. Sonora caches songs you play and discover that aren’t already downloaded, and makes room by removing older unplayed cache first.</p>
 <div className="cache-stats"><strong>{(stats.bytes/1024**3).toFixed(2)}<small> / {stats.gb} GB</small></strong><span>{stats.count} cached songs</span></div><div className="storage-meter" aria-hidden="true"><span style={{width:Math.min(100,stats.bytes/Math.max(1,stats.gb*1024**3)*100)+'%'}}/></div>
 {(stats.queued+stats.working>0||stats.failed>0)&&<p role="status">{stats.queued+stats.working} pending{stats.failed?' · '+stats.failed+' unavailable':''}</p>}
 <label>Cache limit (GB)<input aria-label="Cache limit in GB" className="settings-input" type="number" inputMode="decimal" min="0" max="100" step=".25" value={limit} onChange={e=>setLimit(e.target.value)}/></label>
 <div className="flex gap-2"><button className="action-button" disabled={busy||!limit.trim()||!Number.isFinite(Number(limit))||Number(limit)<0||Number(limit)>100} onClick={()=>void run(()=>audioCache.setLimit(Number(limit)),'Cache limit saved')}>Save limit</button><button className="action-button" disabled={busy} onClick={()=>void run(()=>audioCache.clear(),'Automatic cache cleared')}>Clear automatic cache</button>{stats.failed>0&&<button className="action-button" disabled={busy} onClick={()=>{audioCache.retryFailed();notify('Retrying unavailable songs');}}>Retry unavailable</button>}</div>
 {(error||stats.error)&&<p role="alert">{error||stats.error}</p>}<p>Downloaded songs never count toward this cache or take up space twice. Set 0 to turn caching off. Caching runs while Sonora is open and connected.</p></section>;
}
