import {ImmersivePlayer} from './ImmersivePlayer.js';
import {Maximize2} from 'lucide-react';
import {DevicePicker} from './DevicePicker.js';
import React, { useState, useRef, useMemo } from 'react';
import { AnimatePresence, motion, useMotionValue, animate, useReducedMotion } from 'motion/react';
import { ListMusic, X } from 'lucide-react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1 } from '../common/ThemeIcons.js';
import { usePlayer } from '../../hooks/usePlayer.js';
import { ExpandedPlayerModal } from './ExpandedPlayerModal.js';
import { QueueDrawer } from './QueueDrawer.js';
import { SeekBar } from './SeekBar.js';
import { useSwipeGesture } from '../../hooks/useSwipeGesture.js';
import { PlayerMotionContext } from './PlayerMotionContext.js';
import { TrackSlide } from './TrackSlide.js';

export const BottomPlayer: React.FC = () => {
  const player = usePlayer({progress:false,subscribeQueue:false});
  const { currentTrack, isPlaying, isLoading, error, togglePlay, next, previous, shuffle, toggleShuffle, repeatMode, cycleRepeatMode, playbackSource } = player;
  const [immersive,setImmersive]=useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const dragX = useMotionValue(0);
  const reduced = useReducedMotion();
  const dragOrigin = useRef(0);
  const committed = useRef<number | null>(null);
  const displayed = useRef({ id: currentTrack?.id, index: player.currentQueueIndex, direction: 1 });
  if (displayed.current.id !== currentTrack?.id) {
    displayed.current = { id: currentTrack?.id, index: player.currentQueueIndex,
      direction: (Math.abs(dragX.get()) > 1 ? committed.current : null) ?? (player.currentQueueIndex < displayed.current.index ? -1 : 1) };
    committed.current = null;
  } else displayed.current.index = player.currentQueueIndex;
  const transport = useRef({ next, previousSong: player.previousSong });
  transport.current = { next, previousSong: player.previousSong };
  const gesture = useMemo(() => ({
    x: dragX,
    direction: displayed.current.direction,
    begin() {
      dragX.stop();
      dragOrigin.current = dragX.get();
    },
    drag(offset: number) {
      if (offset) dragX.set(Math.max(-105, Math.min(105, dragOrigin.current + offset)));
      else if (reduced) dragX.set(0);
      else void animate(dragX, 0, { type: 'spring', stiffness: 420, damping: 36 });
    },
    release(direction: -1 | 1, velocity: number) {
      committed.current = direction;
      dragX.stop();
      if (reduced) dragX.set(0);
      else void animate(dragX, 0, { type: 'spring', stiffness: 335, damping: 34, velocity: velocity * 1000 });
      if (direction === 1) transport.current.next(); else transport.current.previousSong();
    },
  }), [dragX, reduced, displayed.current.direction]);
  const gestures = useSwipeGesture({ exclude: ".mini-transport,.mini-utilities,[data-title-scroll]",
    onDrag: gesture.drag, onHorizontalStart: gesture.begin, onHorizontalRelease: gesture.release, onUp: () => setExpanded(true) });
  return <PlayerMotionContext.Provider value={gesture}>
    <AnimatePresence initial={false}>
      {currentTrack && <motion.div id="bottom-player-bar" className="bottom-player-bar" key="mini-player"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.24 }}>
        <div className="mini-player-content" {...gestures}>
          <button className="mini-track" onClick={event => { event.currentTarget.focus({ preventScroll: true }); setExpanded(true); }} aria-label={`Open player for ${currentTrack.title}`}>
            <TrackSlide track={currentTrack} />
            {playbackSource === 'local' && <span className="sr-only" title="Playing from local IndexedDB cache">Offline</span>}
          </button>
          <div className="mini-transport"><DevicePicker/>
            <button className="player-icon desktop-control" title={`Shuffle: ${shuffle ? 'On' : 'Off'}`} aria-pressed={shuffle} onClick={toggleShuffle}><Shuffle size={17} /></button>
            <button className="player-icon desktop-control" title="Previous track" onClick={previous}><SkipBack size={21} fill="currentColor" /></button>
            <motion.button whileTap={{ scale: 0.9 }} className="mini-play" onClick={togglePlay}
              aria-label={isLoading ? 'Cancel loading' : isPlaying ? 'Pause' : error ? 'Retry playback' : 'Play'}>
              {isLoading ? <X size={20} /> : isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
            </motion.button>
            <button className="player-icon" title="Next track" onClick={next}><SkipForward size={21} fill="currentColor" /></button>
            <button className="player-icon desktop-control" title={`Repeat: ${repeatMode}`} aria-pressed={repeatMode !== 'off'} onClick={cycleRepeatMode}>{repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</button>
          </div>
          <div className="mini-utilities desktop-control"><button className="player-icon" aria-label="Open fullscreen listening" onClick={()=>setImmersive(true)}><Maximize2 size={18}/></button>
            <button className="player-icon" title="Queue" onClick={() => setQueueOpen(true)}><ListMusic size={19} /></button>
          </div>
        </div>
        <SeekBar compact />
      </motion.div>}
    </AnimatePresence>
    <ExpandedPlayerModal isOpen={expanded} onClose={() => setExpanded(false)} onOpenImmersive={()=>{setExpanded(false);setImmersive(true);}} onOpenQueue={() => setQueueOpen(true)} />
    <ImmersivePlayer isOpen={immersive} onClose={()=>setImmersive(false)}/>
    <QueueDrawer isOpen={queueOpen} onClose={() => setQueueOpen(false)} />
  </PlayerMotionContext.Provider>;
};
