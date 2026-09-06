import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext.js';
import { Sidebar } from './components/navigation/Sidebar.js';
import { MobileNavBar } from './components/navigation/MobileNavBar.js';
import { BottomPlayer } from './components/player/BottomPlayer.js';
import { OfflineIndicator } from './components/common/OfflineIndicator.js';
import { AuthModal } from './components/auth/AuthModal.js';
import { HomeView } from './views/HomeView.js';
import { SearchView } from './views/SearchView.js';
import { LibraryView } from './views/LibraryView.js';
import { AlbumDetailView } from './views/AlbumDetailView.js';
import { ArtistDetailView } from './views/ArtistDetailView.js';
import { PlaylistDetailView } from './views/PlaylistDetailView.js';
import { LikedSongsView } from './views/LikedSongsView.js';
import { DownloadsView } from './views/DownloadsView.js';
import { SettingsView } from './views/SettingsView.js';
import { usePlayer } from './hooks/usePlayer.js';
import { CreatePlaylistModal } from './components/playlist/CreatePlaylistModal.js';
import { GoogleDriveConnectCard } from './components/auth/GoogleDriveConnectCard.js';
import { Plus } from 'lucide-react';

const MainAppContent: React.FC = () => {
  const {
    route,
    authSession,
    isCreatePlaylistOpen,
    createPlaylistInitialTrackId,
    closeCreatePlaylist,
    openCreatePlaylist,
  } = useApp();
  const { currentTrack } = usePlayer();
  const [showAuthModal, setShowAuthModal] = useState(false);

  // If server requires auth and user is not authenticated, lock screen with modal
  const needsAuth = authSession.authRequired && !authSession.isAuthenticated;

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
        return <DownloadsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#050505] text-white antialiased font-sans relative selection:bg-blue-600 selection:text-white">
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
      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* Desktop Left Sidebar */}
        <Sidebar />

        {/* Main Content Column */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Top Atmospheric Header */}
          <header className="h-16 shrink-0 hidden md:flex items-center justify-between px-8 bg-black/20 backdrop-blur-md border-b border-white/5 z-20 select-none">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    authSession.user
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                      : 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.6)]'
                  }`}
                />
                <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-400">
                  {authSession.user ? 'Authenticated Session' : 'Sonora Vault'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Google Drive Status Bar */}
              <GoogleDriveConnectCard compact />

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
                  {authSession.user ? authSession.user.name : 'Personal Cloud Library'}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono tracking-tight">
                  {currentTrack ? `Now Playing: ${currentTrack.title}` : 'High-Fidelity Audio'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!authSession.isAuthenticated) {
                    setShowAuthModal(true);
                  }
                }}
                className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 border border-white/10 flex items-center justify-center font-bold text-xs shadow-md transition hover:scale-105 hover:border-white/25 focus:outline-hidden focus:ring-2 focus:ring-blue-400/60 disabled:cursor-default disabled:hover:scale-100"
                title={authSession.isAuthenticated ? 'Signed in' : 'Sign in'}
                aria-label={authSession.isAuthenticated ? 'Signed in' : 'Sign in'}
                disabled={authSession.isAuthenticated}
              >
                {authSession.user?.name ? authSession.user.name.charAt(0).toUpperCase() : 'S'}
              </button>
            </div>
          </header>

          {/* Dynamic Center Scroll View */}
          <main
            id="main-content-scroll"
            className={`flex-1 overflow-y-auto px-4 sm:px-8 py-6 transition-all ${
              currentTrack ? 'pb-32 md:pb-28' : 'pb-16 md:pb-8'
            }`}
          >
            <div className="max-w-7xl mx-auto w-full">{renderCurrentView()}</div>
          </main>
        </div>
      </div>

      {/* Persistent Bottom Audio Player */}
      <BottomPlayer />

      {/* Mobile Bottom Navigation Bar */}
      <MobileNavBar />

      {/* Create Playlist Modal */}
      {isCreatePlaylistOpen && (
        <CreatePlaylistModal
          isOpen={isCreatePlaylistOpen}
          initialTrackId={createPlaylistInitialTrackId}
          onClose={closeCreatePlaylist}
        />
      )}

      {/* Private Authentication Modal */}
      {(needsAuth || showAuthModal) && (
        <AuthModal
          isOpen={true}
          isForced={needsAuth}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainAppContent />
    </AppProvider>
  );
}
