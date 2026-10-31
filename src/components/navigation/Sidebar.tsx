import React from 'react';
import { Home, Search, Library, Plus, Download, Settings, AudioLines, ChartNoAxesCombined } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { PlaylistCover } from '../common/PlaylistCover.js';
export const Sidebar: React.FC = () => {
  const { route, navigate, displayPlaylists, displayTracks, openCreatePlaylist } = useApp();
  return <aside id="desktop-sidebar" className="desktop-sidebar">
    <button className="brand" aria-label="Sonora Home" onClick={() => navigate({ type: 'home' })}><span className="brand-mark"><AudioLines size={23} /></span>sonora<span className="brand-dot">.</span></button>
    <nav aria-label="Desktop navigation">{[{ type:'home',label:'Home',Icon:Home },{ type:'search',label:'Search',Icon:Search },{ type:'recap',label:'Recap',Icon:ChartNoAxesCombined },{ type:'library',label:'Library',Icon:Library }].map(({type,label,Icon}) => <button id={'nav-' + type} key={type} onClick={() => navigate({type} as any)} aria-current={route.type === type || type === 'library' && ['playlist','liked','album','artist'].includes(route.type) ? 'page' : undefined} className="sidebar-link"><Icon size={21}/>{label}</button>)}</nav>
    <div className="sidebar-collection-heading"><span className="eyebrow">YOUR PLAYLISTS</span><button className="player-icon" aria-label="Create playlist" onClick={() => openCreatePlaylist()}><Plus size={18}/></button></div>
    <div className="sidebar-playlists">{displayPlaylists.length ? displayPlaylists.map(item => <button key={item.id} className="sidebar-playlist" onClick={() => navigate({type:'playlist',id:item.id})}><PlaylistCover playlist={item} tracks={displayTracks}/><span><strong>{item.title}</strong><small>{item.trackIds.length} songs</small></span></button>) : <p>Good music deserves a place.<button className="text-button" onClick={() => openCreatePlaylist()}>Create your first playlist</button></p>}</div>
    <div className="sidebar-bottom"><button className="sidebar-link" onClick={() => navigate({ type: 'downloads' })}><Download size={19}/>Downloads</button><button className="sidebar-link" onClick={() => navigate({ type: 'settings' })}><Settings size={19}/>Settings</button><p>MAKE ROOM FOR MUSIC.</p></div>
  </aside>;
};
