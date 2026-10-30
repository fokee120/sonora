import React, { useRef, useContext } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePlayer } from '../../hooks/usePlayer.js';
import { PlayerMotionContext } from './PlayerMotionContext.js';
import {useAppearance} from '../../lib/appearance.js';
import {ScrollingTitle} from './ScrollingTitle.js';
import { Artwork } from '../common/Artwork.js';
export function TrackSlide({ expanded = false }: { expanded?: boolean }) {
  const dragX = useContext(PlayerMotionContext);
  const noir = useAppearance().style === 'gotham';
  const { currentTrack: track, currentQueueIndex: index } = usePlayer({progress:false});
  const previous = useRef({ id: track?.id, index: -1, direction: 1 });
  if (previous.current.id !== track?.id) previous.current = { id: track?.id, index, direction: index < previous.current.index ? -1 : 1 };
  const direction = previous.current.direction;
  if (!track) return null;
  return <motion.div style={dragX ? { x: dragX } : undefined} className={expanded ? 'expanded-track-slide' : 'mini-track-slide'}>
    <AnimatePresence initial={false} custom={direction} mode="popLayout">
      <motion.div key={track.id} className={expanded ? 'expanded-track-frame' : 'mini-track-frame'} custom={direction}
        variants={{ enter: (value: number) => ({ x: value * (expanded ? 90 : 40), opacity: 0 }), exit: (value: number) => ({ x: value * (expanded ? -90 : -40), opacity: 0 }) }}
        initial="enter" animate={{ x: 0, opacity: 1 }} exit="exit" transition={{ duration: .32, ease: [.22, 1, .36, 1] }}>
        <motion.div layoutDependency={track.id} layoutId={noir ? undefined : 'sonora-cover:' + track.id} className={expanded ? 'shared-player-cover' : 'mini-artwork'} transition={{type:'spring',stiffness:330,damping:34}}><Artwork track={track} className={expanded ? 'player-cover-image' : 'mini-cover-image'} alt={track.album}/></motion.div>
        {!expanded && <span className="mini-track-copy"><ScrollingTitle text={track.title}/><span>{track.artist}</span></span>}
      </motion.div>
    </AnimatePresence>
  </motion.div>;
}
