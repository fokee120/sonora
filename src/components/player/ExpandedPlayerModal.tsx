import { AeroAtmosphere } from './AeroAtmosphere.js';
import { ComicStage } from '../common/ComicScene.js';
import {Maximize2} from 'lucide-react';
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, FileText, ListMusic, ListPlus, Loader2 } from 'lucide-react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Heart } from '../common/ThemeIcons.js';
import { albumRoute, artistRoute } from '../../lib/ytmusic/catalog.js';
import { usePlayer } from '../../hooks/usePlayer.js';
import { useApp } from '../../context/AppContext.js';
import { Overlay } from '../common/Overlay.js';
import { SeekBar } from './SeekBar.js';
import {useSongLyrics} from '../../lib/lyrics.js';
import {LyricsPanel} from './LyricsPanel.js';
import {RetroArcade} from './RetroArcade.js';
import {ScrollingTitle} from './ScrollingTitle.js';
import { TrackSlide, TrackTransition } from './TrackSlide.js';
import {AddToPlaylistSheet} from '../playlist/AddToPlaylistSheet.js';
import type {Track} from '../../types/index.js';
import { notify } from '../common/ToastHost.js';
import { useAppearance } from '../../lib/appearance.js';

interface Props { isOpen: boolean; onClose: () => void; onOpenQueue: () => void; onOpenImmersive?:()=>void; }
export const ExpandedPlayerModal: React.FC<Props> = ({ isOpen, onClose, onOpenQueue,onOpenImmersive }) => {
  const { playlistId,playlistProfileId,currentTrack, isPlaying, isLoading, error, togglePlay, next, previous, shuffle, toggleShuffle, repeatMode, cycleRepeatMode, playbackSource } = usePlayer({progress:false,subscribeQueue:false});
  const { navigate, isFavorite, toggleFavorite, addTracksToLibrary } = useApp();
  const {style: themeStyle, comicHeroId} = useAppearance();
  const [lyrics, setLyrics] = useState(false);
  const [playlistTrack,setPlaylistTrack]=useState<Track|null>(null);
  useEffect(()=>{if(!isOpen)setPlaylistTrack(null);},[isOpen]);
  const songLyrics=useSongLyrics(currentTrack,isOpen);
  useEffect(()=>setLyrics(false),[currentTrack?.id,isOpen]);
  const artworkTilt = useMemo(() => (Math.random() < .5 ? -1 : 1) * (1 + Math.random() * 3), [currentTrack?.id]);
  const [ambience, setAmbience] = useState<{ id: string; gradient: string } | null>(null);
  const activeTrack = React.useRef(currentTrack?.id);
  activeTrack.current = currentTrack?.id;
  const artworkLoaded = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const id = currentTrack?.id;
    if (!id || activeTrack.current !== id || (themeStyle !== 'classic' && themeStyle !== 'aero')) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(event.currentTarget, 0, 0, 2, 2);
      const pixels = context.getImageData(0, 0, 2, 2).data;
      const color = (offset: number) => 'rgb(' + [...pixels.subarray(offset, offset + 3)].join(' ') + ')';
      const gradient = 'radial-gradient(ellipse at 12% 12%, ' + color(0) + ', transparent 68%), radial-gradient(ellipse at 88% 16%, ' + color(4) + ', ' + color(12) + ')';
      setAmbience(previous => previous?.id === id && previous.gradient === gradient ? previous : { id, gradient });
    } catch { /* Cross-origin covers may only be sampled after their cached copy loads. */ }
  }, [currentTrack?.id, themeStyle]);
  if (!currentTrack) return null;
  const favorite = isFavorite(currentTrack.id);
  const comics = themeStyle === 'comics';
  const hasAlbum = currentTrack.albumId || (currentTrack.album?.trim() && !['YouTube Music', 'YouTube Video'].includes(currentTrack.album));
  const cover = <div className="player-artwork" style={{'--artwork-tilt': artworkTilt + 'deg'} as React.CSSProperties}>
    <TrackSlide track={currentTrack} expanded onArtworkLoad={artworkLoaded}/>
    {hasAlbum && <button type="button" className="player-cover-link" data-player-cover-link
      aria-label={currentTrack.album ? 'Open album ' + currentTrack.album : 'Open album'}
      onClick={() => { onClose(); navigate(albumRoute(currentTrack)); }} />}
  </div>;
  const title = comics
    ? <span className="comic-song-title" title={currentTrack.title}>{currentTrack.title}</span>
    : <ScrollingTitle text={currentTrack.title}/>;
  return <Overlay isOpen={isOpen} onClose={onClose} label="Now playing" id="expanded-player-modal" variant="player">
    {themeStyle === 'aero' && <AeroAtmosphere mode="expanded"/>}
    {themeStyle === 'gotham' ? <div className="gotham-player-scene" aria-hidden="true"><div className="gotham-rain"><i/><i/></div></div> : themeStyle === 'comics' ? null : <div className="player-ambience" aria-hidden="true"><AnimatePresence initial={false}>{ambience&&<motion.div key={ambience.id} className="player-ambience-color" style={{background:ambience.gradient}} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:.25}}/>}</AnimatePresence></div>}
    <div className={'now-playing-content'+(songLyrics?' has-lyrics':'')}><div className="player-primary-panel">
      <header className="now-playing-header">
        <button className="player-icon" title="Minimize player" onClick={onClose}><ChevronDown size={26} /></button>
        <div><p>NOW PLAYING</p><span>{playbackSource === 'local' ? 'Playing from this device' : 'In your own world'}</span></div>
        <div className="flex items-center"><button className="player-icon" aria-label="Open fullscreen listening" onClick={onOpenImmersive}><Maximize2 size={20}/></button>{songLyrics?<button className="player-icon" title="Open lyrics" onClick={()=>setLyrics(true)}><FileText size={20}/></button>:<span className="player-header-spacer"/>}</div>
      </header>
      {themeStyle==='retro'&&<RetroArcade playing={isPlaying}/> }
      <div className="player-art-stage">
        {comics ? <ComicStage heroId={comicHeroId}>{cover}</ComicStage> : cover}
      </div>
      <div className="player-song-heading">
        <TrackTransition id={currentTrack.id} viewport="player-track-label" frame="player-heading-frame" travel={32}>
          {playlistId?<h1><button className="expanded-title-link" aria-label={'Open source playlist for '+currentTrack.title} onClick={()=>{onClose();navigate({type:'playlist',id:playlistId,...(playlistProfileId?{profileId:playlistProfileId}:{})});}}>{title}</button></h1>:comics?<h1>{title}</h1>:<ScrollingTitle as="h1" text={currentTrack.title}/>}
          <button className="expanded-artist-link" onClick={()=>{onClose();navigate(artistRoute(currentTrack));}}>{currentTrack.artist}</button>
        </TrackTransition>
        <motion.button whileTap={{ scale: 0.8 }} className="player-icon" title={favorite ? 'Unlike song' : 'Like song'} aria-pressed={favorite} onClick={() => void addTracksToLibrary([currentTrack]).then(() => toggleFavorite(currentTrack.id)).then(() => notify(favorite ? "Removed from liked songs" : "Saved to liked songs")).catch(() => notify("Couldn’t save this song.", true))}>
          <Heart size={25} fill={favorite ? 'currentColor' : 'none'} />
        </motion.button>
      </div>
      <div className="player-console contents"><div className="player-timeline"><SeekBar />
        <div className="player-status" aria-live="polite">
          {error ? <p role="alert">{error}</p> : isLoading ? <p role="status">{isPlaying ? 'Buffering…' : 'Loading audio…'}</p> : null}
        </div>
      </div>
      <div className="player-transport">
        <button className="player-icon" title={`Shuffle: ${shuffle ? 'On' : 'Off'}`} aria-pressed={shuffle} onClick={toggleShuffle}><Shuffle size={22} /></button>
        <button className="player-icon" title="Previous track" onClick={previous}><SkipBack size={30} fill="currentColor" /></button>
        <motion.button whileTap={{ scale: 0.9 }} className="player-main-play" onClick={togglePlay} aria-label={isLoading ? 'Cancel loading' : isPlaying ? 'Pause' : error ? 'Retry playback' : 'Play'}>
          {isLoading ? <Loader2 size={31} className="animate-spin" /> : isPlaying ? <Pause size={31} fill="currentColor" /> : <Play size={31} fill="currentColor" />}
        </motion.button>
        <button className="player-icon" title="Next track" onClick={next}><SkipForward size={30} fill="currentColor" /></button>
        <button className="player-icon" title={`Repeat: ${repeatMode}`} aria-pressed={repeatMode !== 'off'} onClick={cycleRepeatMode}>{repeatMode === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}</button>
      </div>
      <footer className="player-footer">
        <button className="player-icon" title="Add to playlist" onClick={()=>setPlaylistTrack(currentTrack)}><ListPlus size={21}/><span>Add to playlist</span></button>
        <button className="player-icon" title="Queue" onClick={() => { onClose(); onOpenQueue(); }}><ListMusic size={21}/><span>Up next</span></button>
      </footer></div></div>
      {songLyrics&&<button className="lyrics-preview" onClick={()=>setLyrics(true)}><span className="eyebrow">{songLyrics.lines.length?'TIME-SYNCED LYRICS':'LYRICS'}</span><strong>{songLyrics.plain.split('\n').filter(Boolean).slice(0,2).join('\n')}</strong><span>Open lyrics</span></button>}
    </div>
    {playlistTrack&&<AddToPlaylistSheet track={playlistTrack} isOpen onClose={()=>setPlaylistTrack(null)}/>}
    <Overlay isOpen={lyrics&&!!songLyrics} onClose={()=>setLyrics(false)} label="Lyrics">{songLyrics&&<LyricsPanel key={currentTrack.id} lyrics={songLyrics} title={currentTrack.title} artist={currentTrack.artist} artworkUrl={currentTrack.artworkUrl} trackId={currentTrack.id} onClose={()=>setLyrics(false)}/>}</Overlay>
  </Overlay>;
};
