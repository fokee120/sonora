import {initializeSharedPlayback} from './lib/sharedPlayback.js';
import {playerEngine} from './lib/audio/PlayerEngine.js';
import {SignInGate} from './components/common/SignInGate.js';
import {ServerAccessNotice} from './components/common/ServerAccessNotice.js';
import {initializeCloudAccount} from './lib/cloudAccount.js';
import React, { useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import { Plus, Search } from 'lucide-react';
import { useAppViewport } from './hooks/useAppViewport.js';
import { AppProvider, useApp } from './context/AppContext.js';
import { Sidebar } from './components/navigation/Sidebar.js';
import { MobileNavBar } from './components/navigation/MobileNavBar.js';
import { PageStage } from './components/navigation/PageStage.js';
import { BottomPlayer } from './components/player/BottomPlayer.js';
import { AddToPlaylistSheet } from './components/playlist/AddToPlaylistSheet.js';
import { CreatePlaylistModal } from './components/playlist/CreatePlaylistModal.js';
import {WeeklyRecapNotice} from './components/common/WeeklyRecapNotice.js';
import { ToastHost } from './components/common/ToastHost.js';

function MainAppContent() {
  const { route, isCreatePlaylistOpen, createPlaylistInitialTrackId, closeCreatePlaylist, openCreatePlaylist, navigate, libraryError, refreshLibrary, playlistPickerTrack, setPlaylistPickerTrack } = useApp();
  useAppViewport();
  useEffect(()=>{initializeCloudAccount();initializeSharedPlayback(playerEngine);},[]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable]') || document.querySelector('[data-sonora-overlay]')) return;
      if (event.key === '/') { event.preventDefault(); navigate({ type: 'search' }); requestAnimationFrame(() => document.getElementById('search-input')?.focus()); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [navigate]);
  return <div className="app-shell flex flex-col overflow-hidden text-white antialiased relative" onPointerDownCapture={event => { if (event.pointerType === 'touch' && (event.target as HTMLElement).closest('button:not(:disabled)')) { try { navigator.vibrate?.(8); } catch {} } }}>
    <ServerAccessNotice />

    <div className="flex flex-1 min-h-0 overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden relative">
        <header className="desktop-header"><span>Your listening space</span><div><button className="header-search" onClick={() => navigate({ type: 'search' })}><Search size={16} />Find something good <kbd>/</kbd></button><button className="action-button" onClick={() => openCreatePlaylist()}><Plus size={16} />New playlist</button></div></header>
        {libraryError && <div className="library-error" role="alert">Your library couldn’t load. <button onClick={() => void refreshLibrary()}>Try again</button></div>}
        <PageStage />
      </div>
    </div>
    <div className={'app-dock shrink-0 relative z-40'+(['playlist','settings','downloads'].includes(route.type)?' detail-dock':'')+(route.type==='playlist'?' playlist-dock':'')}><BottomPlayer /><ToastHost /><MobileNavBar /></div>
    <WeeklyRecapNotice/>
    {playlistPickerTrack && <AddToPlaylistSheet track={playlistPickerTrack} isOpen onClose={() => setPlaylistPickerTrack(null)} />}
    <CreatePlaylistModal isOpen={isCreatePlaylistOpen} initialTrackId={createPlaylistInitialTrackId} onClose={closeCreatePlaylist} />
  </div>;
}
export default function App() { return <MotionConfig reducedMotion="user"><SignInGate><AppProvider><MainAppContent /></AppProvider></SignInGate></MotionConfig>; }

