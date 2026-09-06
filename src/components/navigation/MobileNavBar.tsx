import React from 'react';
import { Home, Search, Library, HardDriveDownload, Settings } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';

export const MobileNavBar: React.FC = () => {
  const { route, navigate, storageInfo } = useApp();

  interface NavItem {
    type: 'home' | 'search' | 'library' | 'downloads' | 'settings';
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }

  const items: NavItem[] = [
    { type: 'home', label: 'Home', icon: Home },
    { type: 'search', label: 'Search', icon: Search },
    { type: 'library', label: 'Library', icon: Library },
    {
      type: 'downloads',
      label: 'Offline',
      icon: HardDriveDownload,
      badge: storageInfo?.trackCount ? `${storageInfo.trackCount}` : undefined,
    },
    { type: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <nav
      id="mobile-bottom-nav"
      className="md:hidden flex items-center justify-around bg-black/85 backdrop-blur-xl border-t border-white/5 px-2 py-1.5 z-40 shrink-0 select-none pb-safe"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = route.type === item.type;
        return (
          <button
            key={item.type}
            onClick={() => navigate({ type: item.type as any })}
            className={`relative flex flex-col items-center justify-center py-1 px-3 rounded-xl transition ${
              isActive ? 'text-blue-400 font-semibold' : 'text-zinc-500 hover:text-white'
            }`}
          >
            <div className="relative">
              <Icon className="w-5 h-5" />
              {item.badge && (
                <span className="absolute -top-1 -right-2.5 px-1 py-0.2 text-[9px] font-mono rounded-full bg-blue-500 text-white font-bold shadow-[0_0_6px_rgba(59,130,246,0.6)]">
                  {item.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-1">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
