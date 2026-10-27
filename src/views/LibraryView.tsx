import React, { useState } from 'react';
import { Plus, ListMusic, Heart, Pin } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { ImportPlaylistModal } from '../components/playlist/ImportPlaylistModal.js';
import { Artwork } from '../components/common/Artwork.js';

export const LibraryView: React.FC = () => {
  const { displayTracks, displayPlaylists, navigate, openCreatePlaylist } = useApp();
  const [tab, setTab] = useState<'playlists' | 'songs'>('playlists');
  const [importOpen, setImportOpen] = useState(false);
  const [sort,setSort]=useState(()=>localStorage.getItem('playlist-sort')||'recent');
  const sorted=[...displayPlaylists].sort((a,b)=>Number(!!b.pinnedAt)-Number(!!a.pinnedAt)||(a.pinnedAt&&b.pinnedAt?b.pinnedAt-a.pinnedAt:sort==='alphabetical'?a.title.localeCompare(b.title):(b.lastPlayedAt||b.updatedAt)-(a.lastPlayedAt||a.updatedAt)));
  return <div id="library-view" className="space-y-6 pb-8">
    <header className="flex items-center justify-between gap-3"><h1 className="text-2xl font-bold">Library</h1>
      <button className="action-button" onClick={() => openCreatePlaylist()}><Plus size={17} />New playlist</button>
    </header>
    <div role="tablist" aria-label="Library categories" className="segmented-tabs library-tabs" data-active-tab={tab}>
      <span className="library-tab-indicator" aria-hidden="true" />
      {(['playlists', 'songs'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>
        <span>{value === 'playlists' ? 'Playlists' : 'Songs'}</span>
      </button>)}
    </div>
    <div key={tab} role="tabpanel" aria-label={tab} className={`library-panel library-panel-${tab}`}>
      {tab === 'playlists' ? <div className="space-y-4">
        <button className="text-sm text-blue-300" onClick={() => setImportOpen(true)}>Import a playlist</button>
        {displayPlaylists.length === 0 && <div className="empty-state"><ListMusic size={30} /><h2>Make it your own</h2><p>Create a playlist or import one you already love.</p></div>}
        <label className="block text-sm text-zinc-400">Sort playlists <select aria-label="Sort playlists" className="bg-zinc-900 rounded-lg p-2" value={sort} onChange={e=>{setSort(e.target.value);localStorage.setItem('playlist-sort',e.target.value);}}><option value="recent">Recent</option><option value="alphabetical">Alphabetical</option></select></label>
        {sorted.map(playlist => <button key={playlist.id} className="playlist-library-row" onClick={() => navigate({ type: 'playlist', id: playlist.id })}>
          {playlist.artworkUrl?<img src={playlist.artworkUrl} alt={playlist.title} className="playlist-row-art object-cover"/>:<Artwork track={{ id: `playlist:${playlist.id}`, artworkUrl: displayTracks.find(track => playlist.trackIds.includes(track.id))?.artworkUrl }} className="playlist-row-art" />}
          <span className="min-w-0 text-left"><strong className="block truncate">{playlist.pinnedAt&&<Pin size={13} className="inline mr-2 text-blue-400"/>}{playlist.title}</strong><span className="text-xs text-zinc-400">{playlist.trackIds.length} songs</span></span>
        </button>)}
      </div> : <div>
        <button className="action-button" onClick={() => navigate({ type: 'liked' })}><Heart size={16} />Liked songs</button>
        {displayTracks.length === 0 ? <p className="empty-state">Save or download songs to find them here.</p> : <div className="song-list mt-3">{displayTracks.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={displayTracks} />)}</div>}
      </div>}
    </div>
    <ImportPlaylistModal isOpen={importOpen} onClose={() => setImportOpen(false)} />
  </div>;
};
