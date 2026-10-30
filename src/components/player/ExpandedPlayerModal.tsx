import React, { useState, useContext, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, FileText, ListMusic, ListPlus, Loader2 } from 'lucide-react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Heart } from '../common/ThemeIcons.js';
import { artistRoute } from '../../lib/ytmusic/catalog.js';
import { PlayerMotionContext } from './PlayerMotionContext.js';
import { usePlayer } from '../../hooks/usePlayer.js';
import { useApp } from '../../context/AppContext.js';
import { Overlay } from '../common/Overlay.js';
import { SeekBar } from './SeekBar.js';
import {useSongLyrics} from '../../lib/lyrics.js';
import {LyricsPanel} from './LyricsPanel.js';
import {RetroArcade} from './RetroArcade.js';
import {ScrollingTitle} from './ScrollingTitle.js';
import { TrackSlide } from './TrackSlide.js';
import {AddToPlaylistSheet} from '../playlist/AddToPlaylistSheet.js';
import type {Track} from '../../types/index.js';
import { notify } from '../common/ToastHost.js';
import { useAppearance } from '../../lib/appearance.js';
import { Artwork } from '../common/Artwork.js';

interface Props { isOpen: boolean; onClose: () => void; onOpenQueue: () => void; }
export const ExpandedPlayerModal: React.FC<Props> = ({ isOpen, onClose, onOpenQueue }) => {
  const { playlistId,playlistProfileId,currentTrack, isPlaying, isLoading, error, togglePlay, next, previous, shuffle, toggleShuffle, repeatMode, cycleRepeatMode, playbackSource } = usePlayer({progress:false});
  const { navigate, isFavorite, toggleFavorite, addTracksToLibrary } = useApp();
  const dragX = useContext(PlayerMotionContext);
  const {style: themeStyle} = useAppearance();
  const [lyrics, setLyrics] = useState(false);
  const [playlistTrack,setPlaylistTrack]=useState<Track|null>(null);
  useEffect(()=>{if(!isOpen)setPlaylistTrack(null);},[isOpen]);
  const songLyrics=useSongLyrics(currentTrack,isOpen);
  useEffect(()=>setLyrics(false),[currentTrack?.id,isOpen]);
  const artworkTilt = useMemo(() => (Math.random() < .5 ? -1 : 1) * (1 + Math.random() * 3), [currentTrack?.id]);
  if (!currentTrack) return null;
  const favorite = isFavorite(currentTrack.id);
  return <Overlay isOpen={isOpen} onClose={onClose} label="Now playing" id="expanded-player-modal" variant="player">
    {themeStyle === 'gotham' ? <div className="gotham-player-scene" aria-hidden="true"><div className="gotham-rain"><i/><i/></div></div> : <div className="player-ambience" aria-hidden="true"><Artwork track={currentTrack} /></div>}
    <div className={'now-playing-content'+(songLyrics?' has-lyrics':'')}><div className="player-primary-panel">
      <header className="now-playing-header">
        <button className="player-icon" title="Minimize player" onClick={onClose}><ChevronDown size={26} /></button>
        <div><p>NOW PLAYING</p><span>{playbackSource === 'local' ? 'Playing from this device' : 'In your own world'}</span></div>
        {songLyrics?<button className="player-icon" title="Open lyrics" onClick={()=>setLyrics(true)}><FileText size={20}/></button>:<span className="player-header-spacer"/>}
      </header>
      {themeStyle==='retro'&&<RetroArcade playing={isPlaying}/> }
      <div className="player-art-stage">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key="artwork" className="player-artwork" style={{'--artwork-tilt': artworkTilt + 'deg'} as React.CSSProperties}><TrackSlide expanded /></motion.div>
        </AnimatePresence>
      </div>
      <div className="player-song-heading">
        <motion.div className="player-track-label" style={dragX ? {x:dragX} : undefined}><AnimatePresence initial={false} mode="popLayout"><motion.div key={currentTrack.id} initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -22 }} transition={{ duration: .28 }}>{playlistId?<h1><button className="expanded-title-link" aria-label={'Open source playlist for '+currentTrack.title} onClick={()=>{onClose();navigate({type:'playlist',id:playlistId,...(playlistProfileId?{profileId:playlistProfileId}:{})});}}><ScrollingTitle text={currentTrack.title}/></button></h1>:<ScrollingTitle as="h1" text={currentTrack.title}/>}<button className="expanded-artist-link" onClick={()=>{onClose();navigate(artistRoute(currentTrack));}}>{currentTrack.artist}</button></motion.div></AnimatePresence></motion.div>
        <motion.button whileTap={{ scale: 0.8 }} className="player-icon" title={favorite ? 'Unlike song' : 'Like song'} aria-pressed={favorite} onClick={() => void addTracksToLibrary([currentTrack]).then(() => toggleFavorite(currentTrack.id)).then(() => notify(favorite ? "Removed from liked songs" : "Saved to liked songs")).catch(() => notify("Couldn’t save this song.", true))}>
          <Heart size={25} fill={favorite ? 'currentColor' : 'none'} />
        </motion.button>
      </div>
      <div className="player-timeline"><SeekBar />
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
      </footer></div>
      {songLyrics&&<button className="lyrics-preview" onClick={()=>setLyrics(true)}><span className="eyebrow">{songLyrics.lines.length?'TIME-SYNCED LYRICS':'LYRICS'}</span><strong>{songLyrics.plain.split('\n').filter(Boolean).slice(0,2).join('\n')}</strong><span>Open lyrics</span></button>}
    </div>
    {playlistTrack&&<AddToPlaylistSheet track={playlistTrack} isOpen onClose={()=>setPlaylistTrack(null)}/>}
    <Overlay isOpen={lyrics&&!!songLyrics} onClose={()=>setLyrics(false)} label="Lyrics">{songLyrics&&<LyricsPanel lyrics={songLyrics} title={currentTrack.title} onClose={()=>setLyrics(false)}/>}</Overlay>
  </Overlay>;
};
