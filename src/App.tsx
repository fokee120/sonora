import React, { useEffect, useRef } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { useAppViewport } from './hooks/useAppViewport.js';
import { AppProvider, useApp } from './context/AppContext.js';
import { Sidebar } from './components/navigation/Sidebar.js';
import { MobileNavBar } from './components/navigation/MobileNavBar.js';
import { BottomPlayer } from './components/player/BottomPlayer.js';
import { OfflineIndicator } from './components/common/OfflineIndicator.js';
import { HomeView } from './views/HomeView.js';
import { SearchView } from './views/SearchView.js';
import { LibraryView } from './views/LibraryView.js';
import { AlbumDetailView } from './views/AlbumDetailView.js';
import { ArtistDetailView } from './views/ArtistDetailView.js';
import { PlaylistDetailView } from './views/PlaylistDetailView.js';
import { LikedSongsView } from './views/LikedSongsView.js';
import { SettingsView } from './views/SettingsView.js';
import { usePlayer } from './hooks/usePlayer.js';
import { CreatePlaylistModal } from './components/playlist/CreatePlaylistModal.js';
import { useSwipeGesture } from './hooks/useSwipeGesture.js';
import { Plus } from 'lucide-react';

const MainAppContent: React.FC = () => {
  const {
    route,
    isCreatePlaylistOpen,
    createPlaylistInitialTrackId,
    closeCreatePlaylist,
    openCreatePlaylist,
    navigate,
  } = useApp();
  const { currentTrack } = usePlayer();
  useAppViewport();
  const scrollRef = useRef<HTMLElement>(null);
  const libraryUnderlay = useRef<HTMLDivElement>(null);
  const swipeFrame = useRef<number | null>(null);
  const backStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeLanding = useRef(false);
  const backCommitting = useRef(false);
  const finishBack = () => { if (!backCommitting.current) return; backCommitting.current = false; if (backTimer.current) clearTimeout(backTimer.current); swipeLanding.current = true; navigate({ type: 'library' }); };
  useEffect(() => { backCommitting.current = false; backStart.current = null; if (backTimer.current) clearTimeout(backTimer.current); if (swipeFrame.current !== null) cancelAnimationFrame(swipeFrame.current); if (scrollRef.current) { scrollRef.current.style.transform = ''; scrollRef.current.style.transition = ''; scrollRef.current.style.willChange = ''; } if (libraryUnderlay.current) libraryUnderlay.current.style.visibility = 'hidden'; if (route.type !== 'library') swipeLanding.current = false; if (scrollRef.current && route.type === 'library' && swipeLanding.current) scrollRef.current.scrollTop = 0; }, [route]);
  useEffect(() => () => { if (backTimer.current) clearTimeout(backTimer.current); if (swipeFrame.current !== null) cancelAnimationFrame(swipeFrame.current); }, []);
  const routeKey = route.type + ('id' in route ? `:${route.id}` : '');
  const pages = ['home', 'search', 'library'] as const;
  const pageIndex = pages.indexOf(route.type as any);
  const gestures = useSwipeGesture({
    exclude: '[data-song-swipe], button, a, .segmented-tabs, [data-sonora-overlay]',
    onLeft: () => { if (pageIndex >= 0 && pageIndex < 2) navigate({ type: pages[pageIndex + 1] }); },
    onRight: () => { if (pageIndex > 0) navigate({ type: pages[pageIndex - 1] }); else if (route.type === 'settings') navigate({ type: 'home' }); },
  });
  const renderCurrentView = () => {
    switch (route.type) {
      case 'home':
        return <HomeView />;
      case 'search':
        return <SearchView />;
      case 'library':
      case 'albums':
      case 'artists':
        return <LibraryView />;
      case 'album':
        return <AlbumDetailView albumId={route.id} />;
      case 'artist':
        return <ArtistDetailView artistId={route.id} />;
      case 'playlist':
        return <PlaylistDetailView playlistId={route.id} />;
      case 'liked':
        return <LikedSongsView />;
      case 'downloads':
        return <SettingsView initialTab="downloads" />;
      case 'settings':
        return <SettingsView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <div className="app-shell flex flex-col w-screen overflow-hidden bg-[#050505] text-white antialiased font-sans relative selection:bg-blue-600 selection:text-white" onPointerDownCapture={event => { if (event.pointerType === 'touch' && (event.target as HTMLElement).closest('button:not(:disabled)')) { try { navigator.vibrate?.(8); } catch { /* Haptics are optional. */ } } }}>
      {/* Atmospheric Ambient Glow Layer */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(circle at 0% 0%, rgba(59,130,246,0.09) 0%, transparent 45%), radial-gradient(circle at 100% 100%, rgba(147,51,234,0.06) 0%, transparent 45%), radial-gradient(circle at 50% 50%, rgba(59,130,246,0.03) 0%, transparent 60%)',
        }}
      />

      {/* Offline Status Top Banner */}
      <OfflineIndicator />

      {/* Main App Layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative z-10">
        {/* Desktop Left Sidebar */}
        <Sidebar />

        {/* Main Content Column */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden relative">
          {/* Top Atmospheric Header */}
          <header className="h-16 shrink-0 hidden md:flex items-center justify-between px-8 bg-black/20 backdrop-blur-md border-b border-white/5 z-20 select-none">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-400">
                  Sonora
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">

              {/* Quick Create Playlist Button */}
              <button
                onClick={() => openCreatePlaylist()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition"
                title="Create a new playlist"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Playlist</span>
              </button>

              <div className="text-right ml-2">
                <div className="text-xs font-medium text-white">
                  Personal Music Library
                </div>
                <div className="text-[10px] text-zinc-500 font-mono tracking-tight">
                  {currentTrack ? `Now Playing: ${currentTrack.title}` : 'High-Fidelity Audio'}
                </div>
              </div>
            </div>
          </header>

          {/* Dynamic Center Scroll View */}
          {route.type === 'playlist' && <div ref={libraryUnderlay} aria-hidden="true" className="main-scroll absolute inset-0 overflow-hidden bg-[#050505] px-4 sm:px-8 pointer-events-none" style={{ visibility: 'hidden' }}><div className="max-w-7xl mx-auto w-full"><LibraryView /></div></div>}
          <main
            id="main-content-scroll"
            {...gestures}
            ref={scrollRef}
            className={`main-scroll relative min-h-0 flex-1 overflow-y-auto px-4 sm:px-8 bg-[#050505] ${route.type === 'playlist' ? 'playlist-page-enter' : ''}`}
            onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'transform') finishBack(); }}
          >
              <motion.div key={routeKey} className="route-content max-w-7xl mx-auto w-full"
                initial={(swipeLanding.current && route.type === 'library') || route.type === 'playlist' ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: route.type === 'playlist' ? 0.3 : 0.18, ease: [0.22, 1, 0.36, 1] }}>
                {renderCurrentView()}
              </motion.div>
          </main>
          {route.type === 'playlist' && <div data-native-swipe aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-8 z-30" style={{ touchAction: 'pan-y' }} onPointerDown={e => { if (!e.isPrimary || backCommitting.current) return; if (backTimer.current) clearTimeout(backTimer.current); backStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; if (scrollRef.current) { scrollRef.current.style.transition = 'none'; scrollRef.current.style.willChange = 'transform'; } e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const start = backStart.current; if (!start || start.id !== e.pointerId) return; const dx = e.clientX - start.x; if (dx > 5 && dx > Math.abs(e.clientY - start.y) * 1.2) { if (libraryUnderlay.current) libraryUnderlay.current.style.visibility = 'visible'; if (swipeFrame.current !== null) cancelAnimationFrame(swipeFrame.current); swipeFrame.current = requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.style.transform = `translate3d(${Math.min(innerWidth, dx)}px,0,0)`; swipeFrame.current = null; }); } }} onPointerUp={e => { const start = backStart.current; backStart.current = null; if (swipeFrame.current !== null) { cancelAnimationFrame(swipeFrame.current); swipeFrame.current = null; } const finish = !!start && e.clientX - start.x > 70 && e.clientX - start.x > Math.abs(e.clientY - start.y) * 1.2; if (finish) backCommitting.current = true; if (scrollRef.current) { scrollRef.current.style.transition = 'transform 220ms cubic-bezier(.22,1,.36,1)'; scrollRef.current.style.transform = finish ? `translate3d(${innerWidth}px,0,0)` : 'translate3d(0,0,0)'; } if (finish) backTimer.current = setTimeout(finishBack, 350); else backTimer.current = setTimeout(() => { if (libraryUnderlay.current) libraryUnderlay.current.style.visibility = 'hidden'; }, 220); }} onPointerCancel={() => { backStart.current = null; if (swipeFrame.current !== null) { cancelAnimationFrame(swipeFrame.current); swipeFrame.current = null; } if (scrollRef.current) { scrollRef.current.style.transition = 'transform 220ms ease-out'; scrollRef.current.style.transform = 'translate3d(0,0,0)'; } backTimer.current = setTimeout(() => { if (libraryUnderlay.current) libraryUnderlay.current.style.visibility = 'hidden'; }, 220); }} />}
        </div>
      </div>

      {/* Persistent Bottom Audio Player */}
      <div className="app-dock shrink-0 relative z-40">
        <BottomPlayer />
        <MobileNavBar />
      </div>

      {/* Create Playlist Modal */}
        <CreatePlaylistModal
          isOpen={isCreatePlaylistOpen}
          initialTrackId={createPlaylistInitialTrackId}
          onClose={closeCreatePlaylist}
        />

    </div>
  );
};

export default function App() {
  return (
    <MotionConfig reducedMotion="user"><AppProvider>
      <MainAppContent />
    </AppProvider></MotionConfig>
  );
}
