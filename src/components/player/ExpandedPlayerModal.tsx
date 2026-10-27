import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Heart, FileText, ListMusic, Download, CheckCircle2, Loader2 } from 'lucide-react';
import { usePlayer } from '../../hooks/usePlayer.js';
import { useApp } from '../../context/AppContext.js';
import { Overlay } from '../common/Overlay.js';
import { SeekBar } from './SeekBar.js';
import { TrackSlide } from './TrackSlide.js';
import { Artwork } from '../common/Artwork.js';

interface Props { isOpen: boolean; onClose: () => void; onOpenQueue: () => void; }
export const ExpandedPlayerModal: React.FC<Props> = ({ isOpen, onClose, onOpenQueue }) => {
  const { currentTrack, isPlaying, isLoading, error, togglePlay, next, previous, shuffle, toggleShuffle, repeatMode, cycleRepeatMode, playbackSource } = usePlayer();
  const { isFavorite, toggleFavorite, isDownloaded, downloadTrack, removeDownload } = useApp();
  const [lyrics, setLyrics] = useState(false);
  if (!currentTrack) return null;
  const favorite = isFavorite(currentTrack.id), downloaded = isDownloaded(currentTrack.id);
  return <Overlay isOpen={isOpen} onClose={onClose} label="Now playing" id="expanded-player-modal" variant="player">
    <div className="player-ambience" aria-hidden="true"><Artwork track={currentTrack} /></div>
    <div className="now-playing-content">
      <header className="now-playing-header">
        <button className="player-icon" title="Minimize player" onClick={onClose}><ChevronDown size={26} /></button>
        <div><p>NOW PLAYING</p><span>{playbackSource === 'local' ? 'Downloaded music' : 'Your music'}</span></div>
        <button className="player-icon" title="Toggle lyrics view" aria-pressed={lyrics} onClick={() => setLyrics(!lyrics)}><FileText size={20} /></button>
      </header>
      <div className="player-art-stage">
        <AnimatePresence mode="wait" initial={false}>
          {lyrics ? <motion.div key="lyrics" className="player-lyrics" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }}>
            <h2>Lyrics</h2><p>{currentTrack.lyrics || 'No lyrics available for this song yet.'}</p>
          </motion.div> : <motion.div key="artwork" className="player-artwork"><TrackSlide expanded /></motion.div>}
        </AnimatePresence>
      </div>
      <div className="player-song-heading">
        <AnimatePresence initial={false} mode="popLayout"><motion.div key={currentTrack.id} initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -22 }} transition={{ duration: .28 }}><h1>{currentTrack.title}</h1><p>{currentTrack.artist}</p></motion.div></AnimatePresence>
        <motion.button whileTap={{ scale: 0.8 }} className="player-icon" title={favorite ? 'Unlike song' : 'Like song'} aria-pressed={favorite} onClick={() => toggleFavorite(currentTrack.id)}>
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
        <button className="player-icon" title={downloaded ? 'Remove download' : 'Download song'} onClick={() => downloaded ? removeDownload(currentTrack.id) : downloadTrack(currentTrack)}>{downloaded ? <CheckCircle2 size={21} /> : <Download size={21} />}</button>
        <button className="player-icon" title="Queue" onClick={() => { onClose(); onOpenQueue(); }}><ListMusic size={23} /></button>
      </footer>
    </div>
  </Overlay>;
};
