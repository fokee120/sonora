import React, { useEffect, useState } from 'react';
import { Download, Trash2, ShieldCheck, Play, Shuffle, RefreshCw, X } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { Overlay } from '../components/common/Overlay.js';
import { notify } from '../components/common/ToastHost.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';
import { OfflineReadiness } from '../components/common/OfflineReadiness.js';
export const DownloadsView: React.FC = () => {
  const { tracks, storageInfo, refreshStorageInfo, clearAllDownloads, requestPersistStorage } = useApp();
  const { playTrack, setQueue } = usePlayer();
  const [showClear, setShowClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, setRevision] = useState(0);
  useEffect(() => offlineManager.subscribe(() => setRevision(n => n + 1)), []);
  const downloaded = tracks.filter(t => offlineManager.isTrackDownloaded(t.id));
  const pending = tracks.filter(t => offlineManager.isTrackDownloading(t.id) || offlineManager.getDownloadState(t.id)?.status === 'failed');
  const play = (shuffle = false) => {
    if (!downloaded.length) return;
    const queue = [...downloaded];
    if (shuffle) for (let i = queue.length-1; i > 0; i--) { const j = Math.floor(Math.random() * (i+1)); [queue[i],queue[j]] = [queue[j],queue[i]]; }
    setQueue(queue, queue[0]); playTrack(queue[0], queue);
  };
  return <div id="downloads-view" className="section-stack">
    <OfflineReadiness/>
    <section className="settings-card download-summary"><div className="section-heading"><div><p className="eyebrow">TAKE IT WITH YOU</p><h1 className="text-2xl font-semibold tracking-tight mt-2">Downloaded songs</h1><p>Saved on this device</p></div><button className="player-icon" title="Refresh quota estimate" aria-label="Refresh quota estimate" onClick={() => void refreshStorageInfo()}><RefreshCw size={19}/></button></div>
      <div className="download-stats"><div><strong>{downloaded.length}</strong><span>Songs offline</span></div><div><strong>{storageInfo?.downloadSizeMB || 0}<small> MB</small></strong><span>On this device</span></div></div>
      {storageInfo && <><div className="storage-meter" role="meter" aria-label="Device storage used" aria-valuenow={Math.round(storageInfo.percentUsed)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: Math.min(100, storageInfo.percentUsed) + '%' }}/></div><p>{storageInfo.usageMB} MB used of {storageInfo.quotaMB > 1024 ? (storageInfo.quotaMB/1024).toFixed(1) + ' GB' : storageInfo.quotaMB + ' MB'} available to Sonora</p><div className="storage-protection"><ShieldCheck size={19}/><span>{storageInfo.persisted ? 'Storage protected' : 'Keep your downloads safer'}</span>{!storageInfo.persisted && <button className="text-button" disabled={busy} onClick={async () => { setBusy(true); try { const accepted = await requestPersistStorage(); notify(accepted ? 'Download storage protected' : 'This browser manages storage automatically'); } catch { notify('Couldn’t request storage protection.', true); } finally { setBusy(false); } }}>{busy ? 'Requesting…' : 'Protect storage'}</button>}</div></>}
      {!!downloaded.length && <div className="flex flex-wrap gap-3"><button className="primary-button" onClick={() => play()}><Play size={16} fill="currentColor"/>Play all</button><button className="action-button" onClick={() => play(true)}><Shuffle size={16}/>Shuffle</button></div>}
    </section>
    {pending.length > 0 && <section className="section-stack"><div className="section-heading"><h2>Downloads in progress</h2><button className="text-button" onClick={() => { pending.forEach(t => offlineManager.cancelDownload(t.id)); notify('Pending downloads cancelled'); }}>Cancel pending</button></div><div className="song-list">{pending.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={downloaded}/>)}</div></section>}
    <section className="section-stack"><div className="section-heading"><h2>On your device</h2>{!!downloaded.length && <button className="text-button text-rose-300" onClick={() => { setError(''); setShowClear(true); }}><Trash2 size={15}/>Clear all</button>}</div>{!downloaded.length ? <div className="empty-state"><span className="empty-icon"><Download size={28}/></span><h2>Good music goes with you.</h2><p>Tap the download icon on a song or playlist. Your music will be ready without a connection.</p></div> : <div className="song-list">{downloaded.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={downloaded}/>)}</div>}</section>
    <p className="download-footnote">On iPhone, download inside the installed Home Screen app. iOS can remove website data when device storage is low.</p>
    <Overlay isOpen={showClear} onClose={() => !busy && setShowClear(false)} label="Clear All Downloads?"><div className="p-6 section-stack"><header className="section-heading"><h2>Clear All Downloads?</h2><button className="player-icon" aria-label="Close confirmation" onClick={() => setShowClear(false)} disabled={busy}><X size={20}/></button></header><p className="text-sm text-zinc-400">Remove {downloaded.length} audio files from this device? Your library and playlists stay saved. You can download these songs again.</p>{error && <p role="alert">{error}</p>}<div className="flex gap-3 justify-end"><button className="action-button" disabled={busy} onClick={() => setShowClear(false)}>Cancel</button><button className="action-button text-rose-300" disabled={busy} onClick={async () => { setBusy(true); try { await clearAllDownloads(); setShowClear(false); notify('Downloads cleared'); } catch { setError('Couldn’t clear downloads. Please try again.'); } finally { setBusy(false); } }}>{busy ? 'Clearing…' : 'Clear Downloads'}</button></div></div></Overlay>
  </div>;
};
