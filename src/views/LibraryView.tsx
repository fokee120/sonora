import React, { useMemo, useRef, useState } from 'react';
import {usePlayer} from '../hooks/usePlayer.js';
import {sortPlaylistTracks} from '../lib/playlistOrder.js';
import {notify} from '../components/common/ToastHost.js';
import { Play, Pause, Shuffle, Loader2, Plus, ListMusic, Heart, Pin, Search, ArrowDownUp, Disc3, Check, X } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { Overlay } from '../components/common/Overlay.js';
import { useLibraryLongPress } from '../hooks/useLibraryLongPress.js';
import type { Track } from '../types/index.js';
import { PlaylistCover } from '../components/common/PlaylistCover.js';
import { AlbumCards } from '../components/common/CatalogCards.js';

const tabLabels = { playlists: 'Playlists', songs: 'Songs', albums: 'Albums' } as const;
type LibraryTab = keyof typeof tabLabels;

export const LibraryView: React.FC = () => {
  const { displayTracks, displayPlaylists, displayAlbums, navigate, openCreatePlaylist, createPlaylist, addTracksToLibrary, removeLibraryItems } = useApp();
  const {playPlaylist,playlistId:activePlaylist,isPlaying,isLoading,togglePlay}=usePlayer({ progress: false, subscribeQueue: false });
  const [tab, setTab] = useState<LibraryTab>('playlists');
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [action, setAction] = useState<'merge' | 'remove' | null>(null);
  const [mergeTitle, setMergeTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const actionInProgress = useRef(false);
  const hold = useLibraryLongPress(id => setSelection(new Set([id])), selection !== null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState(() => localStorage.getItem('playlist-sort') || 'recent');
  const sorted = [...displayPlaylists].filter(p => p.title.toLowerCase().includes(filter.toLowerCase())).sort((a,b) => Number(!!b.pinnedAt)-Number(!!a.pinnedAt) || (a.pinnedAt && b.pinnedAt ? b.pinnedAt-a.pinnedAt : sort === 'alphabetical' ? a.title.localeCompare(b.title) : (b.lastPlayedAt || b.updatedAt)-(a.lastPlayedAt || a.updatedAt)));
  const songs = displayTracks.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(filter.toLowerCase()));
  const albums = [...displayAlbums]
    .filter(album => (album.title + ' ' + album.artist).toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0) || a.title.localeCompare(b.title));
  const counts = { playlists: displayPlaylists.length, songs: displayTracks.length, albums: displayAlbums.length };
  const libraryKind = tab === 'albums' ? 'albums' : 'playlists';
  const selectedIds = [...(selection ?? [])].filter(id => (
    (libraryKind === 'albums' ? displayAlbums : displayPlaylists).some(item => item.id === id)
  ));
  const itemName = libraryKind === 'albums' ? 'album' : 'playlist';
  const selectedLabel = selectedIds.length + ' ' + itemName + (selectedIds.length === 1 ? '' : 's');

  const toggle = (id: string) => setSelection(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const closeAction = () => { if (!actionInProgress.current) setAction(null); };
  const openAction = (next: 'merge' | 'remove') => {
    setActionError('');
    if (next === 'merge') setMergeTitle(libraryKind === 'albums' ? 'Merged albums' : 'Merged playlists');
    setAction(next);
  };
  const trackById = useMemo(() => new Map<string, Track>(displayTracks.map(track => [track.id, track])), [displayTracks]);
  const tracksForPlaylist = (ids: string[]) => ids.flatMap<Track>(id => {
    const track = trackById.get(id);
    return track ? [track] : [];
  });

  const applySelection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!action || !selectedIds.length || actionInProgress.current) return;
    if (action === 'merge' && (selectedIds.length < 2 || !mergeTitle.trim())) return;
    actionInProgress.current = true;
    setBusy(true);
    setActionError('');
    try {
      if (action === 'remove') {
        await removeLibraryItems(libraryKind, selectedIds);
        notify('Removed ' + selectedLabel);
      } else {
        const ids = new Set<string>();
        const missingAlbumsTracks = new Map<string, Track>();
        for (const id of selectedIds) {
          if (libraryKind === 'albums') {
            const album = displayAlbums.find(item => item.id === id);
            if (!album) continue;
            const songs = album.tracks?.length ? album.tracks : displayTracks.filter(track =>
              (track.albumId && [track.albumId, 'catalog:' + track.albumId].includes(id))
              || (track.album === album.title && track.artist === album.artist)
            );
            for (const track of songs) {
              ids.add(track.id);
              if (!trackById.has(track.id)) missingAlbumsTracks.set(track.id, track);
            }
          } else {
            const playlist = displayPlaylists.find(item => item.id === id);
            if (!playlist) continue;
            const ordered = sortPlaylistTracks(tracksForPlaylist(playlist.trackIds), playlist.playback?.sort, playlist.customOrder);
            for (const track of ordered) ids.add(track.id);
            for (const trackId of playlist.trackIds) ids.add(trackId);
          }
        }
        await addTracksToLibrary([...missingAlbumsTracks.values()]);
        const merged = await createPlaylist(mergeTitle, undefined, [...ids], { sort: 'date-old' });
        setTab('playlists');
        setFilter('');
        navigate({ type: 'playlist', id: merged.id });
      }
      setAction(null);
      setSelection(null);
    } catch {
      setActionError(action === 'merge' ? 'Couldn’t merge these items. Try again.' : 'Couldn’t remove these items. Try again.');
    } finally {
      actionInProgress.current = false;
      setBusy(false);
    }
  };

  return <div id="library-view" className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h1>Library</h1></div>{!selection && <button className="player-icon outlined-icon" aria-label="New playlist" title="New playlist" onClick={() => openCreatePlaylist()}><Plus size={22} /></button>}</header>
    <div role="tablist" aria-label="Library categories" className="segmented-tabs library-tabs" data-active-tab={tab}><span className="library-tab-indicator" aria-hidden="true" />{(Object.keys(tabLabels) as LibraryTab[]).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => { setTab(value); setFilter(''); setSelection(null); }}><span>{tabLabels[value]}</span></button>)}</div>
    <div key={tab} {...hold} onKeyDown={event => { if (selection && event.key === 'Escape') setSelection(null); }} role="tabpanel" aria-label={tabLabels[tab]} className={'library-panel library-panel-' + tab + ' section-stack'}>
      {selection && <div className="library-selection-toolbar" role="group" aria-label="Selection actions">
        <span className="collection-count" aria-live="polite">{selectedIds.length} selected</span>
        <button className="text-button library-remove-selection" disabled={!selectedIds.length} onClick={() => openAction('remove')}>Remove {selectedIds.length === 1 ? itemName : libraryKind}</button>
        <button className="action-button" disabled={selectedIds.length < 2} onClick={() => openAction('merge')}>Merge</button>
        <button className="player-icon" aria-label="Cancel selection" onClick={() => setSelection(null)}><X size={18} /></button>
      </div>}
      {!selection && <div className="library-toolbar"><span className="collection-count">{counts[tab]} {counts[tab] === 1 ? tab.slice(0, -1) : tab}</span>{tab === 'playlists' && <label className="sort-control"><ArrowDownUp size={14} /><select aria-label="Sort playlists" value={sort} onChange={e => { setSort(e.target.value); localStorage.setItem('playlist-sort', e.target.value); }}><option value="recent">Recent</option><option value="alphabetical">Alphabetical</option></select></label>}{tab !== 'songs' && (counts[tab] > 0) && <button className="text-button" onClick={() => setSelection(new Set())}>Select</button>}</div>}
      {(tab === 'songs' || counts[tab] > 5) && <div className="search-field compact-search"><Search size={18} /><input aria-label={'Filter ' + tab} placeholder={'Find in your ' + tab + '…'} value={filter} onChange={e => setFilter(e.target.value)} /></div>}
      {tab === 'playlists' ? <>
        {!displayPlaylists.length && <div className="empty-state"><span className="empty-icon"><ListMusic size={28} /></span><h2>A place for every mood.</h2><p>Make a playlist from scratch or bring your favorites with you.</p><button className="primary-button" onClick={() => openCreatePlaylist()}><Plus size={17} />Create a playlist</button></div>}
        <div className="playlist-library-list">{sorted.map(playlist => {
          const active=activePlaylist===playlist.id;
          const available = tracksForPlaylist(playlist.trackIds);
          const selected = selection?.has(playlist.id);
          return <div key={playlist.id} className="playlist-library-row" data-playlist-id={playlist.id} data-library-selected={selected}>
            <button className="playlist-library-open" data-library-selection-id={playlist.id} aria-pressed={selected} onClick={() => selection ? toggle(playlist.id) : navigate({ type: 'playlist', id: playlist.id })}><PlaylistCover playlist={playlist} tracks={displayTracks} className="playlist-row-art"/><span className="min-w-0 text-left"><strong className="block truncate">{playlist.title}</strong><small>{!!playlist.pinnedAt&&<Pin size={12}/>}Playlist · {playlist.trackIds.length} songs{playlist.playback?.shuffle&&<Shuffle size={12} aria-label="Shuffle enabled"/>}</small></span>{selection && <span className="library-selection-check" data-selected={selected} aria-hidden="true">{selected && <Check size={15}/>}</span>}</button>
            {!selection && <button className="player-icon playlist-quick-play" aria-label={(active&&isLoading?'Cancel loading ':active&&isPlaying?'Pause ':'Play ')+playlist.title} disabled={!available.length} onClick={()=>{if(active){togglePlay();return;}void playPlaylist(playlist.id,sortPlaylistTracks(available,playlist.playback?.sort,playlist.customOrder),playlist.playback?.shuffle??false).catch(()=>notify('Couldn’t start this playlist. Try again.',true));}}>{active&&isLoading?<Loader2 size={20} className="animate-spin"/>:active&&isPlaying?<Pause size={20} fill="currentColor"/>:<Play size={20} fill="currentColor"/>}</button>}
          </div>;
        })}</div>
        {!!filter && !sorted.length && <div className="empty-state"><p>No playlists match “{filter}”.</p></div>}
      </> : tab === 'albums' ? (
        albums.length ? <AlbumCards fromLibrary albums={albums.map(album => ({ ...album, browseId: album.id }))} selection={selection ? { ids: selection, toggle } : undefined} /> :
        <div className="empty-state"><Disc3 size={27} />
          <h2>{filter ? 'No matching albums' : 'Save your favorite albums'}</h2>
          <p>{filter ? 'Try another album or artist.' : 'Open an album and choose Save to Library.'}</p>
          {!filter && <button className="action-button" onClick={() => navigate({ type: 'search' })}>Search music</button>}
        </div>
      ) : <>
        <button className="liked-collection" onClick={() => navigate({ type: 'liked' })}><span className="shortcut-icon favorite-icon"><Heart size={22} fill="currentColor" /></span><span><strong>Liked songs</strong><small>All your favorites, together</small></span></button>
        {!songs.length ? <div className="empty-state"><Search size={25} /><h2>{filter ? 'Nothing here yet' : 'Keep your favorites close.'}</h2><p>{filter ? 'Try a different song or artist.' : 'Songs you play, save, or download appear here.'}</p>{!filter && <button className="action-button" onClick={() => navigate({ type: 'search' })}>Discover music</button>}</div> : <div className="song-list">{songs.map((track, index) => <TrackRow key={track.id} track={track} index={index} tracksContext={songs} />)}</div>}
      </>}
    </div>
    <Overlay isOpen={!!action} onClose={closeAction} label={action === 'remove' ? 'Remove from Library' : 'Merge ' + libraryKind}>
      <form className="p-5 section-stack" onSubmit={applySelection}>
        <h2 className="text-xl font-semibold">{action === 'remove' ? 'Remove ' + selectedLabel + '?' : 'Merge ' + selectedLabel}</h2>
        {action === 'remove' ? <p className="text-sm text-zinc-400">Your songs and downloads will stay saved.</p> :
          <label className="grid gap-2 text-sm">New playlist name<input className="settings-input" value={mergeTitle} onChange={event => setMergeTitle(event.target.value)} disabled={busy} /></label>}
        {actionError && <p role="alert">{actionError}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" className="action-button" disabled={busy} onClick={closeAction}>Cancel</button>
          <button type="submit" className={action === 'remove' ? 'action-button text-rose-300' : 'primary-button'}
            disabled={busy || !selectedIds.length || (action === 'merge' && (selectedIds.length < 2 || !mergeTitle.trim()))}>{action === 'remove' ? 'Remove' : 'Merge'}</button>
        </div>
      </form>
    </Overlay>
  </div>;
};
