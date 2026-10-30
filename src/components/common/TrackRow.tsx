import { getSwipePlaylist, rememberSwipePlaylist } from '../../lib/swipePlaylist.js';
import React, { useEffect, useRef, useState } from 'react';
import { useSwipeGesture } from '../../hooks/useSwipeGesture.js';
import { AddToPlaylistSheet } from '../playlist/AddToPlaylistSheet.js';
import { Artwork } from './Artwork.js';
import { Overlay } from './Overlay.js';
import {
  Play,
  Pause,
  Heart,
  Download,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Plus,
  ListPlus,
  Trash2,
  X,
} from 'lucide-react';
import { Track } from '../../types/index.js';
import { useApp } from '../../context/AppContext.js';
import { usePlayer } from '../../hooks/usePlayer.js';
import { offlineManager } from '../../lib/offline/OfflineManager.js';
import { artistRoute, albumRoute } from '../../lib/ytmusic/catalog.js';
import { notify } from './ToastHost.js';
import { playUiSound } from '../../lib/uiFeedback.js';

interface TrackRowProps {
  track: Track;
  index: number;
  tracksContext?: Track[];
  showAlbum?: boolean;
  reason?: string;
  trailingAction?: React.ReactNode;
  queueSource?: import('../../types/index.js').QueueSource;
  onPlay?: () => void;
  onRemoveFromPlaylist?: () => Promise<void>;
}

type RowObserverState = { update: (visible: boolean) => void };
const observedRows = new Map<Element, RowObserverState>();
let preloadObserver: IntersectionObserver | null = null;
let viewportObserver: IntersectionObserver | null = null;
let fastScrollUntil = 0;
const scrollPositions = new WeakMap<Element, { top: number; time: number }>();
function watchRowScroll(event: Event) {
  const element = event.target;
  if (!(element instanceof Element)) return;
  const now = performance.now(), top = element.scrollTop, previous = scrollPositions.get(element);
  if (previous && Math.abs(top - previous.top) > 12 && Math.abs(top - previous.top) / Math.max(1, now - previous.time) > 0.65) fastScrollUntil = now + 240;
  scrollPositions.set(element, { top, time: now });
}
function observeSongRow(element: HTMLElement, update: (visible: boolean) => void) {
  if (!preloadObserver) {
    document.addEventListener('scroll', watchRowScroll, true);
    preloadObserver = new IntersectionObserver(entries => { for (const entry of entries) observedRows.get(entry.target)?.update(entry.isIntersecting); }, { rootMargin: '800px 0px' });
    viewportObserver = new IntersectionObserver(entries => { for (const entry of entries) { const row = entry.target as HTMLElement; if (!entry.isIntersecting) row.classList.remove('track-row-arriving'); else if (performance.now() < fastScrollUntil && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) row.classList.add('track-row-arriving'); } });
  }
  observedRows.set(element, { update }); preloadObserver.observe(element); viewportObserver!.observe(element);
  return () => { preloadObserver?.unobserve(element); viewportObserver?.unobserve(element); observedRows.delete(element); if (!observedRows.size) { preloadObserver?.disconnect(); viewportObserver?.disconnect(); preloadObserver = null; viewportObserver = null; document.removeEventListener('scroll', watchRowScroll, true); fastScrollUntil = 0; } };
}

export const TrackRow: React.FC<TrackRowProps> = (props) => {
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(68);
  useEffect(() => {
    const element = holder.current;
    if (!element || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    return observeSongRow(element, isVisible => { if (isVisible) setVisible(true); else { const measured = element.getBoundingClientRect().height; if (measured > 0) setHeight(measured); setVisible(false); } });
  }, []);
  return <div ref={holder} data-track-id={props.track.id} className="track-row-slot" onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'track-row-arrive') event.currentTarget.classList.remove('track-row-arriving'); }} style={!visible ? { minHeight: height } : undefined}>{visible && <TrackRowContent {...props}/>}</div>;
};

