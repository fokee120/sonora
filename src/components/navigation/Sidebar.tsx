import React, { useState } from 'react';
import {
  Home,
  Search,
  Library,
  Heart,
  HardDriveDownload,
  Settings,
  Plus,
  Disc3,
  ListMusic,
  User,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { PWAInstallButton } from '../common/PWAInstallButton.js';

export const Sidebar: React.FC = () => {
  const {
    route,
    navigate,
    playlists,
    createPlaylist,
    openCreatePlaylist,
    displayTracks,
    storageInfo,
    authSession,
    logout,
  } = useApp();

  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('');

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPlaylistTitle.trim()) {
      const pl = await createPlaylist(newPlaylistTitle.trim());
      setNewPlaylistTitle('');
      setIsCreatingPlaylist(false);
      navigate({ type: 'playlist', id: pl.id });
    }
  };

  const navItems = [
    { type: 'home', label: 'Home', icon: Home },
    { type: 'search', label: 'Search', icon: Search },
    { type: 'library', label: 'Your Library', icon: Library },
  ] as const;

  interface CollectionItem {
    type: 'liked' | 'downloads' | 'settings';
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }

  const collectionItems: CollectionItem[] = [
    { type: 'liked', label: 'Liked Songs', icon: Heart },
    {
      type: 'downloads',
      label: 'Offline Downloads',
      icon: HardDriveDownload,
      badge: storageInfo?.trackCount ? `${storageInfo.trackCount}` : undefined,
    },
    { type: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside
      id="desktop-sidebar"
      className="hidden md:flex flex-col w-64 shrink-0 bg-black/40 backdrop-blur-xl border-r border-white/5 h-full p-4 select-none z-10"
    >
      {/* Brand Header */}
      <div
        className="flex items-center gap-3 px-3 py-3 mb-4 cursor-pointer group"
        onClick={() => navigate({ type: 'home' })}
      >
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold italic shadow-lg shadow-blue-900/30 text-white group-hover:scale-105 transition-transform">
          S
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
            Sonora
          </h1>
          <p className="text-[11px] text-zinc-400 font-medium">Immersive Audio Cloud</p>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="space-y-1">
        <div className="text-[11px] font-semibold text-zinc-500 uppercase px-3 mb-2 tracking-wider">
          Library
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = route.type === item.type;
          return (
            <button
              key={item.type}
              id={`nav-${item.type}`}
              onClick={() => navigate({ type: item.type as any })}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600/10 text-blue-400 font-medium'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-zinc-400'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Library Collections */}
      <div className="mt-6 pt-4 border-t border-white/5">
        <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Collections
        </p>
        <div className="space-y-1">
          {collectionItems.map((item) => {
            const Icon = item.icon;
            const isActive = route.type === item.type;
            return (
              <button
                key={item.type}
                id={`nav-${item.type}`}
                onClick={() => navigate({ type: item.type as any })}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/10 text-blue-400 font-medium'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-zinc-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-blue-950/60 text-blue-400 border border-blue-800/40">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Playlists */}
      <div className="mt-6 pt-4 border-t border-white/5 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-3 mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Playlists
          </span>
          <button
            onClick={() => openCreatePlaylist()}
            className="p-1 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition"
            title="Create new playlist"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-0.5 pr-1 text-xs">
          {playlists.length === 0 ? (
            <p className="px-3 py-2 text-zinc-600 text-xs italic">No playlists created yet</p>
          ) : (
            playlists.map((pl) => {
              const isActive = route.type === 'playlist' && route.id === pl.id;
              return (
                <button
                  key={pl.id}
                  onClick={() => navigate({ type: 'playlist', id: pl.id })}
                  className={`w-full text-left truncate px-3 py-2 rounded-lg transition-colors flex items-center gap-2.5 ${
                    isActive
                      ? 'bg-blue-600/10 text-blue-400 font-medium'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                  }`}
                >
                  <ListMusic className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{pl.title}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Footer / Storage & PWA Banner */}
      <div className="pt-3 border-t border-white/5 space-y-3">
        {/* PWA Install Button */}
        <PWAInstallButton variant="sidebar" />

        {/* Atmospheric Glass Storage Gauge */}
        {storageInfo && (
          <div
            onClick={() => navigate({ type: 'downloads' })}
            className="glass rounded-xl p-3.5 space-y-2 cursor-pointer hover:border-white/20 transition group"
          >
            <div className="flex justify-between items-center text-xs text-zinc-400">
              <span className="group-hover:text-zinc-200 transition-colors">Storage Used</span>
              <span className="font-mono text-blue-400 font-medium">
                {Math.min(100, Math.max(2, Math.round((storageInfo.downloadSizeMB / (storageInfo.quotaMB || 1024)) * 100)))}%
              </span>
            </div>
            <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.max(4, (storageInfo.downloadSizeMB / 500) * 100))}%`,
                }}
              />
            </div>
            <div className="text-[10px] text-zinc-500 flex items-center justify-between">
              <span>{storageInfo.downloadSizeMB} MB stored</span>
              <span className="text-blue-400/80">{storageInfo.isPersisted ? 'Persistent' : 'Best-Effort'}</span>
            </div>
          </div>
        )}

        {/* User Account / Auth status */}
        {authSession.isAuthenticated && authSession.user ? (
          <div className="flex items-center justify-between px-2 pt-1 text-xs text-zinc-400">
            <div className="flex items-center gap-2 truncate">
              <div className="w-6 h-6 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-zinc-300">
                <User className="w-3.5 h-3.5" />
              </div>
              <span className="truncate text-zinc-300 font-medium">{authSession.user.name}</span>
            </div>
            <button
              onClick={() => logout()}
              className="p-1 hover:text-white text-zinc-500 rounded transition"
              title="Log out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
};
