import React from 'react';
import { motion } from 'motion/react';
import { HardDriveDownload, Settings, ChartNoAxesCombined } from 'lucide-react';
import { Home, Search, Library } from '../common/ThemeIcons.js';
import { useApp } from '../../context/AppContext.js';

export const MobileNavBar: React.FC = () => {
  const { route, navigate, storageInfo } = useApp();

  if(['playlist','settings','downloads'].includes(route.type))return null;

  interface NavItem {
    type: 'home' | 'search' | 'recap' | 'library';
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }

  const items: NavItem[] = [
    { type: 'home', label: 'Home', icon: Home },
    { type: 'search', label: 'Search', icon: Search },
    { type: 'recap', label: 'Recap', icon: ChartNoAxesCombined },
    { type: 'library', label: 'Library', icon: Library },
  ];

  return (
    <nav
      id="mobile-bottom-nav"
      aria-label="Main navigation"
      className="mobile-bottom-nav md:hidden flex items-center justify-around px-2 select-none"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = route.type === item.type || (item.type === 'library' && ['album', 'albums', 'artist', 'artists', 'playlists', 'playlist', 'liked'].includes(route.type));
        return (
          <motion.button
            key={item.type}
            onClick={() => navigate({ type: item.type as any })}
            aria-current={isActive ? 'page' : undefined}
            whileTap={{ scale: 0.92 }}
            className={`mobile-nav-item relative flex flex-col items-center justify-center rounded-xl ${
              isActive ? 'text-blue-400 font-semibold' : 'text-zinc-500 hover:text-white'
            }`}
          >
            {isActive && <motion.span className="nav-active-pill" layoutId="mobile-active-tab" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <div className="relative">
              <Icon className="w-5 h-5" />
              {item.badge && (
                <span className="absolute -top-1 -right-2.5 px-1 py-0.2 text-[9px] font-mono rounded-full bg-blue-500 text-white font-bold shadow-[0_0_6px_rgba(59,130,246,0.6)]">
                  {item.badge}
                </span>
              )}
            </div>
            <span className="relative text-[10px] mt-1">{item.label}</span>
          </motion.button>
        );
      })}
    </nav>
  );
};
