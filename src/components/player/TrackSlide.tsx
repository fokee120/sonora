import React, { useContext } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PlayerMotionContext } from './PlayerMotionContext.js';
import type { Track } from '../../types/index.js';
import { ScrollingTitle } from './ScrollingTitle.js';
import { Artwork } from '../common/Artwork.js';

const slide = {
  enter: ({ direction, travel }: { direction: number; travel: number }) => ({ x: direction * travel, opacity: 0 }),
  exit: ({ direction, travel }: { direction: number; travel: number }) => ({ x: -direction * travel, opacity: 0 }),
};

export function TrackTransition({ id, frame, viewport, travel, children }: {
  id: string; frame?: string; viewport?: string; travel: number; children: React.ReactNode;
}) {
  const gesture = useContext(PlayerMotionContext);
  const reduced = useReducedMotion();
  const custom = { direction: gesture?.direction ?? 1, travel: reduced ? 0 : travel };
  return <motion.div style={gesture && travel ? { x: gesture.x } : undefined} className={viewport}>
    <AnimatePresence initial={false} custom={custom}>
      <motion.div key={id} className={frame} custom={custom} variants={slide}
        initial="enter" animate={{ x: 0, opacity: 1 }} exit="exit"
        transition={{ duration: reduced ? .12 : .25, ease: [.22, 1, .36, 1] }}>
        {children}
      </motion.div>
    </AnimatePresence>
  </motion.div>;
}

export const TrackSlide = React.memo(function TrackSlide({ track, expanded = false, onArtworkLoad }: {
  track: Track; expanded?: boolean; onArtworkLoad?: React.ReactEventHandler<HTMLImageElement>;
}) {
  return <TrackTransition id={track.id} travel={expanded ? 90 : 40}
    viewport={expanded ? 'expanded-track-slide' : 'mini-track-slide'}
    frame={expanded ? 'expanded-track-frame' : 'mini-track-frame'}>
    <div className={expanded ? 'shared-player-cover' : 'mini-artwork'}>
      <Artwork track={track} className={expanded ? 'player-cover-image' : 'mini-cover-image'} alt={track.album} eager thumbnail={!expanded} onLoad={onArtworkLoad}/>
    </div>
    {!expanded && <span className="mini-track-copy"><ScrollingTitle text={track.title}/><span>{track.artist}</span></span>}
  </TrackTransition>;
});
