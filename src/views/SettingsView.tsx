import { AudioCacheCard } from '../components/settings/AudioCacheCard.js';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Download, SlidersHorizontal } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { DownloadsView } from './DownloadsView.js';
import { ImportPlaylistModal } from '../components/playlist/ImportPlaylistModal.js';
import { PWAInstallButton } from '../components/common/PWAInstallButton.js';
import { OfflineReadiness } from '../components/common/OfflineReadiness.js';
import { dbService } from '../lib/db.js';
import { repairDownloadedArtwork } from '../lib/artwork.js';
export const SettingsView: React.FC<{ initialTab?: 'general' | 'downloads' }> = ({ initialTab = 'general' }) => {
  const { navigate, tracks } = useApp();
  const [tab, setTab] = useState<'general' | 'downloads'>(initialTab);
  const [importOpen, setImportOpen] = useState(() => new URLSearchParams(location.search).has('spotify'));
  const [repair, setRepair] = useState('');
  const [busy, setBusy] = useState(false);
  const [genres, setGenres] = useState<string | null>(null);
  useEffect(() => { let active = true; void dbService.getSetting<any>('sonora:account:preferences', {}).then(value => { if (active) setGenres((value.favouriteGenres || []).join(', ')); }); return () => { active = false; }; }, []);
  return <div id="settings-view" className="settings-page space-y-6 pb-8">
    <header className="flex items-center gap-3"><button className="player-icon" aria-label="Back to Home" onClick={() => navigate({ type: 'home' })}><ArrowLeft size={23} /></button><h1 className="text-2xl font-bold">Settings</h1></header>
    <div role="tablist" aria-label="Settings sections" className="segmented-tabs">
      <button role="tab" aria-selected={tab === 'general'} onClick={() => setTab('general')}><SlidersHorizontal size={16} /><span>General</span></button>
      <button role="tab" aria-selected={tab === 'downloads'} onClick={() => setTab('downloads')}><Download size={16} /><span>Downloads</span></button>
    </div>
    {tab === 'downloads' ? <div role="tabpanel" aria-label="Downloads"><DownloadsView /></div> : <div role="tabpanel" aria-label="General" className="space-y-5">
      <OfflineReadiness />
      <AudioCacheCard />
      <section className="settings-card"><h2>Import playlists</h2><p>Bring in a Spotify or YouTube Music playlist. Public Spotify previews may contain only part of a large playlist.</p><button className="action-button" onClick={() => setImportOpen(true)}>Import a playlist</button></section>
      <section className="settings-card"><h2>Offline artwork</h2><p>New downloads include a sharper album cover. Upgrade covers for your existing downloaded songs while connected.</p>
        <button className="action-button" disabled={busy} onClick={async () => { setBusy(true); setRepair('Saving covers…'); try { const result = await repairDownloadedArtwork(tracks); setRepair(`Updated ${result.saved} covers.${result.failed ? ` ${result.failed} could not be saved; try again while connected.` : ''}`); } catch { setRepair('Could not update covers. Check your connection.'); } finally { setBusy(false); } }}> {busy ? 'Updating…' : 'Upgrade downloaded covers'}</button><p role="status">{repair}</p>
      </section>
      <section className="settings-card"><h2>Make Sonora your app</h2><p>Install Sonora on your Home Screen for offline listening and lock-screen controls.</p><PWAInstallButton variant="banner" /></section>
      <section className="settings-card"><h2>Listening preferences</h2><p>Choose favorite genres to shape your suggestions.</p><input aria-label="Favorite genres" value={genres ?? ''} disabled={genres === null} onChange={event => setGenres(event.target.value)} placeholder="R&B, soul, jazz…" className="settings-input" onBlur={async event => { const previous = await dbService.getSetting<any>('sonora:account:preferences', {}); await dbService.setSetting('sonora:account:preferences', { ...previous, favouriteGenres: event.target.value.split(',').map(value => value.trim()).filter(Boolean), favouriteArtists: previous.favouriteArtists || [], vibes: previous.vibes || [], discovery: previous.discovery || 'balanced', updatedAt: Date.now() }); }} /></section>
    </div>}
    <ImportPlaylistModal isOpen={importOpen} onClose={() => setImportOpen(false)} />
  </div>;
};
