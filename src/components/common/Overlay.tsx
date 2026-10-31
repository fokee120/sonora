import React, { useEffect, useRef, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useMotionValue, animate, useReducedMotion } from 'motion/react';
import { useSwipeGesture } from '../../hooks/useSwipeGesture.js';
import { PlayerMotionContext } from '../player/PlayerMotionContext.js';
import { usePlayer } from '../../hooks/usePlayer.js';
let openOverlays = 0;
let returnFocus: HTMLElement | null = null;
function Surface({ onClose, label, children, variant, id }: Omit<Props, 'isOpen'>) {
  const ref = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const reduced = useReducedMotion();
  const sheetY = useMotionValue(0);
  const dragX = useContext(PlayerMotionContext);
  const { next, previousSong } = usePlayer({progress:false});
  const playerGestures = useSwipeGesture({
    touchTarget: variant === 'player' ? ref : undefined,
    onDrag: offset => { if(!dragX) return; if(offset === 0) { if(reduced) dragX.set(0); else void animate(dragX, 0, {type:'spring',stiffness:420,damping:36}); } else { dragX.stop(); dragX.set(offset); } },
    disabled: variant !== 'player', onLeft: next, onRight: previousSong, onDown: onClose,
    onDragY: offset => { if (reduced) return; if (offset === 0) void animate(sheetY, 0, { type: 'spring', stiffness: 390, damping: 36 }); else { sheetY.stop(); sheetY.set(offset > 0 ? offset : offset * .12); } },
    exclude: '.player-lyrics,button,a,[data-title-scroll]',
  });
  useEffect(() => {
    const root = document.getElementById('root');
    if (++openOverlays === 1) { returnFocus = previousFocus.current; root?.setAttribute('inert', ''); }
    // Opening a sheet should not summon the iPhone keyboard unexpectedly.
    const initialFocus = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current;
    initialFocus?.focus({ preventScroll: true });
    return () => { if (--openOverlays === 0) { root?.removeAttribute('inert'); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); returnFocus = null; } };
  }, []);
  const isPlayer = variant === 'player';
  return <motion.div className={'overlay-backdrop overlay-' + variant} data-sonora-overlay
    initial={{ opacity: isPlayer ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: isPlayer ? 1 : 0 }}
    transition={{ duration: reduced ? 0.05 : .2 }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    {isPlayer&&<motion.div className="player-backdrop-shade" aria-hidden="true" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduced?.05:.22}}/>}
    <motion.section {...playerGestures} ref={ref} id={id} layoutRoot role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      style={isPlayer ? { y: sheetY } : undefined}
      className={'overlay-surface ' + (isPlayer ? 'player-sheet' : variant === 'drawer' ? 'queue-sheet' : 'dialog-sheet')}
      initial={reduced ? { opacity: 0 } : variant === 'drawer' ? { x: '100%' } : isPlayer ? { y: '100%', opacity: 0 } : { scale: .97, opacity: 0 }}
      animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
      exit={reduced ? { opacity: 0 } : variant === 'drawer' ? { x: '100%' } : { y: isPlayer ? '100%' : 24, opacity: isPlayer ? 1 : 0 }}
      transition={reduced ? { duration: .05 } : isPlayer ? {type:'tween',duration:.26,ease:[.22,1,.36,1]} : { type: 'spring', stiffness: 370, damping: 39 }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key !== 'Tab') return;
        const elements = (Array.from(ref.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || []) as HTMLElement[]).filter(el => el.getClientRects().length > 0);
        const first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
      }}>
      {isPlayer && <div className="player-drag-zone" aria-hidden="true"><span /></div>}
      {children}
    </motion.section>
  </motion.div>;
}
type Props = { isOpen: boolean; onClose: () => void; label: string; children: ReactNode; variant?: 'player' | 'drawer' | 'dialog'; id?: string };
export function Overlay({ isOpen, variant = 'dialog', ...props }: Props) { return createPortal(<AnimatePresence>{isOpen && <Surface variant={variant} {...props} />}</AnimatePresence>, document.body); }
