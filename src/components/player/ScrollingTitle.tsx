import React, {memo, useEffect, useLayoutEffect, useRef, useState} from 'react';
/** Scroll only overflowing titles. The entire label remains available to assistive tech. */
export const ScrollingTitle=memo(function ScrollingTitle({text,as:Tag='strong'}:{text:string;as?:'strong'|'h1'}){
 const frame=useRef<HTMLElement>(null),line=useRef<HTMLSpanElement>(null);
 const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{const preference=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(preference.matches);update();preference.addEventListener('change',update);return()=>preference.removeEventListener('change',update);},[]);
 useLayoutEffect(()=>{
  const outer=frame.current,inner=line.current;if(!outer||!inner)return;
  let animation:Animation|undefined,last=-1,active=true;
  const measure=()=>{
   if(!active)return;
   const distance=Math.max(0,inner.scrollWidth-outer.clientWidth);
   if(distance===last)return;last=distance;animation?.cancel();inner.style.transform='';
   if(reduced||distance<2||!outer.clientWidth)return;
   const travel=Math.max(2200,distance/32*1000),duration=1000+travel+800+travel;
   animation=inner.animate([{transform:'translate3d(0,0,0)',offset:0},{transform:'translate3d(0,0,0)',offset:1000/duration},{transform:`translate3d(-${distance}px,0,0)`,offset:(1000+travel)/duration},{transform:`translate3d(-${distance}px,0,0)`,offset:(1800+travel)/duration},{transform:'translate3d(0,0,0)',offset:1}],{duration,iterations:Infinity,easing:'linear'});
  };
  const observer=new ResizeObserver(measure);observer.observe(outer);observer.observe(inner);measure();void document.fonts.ready.then(measure);
  return()=>{active=false;observer.disconnect();animation?.cancel();};
 },[text,reduced]);
 return <Tag ref={frame as React.Ref<any>} className="scrolling-title" data-title-scroll={reduced?'':undefined} title={text}><span ref={line}>{text}</span></Tag>;
});
