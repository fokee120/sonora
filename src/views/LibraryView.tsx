import React, { useState } from 'react';
import {usePlayer} from '../hooks/usePlayer.js';
import {sortPlaylistTracks} from '../lib/playlistOrder.js';
import {notify} from '../components/common/ToastHost.js';
import { Play, Pause, Shuffle, Loader2, Plus, ListMusic, Heart, Pin, ArrowDownToLine, Search, ArrowDownUp } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { ImportPlaylistModal } from '../components/playlist/ImportPlaylistModal.js';
import { PlaylistCover } from '../components/common/PlaylistCover.js';
export const LibraryView: React.FC = () => {
  const { displayTracks, displayPlaylists, navigate, openCreatePlaylist } = useApp();
  const {playPlaylist,playlistId:activePlaylist,isPlaying,isLoading,togglePlay}=usePlayer();
  const [tab, setTab] = useState<'playlists' | 'songs'>('playlists');
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState(() => localStorage.getItem('playlist-sort') || 'recent');
  const sorted = [...displayPlaylists].filter(p => p.title.toLowerCase().includes(filter.toLowerCase())).sort((a,b) => Number(!!b.pinnedAt)-Number(!!a.pinnedAt) || (a.pinnedAt && b.pinnedAt ? b.pinnedAt-a.pinnedAt : sort === 'alphabetical' ? a.title.localeCompare(b.title) : (b.lastPlayedAt || b.updatedAt)-(a.lastPlayedAt || a.updatedAt)));
  const songs = displayTracks.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(filter.toLowerCase()));
  return <div id="library-view" className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h1>Library</h1></div><button className="player-icon outlined-icon" aria-label="New playlist" title="New playlist" onClick={() => openCreatePlaylist()}><Plus size={22} /></button></header>
    <div role="tablist" aria-label="Library categories" className="segmented-tabs library-tabs" data-active-tab={tab}><span className="library-tab-indicator" aria-hidden="true" />{(['playlists', 'songs'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => { setTab(value); setFilter(''); }}><span>{value === 'playlists' ? 'Playlists' : 'Songs'}</span></button>)}</div>
    <div key={tab} role="tabpanel" aria-label={tab} className={'library-panel library-panel-' + tab + ' section-stack'}>
      <div className="library-toolbar"><span className="collection-count">{tab === 'playlists' ? displayPlaylists.length + ' playlists' : displayTracks.length + ' songs'}</span>{tab === 'playlists' && <label className="sort-control"><ArrowDownUp size={14} /><select aria-label="Sort playlists" value={sort} onChange={e => { setSort(e.target.value); localStorage.setItem('playlist-sort', e.target.value); }}><option value="recent">Recent</option><option value="alphabetical">Alphabetical</option></select></label>}<button className="text-button" onClick={() => setImportOpen(true)}><ArrowDownToLine size={15} />Import</button></div>
      {(tab === 'songs' || displayPlaylists.length > 5) && <div className="search-field compact-search"><Search size={18} /><input aria-label={'Filter ' + tab} placeholder={'Find in your ' + tab + '…'} value={filter} onChange={e => setFilter(e.target.value)} /></div>}
      {tab === 'playlists' ? <>
        {!displayPlaylists.length && <div className="empty-state"><span className="empty-icon"><ListMusic size={28} /></span><h2>A place for every mood.</h2><p>Make a playlist from scratch or bring your favorites with you.</p><button className="primary-button" onClick={() => openCreatePlaylist()}><Plus size={17} />Create a playlist</button></div>}
        <div className="playlist-library-list">{sorted.map(playlist => {
          const active=activePlaylist===playlist.id;
          const available=playlist.trackIds.map(id=>displayTracks.find(t=>t.id===id)).filter((t):t is import('../types/index.js').Track=>!!t);
          return <div key={playlist.id} className="playlist-library-row" data-playlist-id={playlist.id}>
            <button className="playlist-library-open" onClick={()=>navigate({type:'playlist',id:playlist.id})}><PlaylistCover playlist={playlist} tracks={displayTracks} className="playlist-row-art"/><span className="min-w-0 text-left"><strong className="block truncate">{playlist.title}</strong><small>{!!playlist.pinnedAt&&<Pin size={12}/>}Playlist · {playlist.trackIds.length} songs{playlist.playback?.shuffle&&<Shuffle size={12} aria-label="Shuffle enabled"/>}</small></span></button>
            <button className="player-icon playlist-quick-play" aria-label={(active&&isLoading?'Cancel loading ':active&&isPlaying?'Pause ':'Play ')+playlist.title} disabled={!available.length} onClick={()=>{if(active){togglePlay();return;}void playPlaylist(playlist.id,sortPlaylistTracks(available,playlist.playback?.sort,playlist.customOrder),playlist.playback?.shuffle??false).catch(()=>notify('Couldn’t start this playlist. Try again.',true));}}>{active&&isLoading?<Loader2 size={20} className="animate-spin"/>:active&&isPlaying?<Pause size={20} fill="currentColor"/>:<Play size={20} fill="currentColor"/>}</button>
          </div>;
        })}</div>
        {!!filter && !sorted.length && <div className="empty-state"><p>No playlists match “{filter}”.</p></div>}
      </> : <>
        <button className="liked-collection" onClick={() => navigate({ type: 'liked' })}><span className="shortcut-icon favorite-icon"><Heart size={22} fill="currentColor" /></span><span><strong>Liked songs</strong><small>All your favorites, together</small></span></button>
        {!songs.length ? <div className="empty-state"><Search size={25} /><h2>{filter ? 'Nothing here yet' : 'Keep your favorites close.'}</h2><p>{filter ? 'Try a different song or artist.' : 'Songs you play, save, or download appear here.'}</p>{!filter && <button className="action-button" onClick={() => navigate({ type: 'search' })}>Discover music</button>}</div> : <div className="song-list">{songs.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={songs} />)}</div>}
      </>}
    </div>
    <ImportPlaylistModal isOpen={importOpen} onClose={() => setImportOpen(false)} />
  </div>;
};
