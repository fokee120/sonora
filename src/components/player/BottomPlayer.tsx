import React, { useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Loader2 } from 'lucide-react';
import { usePlayer } from '../../hooks/usePlayer.js';
import { ExpandedPlayerModal } from './ExpandedPlayerModal.js';
import { QueueDrawer } from './QueueDrawer.js';
import { SeekBar } from './SeekBar.js';
import { useSwipeGesture } from '../../hooks/useSwipeGesture.js';
import { TrackSlide } from './TrackSlide.js';

export const BottomPlayer: React.FC = () => {
  const player = usePlayer();
  const { currentTrack, isPlaying, isLoading, error, togglePlay, next, previous, shuffle, toggleShuffle, repeatMode, cycleRepeatMode, playbackSource } = player;
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const gestures = useSwipeGesture({ onLeft: next, onRight: player.previousSong, onUp: () => setExpanded(true) });
  return <LayoutGroup id="sonora-player">
    <AnimatePresence initial={false}>
      {currentTrack && <motion.div id="bottom-player-bar" className="bottom-player-bar" key="mini-player"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.24 }}>
        <div className="mini-player-content" {...gestures}>
          <button className="mini-track" onClick={event => { event.currentTarget.focus({ preventScroll: true }); setExpanded(true); }} aria-label={`Open player for ${currentTrack.title}`}>
            <TrackSlide />
            {playbackSource === 'local' && <span className="sr-only" title="Playing from local IndexedDB cache">Offline</span>}
          </button>
          <div className="mini-transport">
            <button className="player-icon desktop-control" title={`Shuffle: ${shuffle ? 'On' : 'Off'}`} aria-pressed={shuffle} onClick={toggleShuffle}><Shuffle size={17} /></button>
            <button className="player-icon desktop-control" title="Previous track" onClick={previous}><SkipBack size={21} fill="currentColor" /></button>
            <motion.button whileTap={{ scale: 0.9 }} className="mini-play" onClick={togglePlay}
              aria-label={isLoading ? 'Cancel loading' : isPlaying ? 'Pause' : error ? 'Retry playback' : 'Play'}>
              {isLoading ? <Loader2 className="animate-spin" size={21} /> : isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
            </motion.button>
            <button className="player-icon" title="Next track" onClick={next}><SkipForward size={21} fill="currentColor" /></button>
            <button className="player-icon desktop-control" title={`Repeat: ${repeatMode}`} aria-pressed={repeatMode !== 'off'} onClick={cycleRepeatMode}>{repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</button>
          </div>
          <div className="mini-utilities desktop-control">
            <button className="player-icon" title="Queue" onClick={() => setQueueOpen(true)}><ListMusic size={19} /></button>
          </div>
        </div>
        <SeekBar compact />
        {isLoading && <p role="status" className="mini-status">{isPlaying ? 'Buffering…' : 'Loading audio…'}</p>}
        {error && <p role="alert" className="mini-error">{error}</p>}
      </motion.div>}
    </AnimatePresence>
    <ExpandedPlayerModal isOpen={expanded} onClose={() => setExpanded(false)} onOpenQueue={() => setQueueOpen(true)} />
    <QueueDrawer isOpen={queueOpen} onClose={() => setQueueOpen(false)} />
  </LayoutGroup>;
};
