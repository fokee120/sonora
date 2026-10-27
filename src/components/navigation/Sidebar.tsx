import React from 'react';
import { Home, Search, Library, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
export const Sidebar: React.FC = () => {
 const { route, navigate, playlists, openCreatePlaylist } = useApp();
 return <aside id="desktop-sidebar" className="hidden md:flex w-60 shrink-0 min-h-0 flex-col p-5 border-r border-white/5">
  <h2 className="text-xl font-semibold mb-8">Sonora</h2>
  {[{ type:'home',label:'Home',Icon:Home },{ type:'search',label:'Search',Icon:Search },{ type:'library',label:'Library',Icon:Library }].map(({type,label,Icon}) => <button id={`nav-${type}`} key={type} onClick={() => navigate({type} as any)} aria-current={route.type === type ? 'page' : undefined} className="sidebar-link"><Icon size={20}/>{label}</button>)}
  <button onClick={() => openCreatePlaylist()} className="action-button mt-7"><Plus size={17}/>New playlist</button>
  <div className="mt-5 min-h-0 overflow-y-auto space-y-2">{playlists.map(item => <button key={item.id} className="block text-left text-sm truncate max-w-full py-2 text-zinc-400" onClick={() => navigate({type:'playlist',id:item.id})}>{item.title}</button>)}</div>
 </aside>;
};
