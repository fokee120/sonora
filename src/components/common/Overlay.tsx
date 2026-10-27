import React, { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { useSwipeGesture } from '../../hooks/useSwipeGesture.js';
import { usePlayer } from '../../hooks/usePlayer.js';

let openOverlays = 0;
let returnFocus: HTMLElement | null = null;
function Surface({ onClose, label, children, variant, id }: Omit<Props, 'isOpen'>) {
  const ref = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const reduced = useReducedMotion();
  const dragControls = useDragControls();
  const { next, previousSong } = usePlayer();
  const playerGestures = useSwipeGesture({ disabled: variant !== 'player', onLeft: next, onRight: previousSong, onDown: onClose, exclude: '.player-lyrics' });
  useEffect(() => {
    const previous = previousFocus.current;
    const root = document.getElementById('root');
    if (++openOverlays === 1) { returnFocus = previous; root?.setAttribute('inert', ''); }
    const initialFocus = ref.current?.querySelector<HTMLElement>('input:not([type="range"]):not(:disabled), [data-autofocus]') ?? ref.current;
    initialFocus?.focus({ preventScroll: true });
    return () => {
      if (--openOverlays === 0) {
        root?.removeAttribute('inert');
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        returnFocus = null;
      }
    };
  }, []);
  const isPlayer = variant === 'player';
  return <motion.div className={`overlay-backdrop overlay-${variant}`} data-sonora-overlay
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: reduced ? 0.08 : 0.2 }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.section {...playerGestures} ref={ref} id={id} layoutRoot role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      className={`overlay-surface ${isPlayer ? 'player-sheet' : variant === 'drawer' ? 'queue-sheet' : 'dialog-sheet'}`}
      initial={reduced ? { opacity: 0 } : variant === 'drawer' ? { x: '100%' } : { y: isPlayer ? '100%' : 24, opacity: 0 }}
      animate={{ x: 0, y: 0, opacity: 1 }}
      exit={reduced ? { opacity: 0 } : variant === 'drawer' ? { x: '100%' } : { y: isPlayer ? '100%' : 24, opacity: 0 }}
      transition={reduced ? { duration: 0.08 } : { type: 'spring', stiffness: 370, damping: 39 }}
      drag={isPlayer && !reduced ? 'y' : false} dragListener={false} dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_event, info) => { if (info.offset.y > 100 || info.velocity.y > 650) onClose(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key !== 'Tab') return;
        const elements = (Array.from(ref.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') || []) as HTMLElement[])
          .filter(element => element.getClientRects().length > 0);
        const first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
      }}>
      {isPlayer && <div className="player-drag-zone" onPointerDown={event => dragControls.start(event)} aria-hidden="true"><span /></div>}
      {children}
    </motion.section>
  </motion.div>;
}
type Props = { isOpen: boolean; onClose: () => void; label: string; children: ReactNode; variant?: 'player' | 'drawer' | 'dialog'; id?: string };
export function Overlay({ isOpen, variant = 'dialog', ...props }: Props) {
  return createPortal(<AnimatePresence>{isOpen && <Surface variant={variant} {...props} />}</AnimatePresence>, document.body);
}
