import React, { useEffect, useRef } from 'react';
type Options = { touchTarget?: React.RefObject<HTMLElement | null>; onDrag?: (offset: number) => void; onDragY?: (offset: number) => void; onLeft?: () => void; onRight?: () => void; onDown?: () => void; onUp?: () => void; disabled?: boolean; exclude?: string; edgeOnly?: boolean; threshold?: number; maxDrag?: number; lockHorizontal?: boolean; };
export function useSwipeGesture(options: Options) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(0);
  const axis = useRef<'horizontal' | 'vertical' | null>(null);
  const handlers = {
    onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => {
      suppressClick.current = 0; axis.current = null; start.current = null;
      if (options.disabled || !event.isPrimary || event.button !== 0 || (options.edgeOnly && event.clientX > 28) || (event.target as HTMLElement).closest('input, textarea, select, [role="slider"], [data-native-swipe]' + (options.exclude ? ', ' + options.exclude : ''))) return;
      start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    },
    onPointerMoveCapture: (event: React.PointerEvent<HTMLElement>) => {
      const initial = start.current;
      if (!initial || initial.id !== event.pointerId) return;
      const dx = event.clientX - initial.x, dy = event.clientY - initial.y;
      if (!axis.current && Math.max(Math.abs(dx), Math.abs(dy)) > 10) axis.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      const scrolling=(event.target as HTMLElement).closest<HTMLElement>('.now-playing-content.has-lyrics');
      if(axis.current==='vertical'&&scrolling&&(scrolling.scrollTop>1||dy<0)){start.current=null;axis.current=null;return;}
      if (axis.current === 'horizontal') {
        options.onDrag?.(Math.max(-(options.maxDrag ?? 90), Math.min(options.maxDrag ?? 90, dx)));
        if(event.pointerId>=0) event.currentTarget.setPointerCapture(event.pointerId); suppressClick.current = Date.now() + 500;
      } else if (axis.current === 'vertical' && (options.onDown || options.onUp)) {
        options.onDragY?.(dy);
        if(event.pointerId>=0) event.currentTarget.setPointerCapture(event.pointerId); suppressClick.current = Date.now() + 500;
      }
    },
    onPointerUpCapture: (event: React.PointerEvent<HTMLElement>) => {
      const initial = start.current; start.current = null; const locked = axis.current; axis.current = null;
      options.onDrag?.(0);
      if (!initial || initial.id !== event.pointerId) { options.onDragY?.(0); return; }
      const dx = event.clientX - initial.x, dy = event.clientY - initial.y;
      if (Math.abs(dx) >= (options.threshold ?? 64) && locked === 'horizontal') {
        suppressClick.current = Date.now() + 500;
        if (dx < 0) options.onLeft?.(); else options.onRight?.();
      } else if (Math.abs(dy) >= 75 && locked === 'vertical') {
        if (dy > 0 && options.onDown) { suppressClick.current = Date.now() + 500; options.onDown(); return; }
        if (dy < 0 && options.onUp) { suppressClick.current = Date.now() + 500; options.onUp(); return; }
      }
      options.onDragY?.(0);
    },
    onPointerCancelCapture: () => { start.current = null; axis.current = null; options.onDrag?.(0); options.onDragY?.(0); },
    onClickCapture: (event: React.MouseEvent) => { if (Date.now() < suppressClick.current) { event.preventDefault(); event.stopPropagation(); } },
  };
  const currentHandlers=useRef(handlers);currentHandlers.current=handlers;
  useEffect(()=>{
    const element=options.touchTarget?.current;if(!element)return;
    // Safari lacks directional touch-action. Leave upward scrolling native,
    // reserving downward drags at the top for the player dismissal gesture.
    const pointer=(event:TouchEvent,touch:Touch)=>({target:event.target,currentTarget:element,isPrimary:true,button:0,pointerId:-1,clientX:touch.clientX,clientY:touch.clientY}) as unknown as React.PointerEvent<HTMLElement>;
    const down=(event:TouchEvent)=>{if(event.touches.length===1)currentHandlers.current.onPointerDownCapture(pointer(event,event.touches[0]));else currentHandlers.current.onPointerCancelCapture();};
    const move=(event:TouchEvent)=>{
      const initial=start.current;if(!initial||event.touches.length!==1)return;
      const touch=event.touches[0],dx=touch.clientX-initial.x,dy=touch.clientY-initial.y;
      const scroller=(event.target as HTMLElement).closest<HTMLElement>('.now-playing-content.has-lyrics');
      const dismissing=dy>0&&Math.abs(dy)>=Math.abs(dx)&&(!scroller||scroller.scrollTop<=1);
      if((dismissing||axis.current==='horizontal')&&event.cancelable)event.preventDefault();
      currentHandlers.current.onPointerMoveCapture(pointer(event,touch));
      if(axis.current==='horizontal'&&event.cancelable)event.preventDefault();
    };
    const up=(event:TouchEvent)=>{if(event.changedTouches[0])currentHandlers.current.onPointerUpCapture(pointer(event,event.changedTouches[0]));};
    const cancel=()=>currentHandlers.current.onPointerCancelCapture();
    element.addEventListener('touchstart',down,{passive:true});element.addEventListener('touchmove',move,{passive:false});element.addEventListener('touchend',up);element.addEventListener('touchcancel',cancel);
    return()=>{element.removeEventListener('touchstart',down);element.removeEventListener('touchmove',move);element.removeEventListener('touchend',up);element.removeEventListener('touchcancel',cancel);};
  },[options.touchTarget]);
  return {...handlers,
    onPointerDownCapture:(event:React.PointerEvent<HTMLElement>)=>{if(!options.touchTarget||event.pointerType!=='touch')handlers.onPointerDownCapture(event);},
    onPointerMoveCapture:(event:React.PointerEvent<HTMLElement>)=>{if(!options.touchTarget||event.pointerType!=='touch')handlers.onPointerMoveCapture(event);},
    onPointerUpCapture:(event:React.PointerEvent<HTMLElement>)=>{if(!options.touchTarget||event.pointerType!=='touch')handlers.onPointerUpCapture(event);},
    onPointerCancelCapture:(event:React.PointerEvent<HTMLElement>)=>{if(!options.touchTarget||event.pointerType!=='touch')handlers.onPointerCancelCapture();},
  };
}
