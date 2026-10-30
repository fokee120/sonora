import {useLayoutEffect} from 'react';
export function useAppViewport(){
 useLayoutEffect(()=>{
  const viewport=window.visualViewport;
  let stableHeight=window.innerHeight,stableWidth=window.innerWidth,frame:number|null=null;
  const timers=new Set<ReturnType<typeof setTimeout>>();
  const editable=()=>document.activeElement?.matches('input:not([type="range"]):not([type="checkbox"]):not([type="color"]),textarea,[contenteditable="true"]');
  const update=()=>{
   const typing=editable(),unzoomed=!viewport||Math.abs(viewport.scale-1)<.01;
   const widthChanged=Math.abs(window.innerWidth-stableWidth)>80;
   if(widthChanged){stableWidth=window.innerWidth;stableHeight=window.innerHeight;}
   const visibleHeight=unzoomed?(viewport?.height??window.innerHeight):window.innerHeight;
   const keyboard=!!typing&&unzoomed&&visibleHeight<stableHeight-120;
   if(!typing&&unzoomed)stableHeight=Math.max(visibleHeight,window.innerHeight);
   const standalone=window.matchMedia('(display-mode: standalone)').matches||(navigator as any).standalone;
   const fullHeight=CSS.supports('height','100lvh')?'100lvh':'100vh';
   document.documentElement.style.setProperty('--app-height',standalone?fullHeight:(typing?stableHeight:visibleHeight)+'px');
   document.documentElement.classList.toggle('keyboard-open',keyboard);
   // Only the inner page scrolls in this fixed-shell app. Safari can pan the
   // document or its ancestors while revealing the caret; never pan them back
   // during an intentional pinch zoom, and never change the input's scrollLeft.
   if(typing&&unzoomed){
    if(window.scrollX||window.scrollY)window.scrollTo({left:0,top:0,behavior:'instant'});
    let element=document.activeElement?.parentElement;
    while(element){if(element.scrollLeft)element.scrollLeft=0;element=element.parentElement;}
    if(document.documentElement.scrollLeft)document.documentElement.scrollLeft=0;
   }
  };
  const schedule=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=null;update();});};
  const focusChanged=(event:Event)=>{if(event.type==='focusin')window.dispatchEvent(new Event('sonora:input-focus'));update();schedule();for(const delay of [100,350]){const timer=setTimeout(()=>{timers.delete(timer);schedule();},delay);timers.add(timer);}};
  update();viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
  window.addEventListener('resize',schedule);window.addEventListener('pageshow',schedule);document.addEventListener('visibilitychange',schedule);document.addEventListener('focusin',focusChanged);document.addEventListener('focusout',focusChanged);
  return()=>{if(frame!==null)cancelAnimationFrame(frame);timers.forEach(clearTimeout);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);window.removeEventListener('pageshow',schedule);document.removeEventListener('visibilitychange',schedule);document.removeEventListener('focusin',focusChanged);document.removeEventListener('focusout',focusChanged);document.documentElement.classList.remove('keyboard-open');};
 },[]);
}
