import React, { useLayoutEffect, useRef, useEffect } from 'react';
import {motion, useReducedMotion } from 'motion/react';
import { useApp } from '../../context/AppContext.js';
import { RecapView } from '../../views/RecapView.js';
import { HomeView } from '../../views/HomeView.js';
import { SearchView } from '../../views/SearchView.js';
import { LibraryView } from '../../views/LibraryView.js';
import { AlbumDetailView } from '../../views/AlbumDetailView.js';
import { ArtistDetailView } from '../../views/ArtistDetailView.js';
import { PlaylistDetailView } from '../../views/PlaylistDetailView.js';
import { LikedSongsView } from '../../views/LikedSongsView.js';
import { ProfileView } from '../../views/ProfileView.js';
import { ProfileListeningView } from '../../views/ProfileListeningView.js';
import { ProfilePlaylistView } from '../../views/ProfilePlaylistView.js';
import { SettingsView } from '../../views/SettingsView.js';

const pages = ['home', 'search', 'recap', 'library'] as const;
type Page = typeof pages[number];
// Each destination is the same mounted scroll surface before, during, and after
// a gesture. This also retains tab selection, search input, and list position.
export function PageStage() {
  const { route, navigate } = useApp();
  const reduced = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const panes = useRef<Record<string, HTMLElement | null>>({});
  const current = pages.includes(route.type as Page) ? route.type : 'detail';
  const routeKey = route.type + ('id' in route ? ':' + route.id : '') + (route.type==='playlist'&&route.profileId?':'+route.profileId:'')+(route.type==='profile-listening'?':'+route.section:'');
  const positions = useRef(new Map<string, number>());
  const previousKey = useRef(routeKey);
  const navigationAnimations=useRef<Animation[]>([]);
  const gesture = useRef<{ x: number; y: number; id: number; time: number; lastX: number; lastTime: number; velocity: number; dx: number; locked: boolean; rejected: boolean; target?: Page } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const suppress = useRef(0);
  const settling = useRef(false);
  const arrivedBySwipe = useRef(false);
  const landing = useRef<{ from: string; dx: number; width: number } | null>(null);
  const reset = () => {
    if(stage.current)stage.current.scrollLeft=0;
    for (const [name, pane] of (Object.entries(panes.current) as [string, HTMLElement | null][])) if (pane) {
      pane.style.transform = ''; pane.style.transition = ''; pane.style.willChange = '';
      pane.style.visibility = name === current ? 'visible' : 'hidden';
      pane.classList.remove('gesture-preview');
    }
  };
  useLayoutEffect(() => {
    navigationAnimations.current.forEach(animation=>animation.cancel());navigationAnimations.current=[];
    if (timer.current) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    for (const pane of Object.values(panes.current) as (HTMLElement | null)[]) pane?.getAnimations().forEach(animation => animation.cancel());
    gesture.current = null; settling.current = false; reset();
    const pane = panes.current[current];
    if (current === 'detail' && pane) pane.scrollTop = positions.current.get(routeKey) || 0;
    const swipe = landing.current; landing.current = null;
    if (swipe && pane && !reduced) {
      const outgoing = panes.current[swipe.from];
      const end = Math.sign(swipe.dx) * swipe.width;
      const incoming = swipe.dx - end;
      pane.animate([{ transform: 'translate3d(' + incoming + 'px,0,0)' }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
      if (outgoing) {
        outgoing.style.visibility = 'visible';
        const animation = outgoing.animate([{ transform: 'translate3d(' + swipe.dx + 'px,0,0)' }, { transform: 'translate3d(' + end + 'px,0,0)' }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
        animation.onfinish = () => { outgoing.style.visibility = 'hidden'; };
      }
    }
    const fromPage=previousKey.current.split(':')[0] as Page;
    const tabChange=pane&&pages.includes(fromPage)&&pages.includes(current as Page)&&fromPage!==current;
    if(tabChange&&!arrivedBySwipe.current&&!reduced){
      const direction=pages.indexOf(current as Page)>pages.indexOf(fromPage)?1:-1;
      const outgoing=panes.current[fromPage];
      const incomingAnimation=pane.animate([{opacity:0,transform:'translate3d('+direction*48+'px,0,0)'},{opacity:1,transform:'none'}],{duration:300,easing:'cubic-bezier(.22,1,.36,1)'});
      navigationAnimations.current.push(incomingAnimation);
      if(outgoing){outgoing.style.visibility='visible';const exit=outgoing.animate([{opacity:1,transform:'none'},{opacity:0,transform:'translate3d('+direction*-28+'px,0,0)'}],{duration:240,easing:'cubic-bezier(.22,1,.36,1)'});navigationAnimations.current.push(exit);exit.onfinish=()=>{if(previousKey.current===routeKey)outgoing.style.visibility='hidden';};}
    } else if (pane && previousKey.current !== routeKey && !arrivedBySwipe.current && !reduced) {
      (route.type==='playlist'?pane.querySelector('.route-content')||pane:pane).animate([{ opacity: route.type==='playlist'?.25:.55, transform: route.type==='playlist'?'translate3d(36px,0,0)':'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { duration: route.type==='playlist'?360:200, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    arrivedBySwipe.current = false; previousKey.current = routeKey;
  }, [routeKey]);
  useEffect(() => () => { navigationAnimations.current.forEach(animation=>animation.cancel()); if (timer.current) clearTimeout(timer.current); if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useEffect(()=>{const resized=()=>{gesture.current=null;settling.current=false;landing.current=null;if(timer.current)clearTimeout(timer.current);if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}navigationAnimations.current.forEach(animation=>animation.cancel());navigationAnimations.current=[];for(const pane of Object.values(panes.current) as (HTMLElement|null)[])pane?.getAnimations().forEach(animation=>animation.cancel());reset();};window.addEventListener('resize',resized);window.addEventListener('sonora:input-focus',resized);return()=>{window.removeEventListener('resize',resized);window.removeEventListener('sonora:input-focus',resized);};},[routeKey]);
  const draw = (dx: number, target?: Page, animate = false) => {
    const width = stage.current?.clientWidth || innerWidth;
    const pane = panes.current[current];
    if (!pane) return;
    pane.style.transition = animate && !reduced ? 'transform 240ms cubic-bezier(.22,1,.36,1)' : 'none';
    pane.style.willChange = 'transform';
    pane.style.transform = 'translate3d(' + dx + 'px,0,0)';
    for (const name of pages) if (name !== current) {
      const next = panes.current[name];
      if (!next) continue;
      next.style.visibility = name === target ? 'visible' : 'hidden';
      if (name === target) {
        next.classList.add('gesture-preview');
        next.style.transition = pane.style.transition;
        next.style.transform = 'translate3d(' + (dx + (dx <= 0 ? width : -width)) + 'px,0,0)';
      }
    }
  };
  const handlers = {
    onPointerDownCapture: (e: React.PointerEvent<HTMLElement>) => {
      suppress.current = 0;
      navigationAnimations.current.forEach(animation=>animation.cancel());navigationAnimations.current=[];
      for (const pane of Object.values(panes.current) as (HTMLElement | null)[]) pane?.getAnimations().forEach(animation => animation.cancel());
      reset();
      if (settling.current || !e.isPrimary || e.button !== 0 || (e.target as HTMLElement).closest('button,a,input,textarea,select,[data-song-swipe],[data-sonora-overlay],.segmented-tabs')) return;
      if (current === 'detail' && (!['playlist','settings','downloads','profile','profile-listening'].includes(route.type) || (e.clientX - e.currentTarget.getBoundingClientRect().left > 32 && !((route.type==='profile-listening'||route.type==='playlist'&&route.profileId)&&e.currentTarget.getBoundingClientRect().right-e.clientX<32)))) return;
      gesture.current = { x: e.clientX, y: e.clientY, id: e.pointerId, time: performance.now(), lastX: e.clientX, lastTime: performance.now(), velocity: 0, dx: 0, locked: false, rejected: false };
    },
    onPointerMoveCapture: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId || g.rejected) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.locked) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dy) > Math.abs(dx)) { g.rejected = true; return; }
        g.locked = true; e.currentTarget.setPointerCapture(e.pointerId); suppress.current = Date.now() + 600;
      }
      const now = performance.now();
      g.velocity = (e.clientX - g.lastX) / Math.max(1, now - g.lastTime);
      g.lastX = e.clientX; g.lastTime = now; g.dx = dx;
      const index = pages.indexOf(current as Page);
      g.target = current==='detail'&&(route.type==='profile-listening'||route.type==='playlist'&&route.profileId)?undefined:current === 'detail' ? (dx > 0 ? ['settings','downloads','profile'].includes(route.type) ? 'home' : 'library' : undefined) : pages[index + (dx < 0 ? 1 : -1)];
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => { draw(g.target||route.type==='profile-listening'||route.type==='playlist'&&route.profileId ? dx : dx * .12, g.target); frame.current = null; });
    },
    onPointerUpCapture: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current; gesture.current = null;
      if (!g?.locked || g.id !== e.pointerId) return;
      if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
      suppress.current = Date.now() + 600;
      const width = stage.current?.clientWidth || innerWidth;
      const distance = e.clientX - g.x;
      const commit = !!g.target && (Math.abs(distance) > Math.min(100, width * .24) || Math.abs(distance) > 35 && Math.abs(g.velocity) > .55);
      if(current==='detail'&&(route.type==='profile-listening'||route.type==='playlist'&&route.profileId)&&g.locked&&(Math.abs(distance)>Math.min(100,width*.24)||Math.abs(distance)>35&&Math.abs(g.velocity)>.55)){const id=route.type==='profile-listening'?route.id:route.profileId;settling.current=true;draw(Math.sign(distance)*width,undefined,true);timer.current=setTimeout(()=>{settling.current=false;arrivedBySwipe.current=true;navigate({type:'profile',id});},reduced?0:245);return;}
      if (commit && g.target && current === 'detail') {
        settling.current = true; draw(width, g.target, true);
        timer.current = setTimeout(() => { settling.current = false; arrivedBySwipe.current = true; navigate({ type: g.target! }); }, reduced ? 0 : 245);
      } else if (commit && g.target) {
        landing.current = { from: current, dx: distance, width };
        arrivedBySwipe.current = true;
        navigate({ type: g.target });
      } else {
        settling.current = true; draw(0, g.target, true);
        timer.current = setTimeout(() => { settling.current = false; reset(); }, reduced ? 0 : 245);
      }
    },
    onPointerCancelCapture: () => {
      gesture.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      draw(0, undefined, true);
      timer.current = setTimeout(reset, reduced ? 0 : 245);
    },
    onClickCapture: (e: React.MouseEvent) => { if (Date.now() < suppress.current) { e.preventDefault(); e.stopPropagation(); } },
  };
  const detail = () => {
    switch (route.type) {
      case 'album': return <AlbumDetailView albumId={route.id} />;
      case 'artist': return <ArtistDetailView artistId={route.id} />;
      case 'playlist': return route.profileId ? <ProfilePlaylistView playlistId={route.id} profileId={route.profileId}/> : <PlaylistDetailView playlistId={route.id} />;
      case 'liked': return <LikedSongsView />;
      case 'downloads': return <SettingsView initialTab="downloads" />;
      case 'settings': return <SettingsView />;
      case 'profile': return <ProfileView id={route.id} />;
      case 'profile-listening': return <ProfileListeningView id={route.id} section={route.section}/>;
      default: return <LibraryView />;
    }
  };
  return <div ref={stage} className="page-stage"><div className="stationary-city" aria-hidden="true"/>
    {pages.map(name => <main key={name} ref={el => { panes.current[name] = el; }} id={current === name ? 'main-content-scroll' : undefined} aria-hidden={current !== name ? true : undefined} inert={current !== name} className="page-pane main-scroll" style={{ visibility: current === name ? 'visible' : 'hidden' }} {...(current === name ? handlers : {})}><div className="route-content">{name === 'home' ? <HomeView /> : name === 'search' ? <SearchView /> : name === 'recap' ? <RecapView /> : <LibraryView />}</div></main>)}
    {current === 'detail' && <motion.main layoutScroll key="detail" ref={el => { panes.current.detail = el; }} id="main-content-scroll" className="page-pane main-scroll detail-pane" {...handlers} onScroll={e => positions.current.set(routeKey, e.currentTarget.scrollTop)}><div key={routeKey} className="route-content">{detail()}</div>{['playlist','settings','downloads','profile-listening'].includes(route.type) && <div data-native-swipe aria-hidden="true" className="playlist-back-edge" />}</motion.main>}
  </div>;
}
