import {CustomPlaylistOrder} from '../components/playlist/CustomPlaylistOrder.js';
import {sortPlaylistTracks} from '../lib/playlistOrder.js';
import { readPlaylistCover } from '../lib/playlistCover.js';
import { ImportProgressAuto as ImportProgress } from '../components/playlist/ImportProgressAuto.js';
import { PlaylistTools } from '../components/playlist/PlaylistTools.js';
import { PlaylistSuggestions } from '../components/playlist/PlaylistSuggestions.js';
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Shuffle, Download, CheckCircle2, Trash2, Plus, Search, X, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { usePlayer } from '../hooks/usePlayer.js';
import { TrackRow } from '../components/common/TrackRow.js';
import { PlaylistCover } from '../components/common/PlaylistCover.js';
import { Artwork } from '../components/common/Artwork.js';
import { Overlay } from '../components/common/Overlay.js';
import { notify } from '../components/common/ToastHost.js';
import { offlineManager } from '../lib/offline/OfflineManager.js';
import type { Track } from '../types/index.js';

export const PlaylistDetailView: React.FC<{ playlistId: string }> = ({ playlistId }) => {
  const { playlists, tracks: allTracks, navigate, deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, downloadPlaylist, removePlaylistDownload, isOnline, updatePlaylist } = useApp();
  const { playPlaylist, currentTrack, playlistId: activePlaylist, togglePlay } = usePlayer();
  const coverInput = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, setRevision] = useState(0);
  useEffect(() => offlineManager.subscribe(() => setRevision(n => n + 1)), []);
  const playlist = playlists.find(p => p.id === playlistId);
  useEffect(() => { if (currentTrack && playlist?.trackIds.includes(currentTrack.id)) void updatePlaylist(playlistId, { lastPlayedAt: Date.now() }); }, [playlistId, currentTrack?.id]);
  if (!playlist) return <div className="empty-state"><h2>Playlist not found.</h2><p>It may have been removed from your library.</p><button className="action-button" onClick={() => navigate({ type: 'library' })}>Back to Library</button></div>;
  const playlistTracks = playlist.trackIds.map(id => allTracks.find(t => t.id === id)).filter((t): t is Track => !!t);
  const sort = playlist.playback?.sort || 'date-new';
  const ordered = sortPlaylistTracks(playlistTracks,sort,playlist.customOrder);
  const shown = ordered.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(filter.toLowerCase()));
  const downloadProgress = offlineManager.getPlaylistDownloadProgress(playlist);
  const allDownloaded = downloadProgress.total > 0 && downloadProgress.completed === downloadProgress.total;
  const downloadingCount = playlistTracks.filter(t => offlineManager.isTrackDownloading(t.id)).length;
  const downloadedCount = playlistTracks.filter(t => offlineManager.isTrackDownloaded(t.id)).length;
  const failedCount = playlistTracks.filter(t => offlineManager.getDownloadState(t.id)?.status === 'failed').length;
  const minutes = Math.round(playlistTracks.reduce((n, t) => n + (t.duration || 0), 0) / 60);
  const play = (shuffle = playlist.playback?.shuffle ?? false) => {
    void playPlaylist(playlist.id,ordered,shuffle).catch(()=>notify('Couldn’t start this playlist. Try again.',true));
  };
  const candidates = allTracks.filter(t => !playlist.trackIds.includes(t.id) && (t.title + ' ' + t.artist).toLowerCase().includes(searchFilter.toLowerCase()));
  const renderSong=(track:Track,index:number)=><TrackRow key={track.id} track={track} index={index} tracksContext={shown} queueSource={{playlistId:playlist.id,tracks:ordered,shuffle:playlist.playback?.shuffle??false}} onPlay={()=>{if(activePlaylist===playlist.id&&currentTrack?.id===track.id)togglePlay();else void playPlaylist(playlist.id,ordered,playlist.playback?.shuffle??false,track).catch(()=>notify('Couldn’t start this song. Try again.',true));}} reason={playlist.estimatedMatches?.some(match => match.trackId === track.id) ? 'Estimated match · top search result' : undefined} onRemoveFromPlaylist={() => removeTrackFromPlaylist(playlist.id, track.id)}/>;
  return <div id="playlist-detail-view" className="page-stack">
    <button className="text-button self-start" onClick={() => navigate({ type: 'library' })}><ArrowLeft size={17}/><span>Back</span></button>
    <div className="collection-hero playlist-hero-enter relative flex flex-col sm:flex-row items-center sm:items-end">
      <div className="absolute top-3 left-3 right-3 flex items-center gap-1" aria-label="Playlist actions"><PlaylistTools playlist={playlist}/><button className="player-icon" aria-label="Add songs" title="Add songs" onClick={() => setShowAddModal(true)}><Plus size={20}/></button>
        {playlistTracks.length > 0 && <button className="player-icon ml-auto" aria-label={downloadingCount ? 'Cancel playlist downloads, ' + downloadedCount + ' of ' + playlistTracks.length + ' complete' : allDownloaded ? 'Remove playlist download' : 'Download playlist'} title={downloadingCount ? 'Cancel playlist downloads' : allDownloaded ? 'Remove playlist download' : 'Download playlist'} disabled={!isOnline && !allDownloaded && !downloadingCount} onClick={async () => { try { if (downloadingCount) { offlineManager.cancelPlaylistDownloads(playlist); notify('Downloads cancelled'); } else if (allDownloaded) await removePlaylistDownload(playlist); else { await downloadPlaylist(playlist); notify('Playlist added to downloads'); } } catch { notify('Couldn’t update downloads. Try again.', true); } }}>{downloadingCount ? <Loader2 className="animate-spin" size={19}/> : allDownloaded ? <CheckCircle2 size={19}/> : <Download size={19}/>}</button>}
      </div>
      <button className="playlist-hero-cover-control" aria-label="Change playlist cover" title="Change playlist cover" disabled={coverBusy} onClick={() => coverInput.current?.click()}>
        <PlaylistCover playlist={playlist} tracks={allTracks} className="playlist-hero-cover"/>
      </button>
      <input ref={coverInput} className="sr-only" tabIndex={-1} aria-label="Playlist cover photo" type="file" accept="image/*" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setCoverBusy(true); setCoverError('');
        try { const artworkUrl = await readPlaylistCover(file); if(!artworkUrl)return; await updatePlaylist(playlist.id, {artworkUrl}); notify('Playlist cover updated'); }
        catch (reason) { setCoverError(reason instanceof Error ? reason.message : 'Couldn’t save that photo.'); }
        finally { setCoverBusy(false); }
      }}/>
      <div className="playlist-hero-info flex-1 min-w-0 text-left"><h1 className="text-3xl sm:text-5xl">{playlist.title}</h1>{playlist.description && <p className="text-sm text-zinc-400 mt-3 leading-relaxed">{playlist.description}</p>}<p className="text-xs text-zinc-400 mt-3">{playlistTracks.length} {playlistTracks.length === 1 ? 'song' : 'songs'}{minutes > 0 ? ' · ' + minutes + ' min' : ''}</p>
        <div className="flex flex-wrap items-center justify-start gap-2 mt-5"><button className="primary-button" disabled={!playlistTracks.length} onClick={() => play()}><Play size={17} fill="currentColor"/>Play</button><button className="action-button" disabled={!playlistTracks.length} aria-pressed={playlist.playback?.shuffle??false} onClick={() => play(!(playlist.playback?.shuffle??false))}><Shuffle size={17}/>Shuffle</button><button className="player-icon" title="Delete playlist" aria-label="Delete playlist" onClick={() => { setError(''); setShowDelete(true); }}><Trash2 size={18}/></button></div>
      </div>
    </div>
    {coverError && <p role="alert" className="text-sm text-rose-300">{coverError}</p>}
    {(playlist.keepDownloaded || downloadedCount > 0 || downloadingCount > 0) && <div className="playlist-offline-status">
      <div className="playlist-download-progress" role="progressbar" aria-label="Playlist download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number((downloadProgress.fraction*100).toFixed(2))} aria-valuetext={downloadProgress.completed+' of '+downloadProgress.total+' songs saved'}><span style={{width:(downloadProgress.fraction*100)+'%'}}/></div>
    </div>}
    {failedCount > 0 && <p role="alert" className="text-sm text-rose-300">{failedCount} downloads couldn’t finish. Tap the download icon to retry.</p>}
    {playlist.source && <ImportProgress playlistId={playlist.id}/>}
    <section className="section-stack">
      <div className="section-heading"><h2>Tracks</h2><button className="text-button" onClick={() => setShowAddModal(true)}><Plus size={16}/>Add songs</button></div>
      <label className="playlist-sort">Sort by<select aria-label="Sort playlist" value={sort} onChange={e => void updatePlaylist(playlist.id,{playback:{sort:e.target.value as import('../types/index.js').PlaylistSort}})}><option value="custom">Custom order</option><option value="date-new">Date added · newest first</option><option value="date-old">Date added · oldest first</option><option value="artist">Artist</option><option value="album">Album name</option><option value="title">Title</option></select></label>
      {playlistTracks.length > 8 && <div className="search-field compact-search playlist-filter"><Search size={18}/><input aria-label="Find in playlist" placeholder="Find in this playlist…" value={filter} onChange={e => setFilter(e.target.value)}/>{filter && <button aria-label="Clear playlist filter" onClick={() => setFilter('')}><X size={16}/></button>}</div>}
      {!playlistTracks.length ? <div className="empty-state"><h2>Start with a song.</h2><p>Build a little world of your own.</p><button className="action-button" onClick={() => setShowAddModal(true)}><Plus size={16}/>Add saved songs</button><button className="text-button" onClick={() => navigate({ type: 'search' })}>Find something new</button></div> : !shown.length ? <div className="empty-state"><p>No songs match “{filter}”.</p></div> : <div>{sort==='custom'&&!filter?<CustomPlaylistOrder tracks={shown} renderTrack={renderSong} onSave={ids=>updatePlaylist(playlist.id,{customOrder:ids})}/>:<div className="song-list">{shown.map(renderSong)}</div>}</div>}
    </section>
    <PlaylistSuggestions playlist={playlist}/>
    <Overlay isOpen={showAddModal} onClose={() => setShowAddModal(false)} label="Add Songs to Playlist"><div className="p-5 section-stack"><header className="section-heading"><div><p className="eyebrow">BUILD YOUR PLAYLIST</p><h2>Add songs</h2></div><button className="player-icon" aria-label="Close add songs" onClick={() => setShowAddModal(false)}><X size={22}/></button></header><div className="search-field"><Search size={18}/><input aria-label="Filter saved songs" placeholder="Filter songs by title or artist…" value={searchFilter} onChange={e => setSearchFilter(e.target.value)}/></div><div className="add-candidates">{candidates.length ? candidates.map(track => <div key={track.id} className="add-song-row"><Artwork track={track}/><span><strong>{track.title}</strong><small>{track.artist}</small></span><button className="player-icon" aria-label={'Add ' + track.title} onClick={async () => { try { await addTrackToPlaylist(playlist.id, track.id); notify('Added to ' + playlist.title); } catch { notify('Couldn’t add this song. Try again.', true); } }}><Plus size={21}/></button></div>) : <div className="empty-state"><p>{allTracks.length ? 'No more matching songs to add.' : 'Discover some songs to start your collection.'}</p><button className="action-button" onClick={() => { setShowAddModal(false); navigate({ type: 'search' }); }}>Search music</button></div>}</div></div></Overlay>
    <Overlay isOpen={showDelete} onClose={() => !busy && setShowDelete(false)} label="Delete playlist"><div className="p-6 section-stack"><h2 className="text-xl font-semibold">Delete “{playlist.title}”?</h2><p className="text-sm text-zinc-400 leading-relaxed">This removes the playlist from your library. Your songs and downloads stay saved.</p>{error && <p role="alert">{error}</p>}<div className="flex gap-3 justify-end"><button className="action-button" disabled={busy} onClick={() => setShowDelete(false)}>Keep playlist</button><button className="action-button text-rose-300" disabled={busy} onClick={async () => { setBusy(true); try { await deletePlaylist(playlist.id); setShowDelete(false); navigate({ type: 'library' }); notify('Playlist deleted'); } catch { setError('Couldn’t delete this playlist. Try again.'); } finally { setBusy(false); } }}>{busy ? 'Deleting…' : 'Delete playlist'}</button></div></div></Overlay>
  </div>;
};
