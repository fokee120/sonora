import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePlayer } from '../../hooks/usePlayer.js';
import { Artwork } from '../common/Artwork.js';
export function TrackSlide({ expanded = false }: { expanded?: boolean }) {
  const { currentTrack: track, queue } = usePlayer();
  const previous = useRef({ id: track?.id, index: -1, direction: 1 });
  const index = queue.findIndex(item => item.track.id === track?.id);
  if (previous.current.id !== track?.id) previous.current = { id: track?.id, index, direction: index < previous.current.index ? -1 : 1 };
  const direction = previous.current.direction;
  if (!track) return null;
  return <div className={expanded ? 'expanded-track-slide' : 'mini-track-slide'}>
    <AnimatePresence initial={false} custom={direction} mode="popLayout">
      <motion.div key={track.id} className={expanded ? 'expanded-track-frame' : 'mini-track-frame'} custom={direction}
        variants={{ enter: (value: number) => ({ x: value * (expanded ? 90 : 40), opacity: 0 }), exit: (value: number) => ({ x: value * (expanded ? -90 : -40), opacity: 0 }) }}
        initial="enter" animate={{ x: 0, opacity: 1 }} exit="exit" transition={{ duration: .32, ease: [.22, 1, .36, 1] }}>
        <Artwork track={track} className={expanded ? 'player-cover-image' : 'mini-artwork'} alt={track.album} />
        {!expanded && <span className="mini-track-copy"><strong>{track.title}</strong><span>{track.artist}</span></span>}
      </motion.div>
    </AnimatePresence>
  </div>;
}
