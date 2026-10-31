import React, { useEffect, useState } from 'react';
import { ArrowLeft, Download, SlidersHorizontal } from 'lucide-react';
import {AccountCard} from '../components/settings/AccountCard.js';
import { AppearanceCard } from '../components/settings/AppearanceCard.js';
import { AudioCacheCard } from '../components/settings/AudioCacheCard.js';
import { useApp } from '../context/AppContext.js';
import { DownloadsView } from './DownloadsView.js';
import { ImportPlaylistModal } from '../components/playlist/ImportPlaylistModal.js';
import { PWAInstallButton } from '../components/common/PWAInstallButton.js';
import { OfflineReadiness } from '../components/common/OfflineReadiness.js';
import { notify } from '../components/common/ToastHost.js';
import { dbService } from '../lib/db.js';
import { repairDownloadedArtwork } from '../lib/artwork.js';
import { uiSoundsEnabled,setUiSoundsEnabled } from '../lib/uiFeedback.js';
export const SettingsView: React.FC<{ initialTab?: 'general'|'downloads' }> = ({initialTab='general'}) => {
 const {navigate,tracks}=useApp();
 const [tab,setTab]=useState<'general'|'downloads'>(initialTab);
 const [importOpen,setImportOpen]=useState(()=>new URLSearchParams(location.search).has('spotify'));
 const [repair,setRepair]=useState(''),[busy,setBusy]=useState(false),[genres,setGenres]=useState<string|null>(null),[genreError,setGenreError]=useState('');
 const [sounds,setSounds]=useState(uiSoundsEnabled);
 useEffect(()=>{let active=true;void dbService.getSetting<any>('sonora:account:preferences',{}).then(v=>{if(active)setGenres((v.favouriteGenres||[]).join(', '));}).catch(()=>{if(active)setGenreError('Couldn’t load your listening preferences.');});return()=>{active=false;};},[]);
 return <div id="settings-view" className="settings-page page-stack"><header className="flex items-center gap-3"><button className="player-icon outlined-icon" aria-label="Back to Home" onClick={()=>navigate({type:'home'})}><ArrowLeft size={22}/></button><div><p className="eyebrow">MAKE IT YOURS</p><h1 className="text-3xl font-semibold tracking-tight">Settings</h1></div></header>
 <div role="tablist" aria-label="Settings sections" className="segmented-tabs"><button role="tab" aria-selected={tab==='general'} onClick={()=>setTab('general')}><SlidersHorizontal size={16}/><span>General</span></button><button role="tab" aria-selected={tab==='downloads'} onClick={()=>setTab('downloads')}><Download size={16}/><span>Downloads</span></button></div>
 {tab==='downloads'?<div role="tabpanel" aria-label="Downloads"><DownloadsView/></div>:<div role="tabpanel" aria-label="General" className="section-stack">
 <AppearanceCard/><AccountCard/><OfflineReadiness/><AudioCacheCard/>
 <section className="settings-card"><h2>Listening preferences</h2><p>Tell us what you love. Your favorite genres help shape new discoveries.</p><label>Favorite genres<input aria-label="Favorite genres" value={genres??''} disabled={genres===null} onChange={e=>setGenres(e.target.value)} placeholder="R&B, soul, jazz…" className="settings-input" onBlur={async event=>{try{const value=event.target.value;const previous=await dbService.getSetting<any>('sonora:account:preferences',{});await dbService.setSetting('sonora:account:preferences',{...previous,favouriteGenres:value.split(',').map(v=>v.trim()).filter(Boolean),favouriteArtists:previous.favouriteArtists||[],vibes:previous.vibes||[],discovery:previous.discovery||'balanced',updatedAt:Date.now()});setGenreError('');window.dispatchEvent(new Event('sonora:preferences-changed'));notify('Listening preferences saved');}catch{setGenreError('Couldn’t save your preferences. Try again.');}}}/></label>{genreError&&<p role="alert">{genreError}</p>}</section>
 <section className="settings-card"><div className="section-heading"><div><h2>Interaction sounds</h2><p>Subtle feedback for your actions.</p></div><button className="setting-switch" role="switch" aria-label="Interaction sounds" aria-checked={sounds} onClick={()=>{setUiSoundsEnabled(!sounds);setSounds(!sounds);}}><span/></button></div></section>
 <section className="settings-card"><h2>Bring your playlists</h2><p>Import from Spotify, YouTube Music, or a playlist file. Keep your own names, covers, and additions.</p><button className="action-button" onClick={()=>setImportOpen(true)}>Import a playlist</button></section>
 <section className="settings-card"><h2>Offline artwork</h2><p>Sharper covers, wherever you listen. Upgrade artwork for songs you’ve already downloaded.</p><button className="action-button" disabled={busy} onClick={async()=>{setBusy(true);setRepair('Saving covers…');try{const result=await repairDownloadedArtwork(tracks);setRepair('Updated '+result.saved+' covers.'+(result.failed?' '+result.failed+' could not be saved. Try again while connected.':''));}catch{setRepair('Could not update covers. Check your connection.');}finally{setBusy(false);}}}>{busy?'Updating…':'Upgrade downloaded covers'}</button>{repair&&<p role="status">{repair}</p>}</section>
 <section className="settings-card"><h2>Make Sonora your app</h2><p>Add Sonora to your Home Screen for offline listening and lock-screen controls.</p><PWAInstallButton variant="banner"/></section>
 <p className="settings-colophon">sonora. <span>A little more room for music.</span></p>
 </div>}
 <p className="made-by-enzo">made by enzo</p>
 <ImportPlaylistModal isOpen={importOpen} onClose={()=>setImportOpen(false)}/></div>;
};
