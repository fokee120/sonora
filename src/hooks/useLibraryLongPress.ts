import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

function collectionId(target: EventTarget) {
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-library-selection-id]')?.dataset.librarySelectionId
    : undefined;
}

export function useLibraryLongPress(onSelect: (id: string) => void, selectionActive: boolean) {
  const press = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null);
  const suppress = useRef<string | undefined>(undefined);
  useEffect(() => () => { window.clearTimeout(press.current?.timer); }, []);

  const cancel = () => {
    window.clearTimeout(press.current?.timer);
    press.current = null;
  };

  return {
    onPointerDownCapture(event: PointerEvent) {
      if (!event.isPrimary) { cancel(); return; }
      cancel();
      suppress.current = undefined;
      const id = collectionId(event.target);
      if (!id || selectionActive || event.button !== 0) return;
      const { pointerId, clientX: x, clientY: y } = event;
      press.current = {
        pointerId, x, y,
        timer: window.setTimeout(() => {
          suppress.current = id;
          onSelect(id);
        }, 480),
      };
    },
    onPointerMoveCapture(event: PointerEvent) {
      const start = press.current;
      if (start?.pointerId === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
    },
    onPointerUpCapture: cancel,
    onPointerCancelCapture: cancel,
    onPointerLeave: cancel,
    onContextMenu(event: MouseEvent) {
      const id = collectionId(event.target);
      if (!id) return;
      event.preventDefault();
      if (!selectionActive && !press.current) onSelect(id);
    },
    onClickCapture(event: MouseEvent) {
      if (suppress.current && collectionId(event.target) === suppress.current) {
        suppress.current = undefined;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