const TrackRowContent: React.FC<TrackRowProps> = ({
  track,
  index,
  tracksContext,
  showAlbum = true,
  reason,
  trailingAction,
  onRemoveFromPlaylist,
  onPlay,
  queueSource,
}) => {
  const {
    navigate,
    addTracksToLibrary,
    isFavorite,
    toggleFavorite,
    isDownloaded,
    isDownloading,
    downloadTrack,
    removeDownload,
    playlists,
    addTrackToPlaylist,
    isOnline,
  } = useApp();

  const { currentTrack, isPlaying, playTrack, togglePlay, playNext, addToQueue } = usePlayer();

  const [showMenu, setShowMenu] = useState(false);
  const [menuError, setMenuError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [downloadPulse, setDownloadPulse] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const swipeActionsRef = useRef<HTMLDivElement>(null);
  const swipeFrame = useRef<number | null>(null);
  useEffect(() => () => { if (swipeFrame.current !== null) cancelAnimationFrame(swipeFrame.current); }, []);
  const [picker, setPicker] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2000); return () => clearTimeout(timer); }, [notice]);
  const swipeSaving = useRef(false);
  const swipeToPlaylist = async () => {
    if (swipeSaving.current) return;
    const destination = playlists.find(playlist => playlist.id === getSwipePlaylist());
    if (!destination) { rememberSwipePlaylist(null); setPicker(true); return; }
    swipeSaving.current = true;
    try {
      await addTracksToLibrary([track]);
      await addTrackToPlaylist(destination.id, track.id);
      setNotice('Added to ' + destination.title);
    } catch { notify('Couldn’t add this song. Try again.', true); }
    finally { swipeSaving.current = false; }
  };
  const songGestures = useSwipeGesture({ lockHorizontal: true, maxDrag: 10000, onDrag: offset => { const row = rowRef.current; if (!row) return; if (swipeFrame.current !== null) cancelAnimationFrame(swipeFrame.current);
    // Theme row fills can be translucent: only expose actions in the strip
    // uncovered by an intentional horizontal drag, never through the row itself.
    const actions=swipeActionsRef.current;
    if(actions){
      if(offset===0){delete actions.dataset.direction;actions.style.clipPath='inset(0 100% 0 0)';}
      else{actions.dataset.direction=offset>0?'right':'left';const covered='max(0px, calc(100% - '+Math.abs(offset)+'px))';actions.style.clipPath=offset>0?'inset(0 '+covered+' 0 0)':'inset(0 0 0 '+covered+')';}
    }
    if (offset === 0) { swipeFrame.current = null; row.style.transition = 'transform .28s cubic-bezier(.2,.8,.2,1)'; row.style.transform = 'translate3d(0,0,0)'; } else { row.style.transition = 'none'; row.style.willChange = 'transform'; swipeFrame.current = requestAnimationFrame(() => { if (rowRef.current) rowRef.current.style.transform = `translate3d(${offset}px,0,0)`; swipeFrame.current = null; }); } }, exclude: 'button, a, [data-sonora-overlay]', onRight: () => { setNotice(addToQueue(track,queueSource) ? 'Added to queue' : 'Already in queue'); }, onLeft: () => { void swipeToPlaylist(); } });

  const isCurrent = currentTrack?.id === track.id;
  const isCurrentlyPlaying = isCurrent && isPlaying;
  const downloaded = isDownloaded(track.id);
  const downloading = isDownloading(track.id);
  const downloadState = offlineManager.getDownloadState(track.id);
  const favorite = isFavorite(track.id);

  const handlePlayClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-sonora-overlay]')) return;
    e.stopPropagation();
    playUiSound('tap');
    if (onPlay) { onPlay(); return; }
    if (isCurrent) {
      togglePlay();
    } else {
      playTrack(track, tracksContext);
    }
  };

  const handleDownloadToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    playUiSound(downloaded ? 'toggle' : 'download');
    setDownloadPulse((value) => value + 1);
    try { if (downloaded) { await removeDownload(track.id); notify("Download removed"); } else if (!downloading) { await downloadTrack(track); notify("Added to downloads"); } } catch { notify("Couldn’t update this download. Try again.", true); }
  };

  const formatBytes = (bytes: number) => bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const formatDuration = (seconds: number) => {
    if (!seconds || !Number.isFinite(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="song-row-shell relative overflow-hidden">
    <div ref={swipeActionsRef} aria-hidden="true" className="song-swipe-underlay absolute inset-0 flex items-center justify-between px-5"><span className="song-swipe-action"><ListPlus size={23}/>Queue</span><span className="song-swipe-action"><Plus size={23}/>Playlist</span></div>
    <div
      ref={rowRef}
      style={{touchAction:'pan-y'}}
      data-current={isCurrent}
      onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'transform') event.currentTarget.style.willChange = ''; }}
      {...songGestures}
      data-song-swipe
      role="group" tabIndex={0} aria-label={track.title + " by " + track.artist}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); if (onPlay) onPlay(); else if (isCurrent) togglePlay(); else playTrack(track, tracksContext); } }}
      id={`track-row-${track.id}`}
      onClick={handlePlayClick}
      className={`track-row group relative flex items-center gap-3 px-4 py-3 transition cursor-pointer select-none ${
        isCurrent
          ? 'bg-white/[0.07] text-white shadow-xs'
          : 'hover:bg-white/[0.05] text-zinc-300 hover:text-white'
      }`}
    >
      {/* Index or Play indicator */}
      <div className="w-8 shrink-0 flex items-center justify-center text-xs font-mono text-zinc-500">
        <button
          onClick={handlePlayClick}
          aria-label={(isCurrentlyPlaying ? "Pause " : "Play ") + track.title}
          className="w-7 h-7 rounded-full flex items-center justify-center transition group-hover:bg-blue-600 group-hover:text-white"
        >
          {isCurrentlyPlaying ? (
            <div className="flex items-end justify-center gap-0.5 h-3.5 w-3.5">
              <span className="w-0.5 bg-blue-400 animate-pulse h-full"></span>
              <span className="w-0.5 bg-blue-400 animate-pulse h-2/3"></span>
              <span className="w-0.5 bg-blue-400 animate-pulse h-4/5"></span>
            </div>
          ) : isCurrent ? (
            <Play className="w-3.5 h-3.5 fill-blue-400 text-blue-400" />
          ) : (
            <>
              <span className="group-hover:hidden">{index + 1}</span>
              <Play className="w-3.5 h-3.5 fill-white text-white hidden group-hover:block ml-0.5" />
            </>
          )}
        </button>
      </div>

      {/* Artwork thumbnail */}
      <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-zinc-900 border border-white/10">
        <Artwork
          track={track}
          alt={track.album}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Track Title & Artist */}
      <div className="song-row-copy flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={`text-sm font-medium truncate ${
              isCurrent ? 'text-blue-400 font-semibold' : 'text-zinc-100 group-hover:text-white'
            }`}
          >
            {track.title}
          </p>
          {downloaded && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.2 text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 rounded-sm font-medium hidden sm:inline">
              Offline
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-400 truncate mt-0.5">
          <button className="artist-link" onClick={e=>{e.stopPropagation();navigate(artistRoute(track));}}>{track.artist}</button>
          {showAlbum && track.album && (
            <span className="text-zinc-600 hidden md:inline"> • {track.album}</span>
          )}
        </p>
        {reason && <p className="text-[11px] text-zinc-500 truncate mt-0.5">{reason}</p>}
        {downloadState?.status === 'failed' && (
          <p role="alert" className="text-xs text-rose-300 mt-1 break-words">
            {downloadState.error || 'Download failed. Please try again.'}
          </p>
        )}

      </div>

      {/* Album name column (desktop) */}
      {showAlbum && (
        <div className="hidden lg:block w-48 truncate text-xs text-zinc-400">
          {track.album}
        </div>
      )}

      {/* Download Action & Progress */}
      <div className="song-row-actions flex items-center gap-2 shrink-0">
        {downloading ? (
          <button
            className="player-icon text-blue-400"
            title="Cancel download"
            aria-label="Cancel download"
            onClick={e => { e.stopPropagation(); offlineManager.cancelDownload(track.id); notify('Download cancelled'); }}
          >
            <X className="w-4 h-4" />
          </button>
        ) : downloaded ? (
          <button
            key={`downloaded-${downloadPulse}`}
            onClick={handleDownloadToggle}
            className="p-1.5 text-emerald-400 hover:text-rose-400 rounded-lg transition active:scale-90"
            title="Downloaded offline. Click to remove from local storage."
          >
            <CheckCircle2 className="w-4 h-4" />
          </button>
        ) : (
          <button
            key={`download-${downloadPulse}`}
            onClick={handleDownloadToggle}
            disabled={!isOnline}
            className={`download-pop p-1.5 text-zinc-500 hover:text-white rounded-lg transition active:scale-90 ${
              !isOnline ? 'opacity-30 cursor-not-allowed' : 'opacity-0 group-hover:opacity-100'
            }`}
            title={isOnline ? (downloadState?.status === 'failed' ? 'Retry download' : 'Download for offline playback') : 'Connect online to download'}
          >
            <Download className="w-4 h-4" />
          </button>
        )}

        {/* Favorite Heart */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            playUiSound(favorite ? 'toggle' : 'success');
            void addTracksToLibrary([track]).then(() => toggleFavorite(track.id)).then(() => notify(favorite ? 'Removed from liked songs' : 'Saved to liked songs')).catch(() => notify('Couldn’t save this song. Try again.', true));
          }}
          className={`p-1.5 transition ${
            favorite
              ? 'text-rose-500 hover:text-rose-400'
              : 'text-zinc-500 hover:text-white opacity-0 group-hover:opacity-100'
          }`}
          title={favorite ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
        >
          <Heart className={`w-4 h-4 ${favorite ? 'fill-rose-500' : ''}`} />
        </button>

        {/* Duration */}
        <span className={`text-xs font-mono text-zinc-500 w-10 text-right ${downloading ? 'hidden sm:inline' : ''}`}>
          {formatDuration(track.duration)}
        </span>

        {trailingAction}

        {/* Context Menu Button */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1.5 text-zinc-500 hover:text-white rounded-lg opacity-0 group-hover:opacity-100 transition"
            title="More options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>


          {showMenu && <Overlay isOpen onClose={() => setShowMenu(false)} label={"Options for " + track.title}>
            <div className="song-menu-actions w-full p-5 space-y-1 text-sm text-zinc-200" onClick={e => e.stopPropagation()}>
              <header className="song-menu-header"><Artwork track={track}/><div><strong>{track.title}</strong><small>{track.artist}</small></div><button className="player-icon" aria-label="Close song options" onClick={() => setShowMenu(false)}><X size={20}/></button></header>
              <button onClick={async () => { try { await addTracksToLibrary([track]); await toggleFavorite(track.id); setShowMenu(false); notify(favorite ? 'Removed from liked songs' : 'Saved to liked songs'); } catch { setMenuError('Couldn’t save this song. Try again.'); } }} className="w-full flex items-center px-2.5 rounded-lg hover:bg-white/10"><Heart size={19} fill={favorite ? 'currentColor' : 'none'}/><span>{favorite ? 'Remove from Liked Songs' : 'Save to Liked Songs'}</span></button>
              <button onClick={() => { playNext(track,queueSource); setShowMenu(false); notify('Playing next'); }} className="w-full flex items-center px-2.5 rounded-lg hover:bg-white/10"><Play size={19}/><span>Play Next</span></button>
              <button onClick={() => { const added = addToQueue(track,queueSource); setShowMenu(false); notify(added ? 'Added to queue' : 'Already in queue'); }} className="w-full flex items-center px-2.5 rounded-lg hover:bg-white/10"><ListPlus size={19}/><span>Add to Queue</span></button>
              <button onClick={()=>{setShowMenu(false);navigate(artistRoute(track));}} className="w-full flex items-center px-2.5 rounded-lg hover:bg-white/10"><span className="menu-catalog-symbol" aria-hidden="true">↗</span><span>Go to artist</span></button>
              {track.album && !["YouTube Music","YouTube Video"].includes(track.album) && <button onClick={()=>{setShowMenu(false);navigate(albumRoute(track));}} className="w-full flex items-center px-2.5 rounded-lg hover:bg-white/10"><span className="menu-catalog-symbol" aria-hidden="true">◉</span><span>Go to album</span></button>}
              <button onClick={() => { setShowMenu(false); setPicker(true); }} className="w-full flex items-center px-2.5 rounded-lg hover:bg-white/10"><Plus size={19}/><span>Add to Playlist</span></button>
              <button disabled={!isOnline && !downloaded && !downloading} onClick={async e => { if(downloading){offlineManager.cancelDownload(track.id);notify('Download cancelled');}else await handleDownloadToggle(e);setShowMenu(false); }} className="w-full flex items-center px-2.5 rounded-lg hover:bg-white/10"><Download size={19}/><span>{downloading ? 'Cancel download' : downloaded ? 'Remove Offline File' : 'Download song'}</span></button>
              {onRemoveFromPlaylist && <button disabled={removing} onClick={async () => { setRemoving(true); setMenuError(''); try { await onRemoveFromPlaylist(); setShowMenu(false); notify('Removed from playlist'); } catch { setMenuError('Could not remove this song. Please try again.'); setRemoving(false); } }} className="w-full flex items-center px-2.5 rounded-lg text-rose-300 hover:bg-white/10"><Trash2 size={19}/><span>{removing ? 'Removing…' : 'Remove from playlist'}</span></button>}
              {menuError && <p role="alert" className="px-2.5 text-rose-300">{menuError}</p>}
            </div>
          </Overlay>}
        </div>
      </div>
      {downloading && <span className="row-download-meter" role="progressbar" aria-label={"Download progress for " + track.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadState?.progress || 0}><span style={{width: Math.max(2,downloadState?.progress || 0) + "%"}}/></span>}
      {notice && <span role="status" className="song-notice">{notice}</span>}
      {picker && <AddToPlaylistSheet track={track} isOpen onClose={() => setPicker(false)} />}
    </div></div>
  );
};
