import React, { useRef } from 'react';
type Options = { onDrag?: (offset: number) => void; onLeft?: () => void; onRight?: () => void; onDown?: () => void; onUp?: () => void; disabled?: boolean; exclude?: string; edgeOnly?: boolean; threshold?: number; maxDrag?: number; lockHorizontal?: boolean; };
export function useSwipeGesture(options: Options) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(0);
  const axis = useRef<'horizontal' | 'vertical' | null>(null);
  return {
    onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => {
      // Only suppress the synthetic click from this gesture, never the next tap.
      suppressClick.current = 0;
      axis.current = null;
      if (options.disabled || !event.isPrimary || event.button !== 0 || (options.edgeOnly && event.clientX > 28) || (event.target as HTMLElement).closest(`input, textarea, select, [role="slider"], [data-native-swipe]${options.exclude ? `, ${options.exclude}` : ''}`)) return;
      start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    },
    onPointerMoveCapture: (event: React.PointerEvent<HTMLElement>) => {
      const initial = start.current;
      if (!initial || initial.id !== event.pointerId) return;
      const dx = event.clientX - initial.x, dy = event.clientY - initial.y;
      if (options.lockHorizontal && !axis.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) axis.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      const horizontal = options.lockHorizontal ? axis.current === 'horizontal' : Math.abs(dx) > Math.abs(dy) * 1.3;
      if (Math.abs(dx) > 14 && horizontal) {
        options.onDrag?.(Math.max(-(options.maxDrag ?? 90), Math.min(options.maxDrag ?? 90, dx)));
        event.currentTarget.setPointerCapture(event.pointerId);
        suppressClick.current = Date.now() + 500;
      } else if (Math.abs(dy) > 14 && !horizontal && (options.onDown || options.onUp)) {
        event.currentTarget.setPointerCapture(event.pointerId); suppressClick.current = Date.now() + 500;
      }
    },
    onPointerUpCapture: (event: React.PointerEvent<HTMLElement>) => {
      options.onDrag?.(0);
      const initial = start.current; start.current = null; const lockedHorizontal = options.lockHorizontal && axis.current === 'horizontal'; axis.current = null;
      if (!initial || initial.id !== event.pointerId) return;
      const dx = event.clientX - initial.x, dy = event.clientY - initial.y;
      if (Math.abs(dx) >= (options.threshold ?? 64) && (options.lockHorizontal ? lockedHorizontal : Math.abs(dx) > Math.abs(dy) * 1.3)) {
        suppressClick.current = Date.now() + 500;
        if (dx < 0) options.onLeft?.(); else options.onRight?.();
      } else if (Math.abs(dy) >= 75 && Math.abs(dy) > Math.abs(dx) * 1.3) {
        if (dy > 0 && options.onDown) { suppressClick.current = Date.now() + 500; options.onDown(); }
        else if (dy < 0 && options.onUp) { suppressClick.current = Date.now() + 500; options.onUp(); }
      }
    },
    onPointerCancelCapture: () => { start.current = null; axis.current = null; options.onDrag?.(0); },
    onClickCapture: (event: React.MouseEvent) => { if (Date.now() < suppressClick.current) { event.preventDefault(); event.stopPropagation(); } },
  };
}
