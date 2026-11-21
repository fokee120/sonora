import { AeroAtmosphere } from './AeroAtmosphere.js';
import { ComicStage } from '../common/ComicScene.js';
import { useAppearance } from '../../lib/appearance.js';
import {activeLyricIndex} from '../../lib/activeLyric.js';
import {useArtworkBrand} from '../../hooks/useArtworkBrand.js';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Minimize2,Loader2,FileText,Play,Pause,SkipBack,SkipForward,Shuffle,Repeat,Repeat1} from 'lucide-react';
import {useSongLyrics,type SongLyrics} from '../../lib/lyrics.js';
import {usePlayer} from '../../hooks/usePlayer.js';import {useNetworkState} from '../../hooks/useNetworkState.js';import {Overlay} from '../common/Overlay.js';import {Artwork} from '../common/Artwork.js';import {SeekBar} from './SeekBar.js';import {youtubeVideoId} from '../../lib/ytmusic/youtubeMusic.js';
export function ImmersivePlayer({isOpen,onClose}:{isOpen:boolean;onClose:()=>void}){return <Overlay isOpen={isOpen} onClose={onClose} label="Fullscreen listening" variant="immersive"><ImmersiveScene onClose={onClose}/></Overlay>;}
function ImmersiveScene({onClose}:{onClose:()=>void}){
 const { style, comicHeroId } = useAppearance();
 const comics = style === 'comics';
 const aero = style === 'aero';
 const p=usePlayer(),network=useNetworkState(),root=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null),controls=useRef<HTMLDivElement>(null),timer=useRef<ReturnType<typeof setTimeout>>(),keyboard=useRef(false),tapWasVisible=useRef(true);
 const interactive=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('button,input,a,.immersive-lyrics');
 const lyrics=useSongLyrics(p.currentTrack,true),[lyricsChoice,setLyricsChoice]=useState<boolean|null>(null),[wide,setWide]=useState(()=>matchMedia('(min-width:760px)').matches);
 const brandColor=useArtworkBrand(p.currentTrack);
 const showLyrics=!!lyrics&&(lyricsChoice??wide);
 useEffect(()=>setLyricsChoice(null),[p.currentTrack?.id]);
 useEffect(()=>{const query=matchMedia('(min-width:760px)');const changed=()=>setWide(query.matches);query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed);},[]);
 useEffect(()=>{const resize=()=>{const host=root.current?.closest('.overlay-surface') as HTMLElement|null;if(host)host.style.setProperty('--immersive-height',Math.round(Math.min(window.innerHeight,window.visualViewport?.height||window.innerHeight))+'px');};resize();window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);return()=>{window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);};},[]);
 const [visible,setVisible]=useState(true),[source,setSource]=useState(''),[videoReady,setVideoReady]=useState(false);const current=useRef(p);current.current=p;
 const hide=()=>{if(timer.current)clearTimeout(timer.current);keyboard.current=false;setVisible(false);};
 const reveal=()=>{setVisible(true);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{if(!keyboard.current)setVisible(false);},4000);};
 useEffect(()=>{reveal();const el=root.current;let native=false;void el?.requestFullscreen?.().then(()=>{native=true;}).catch(()=>{});const changed=()=>{if(native&&!document.fullscreenElement)onClose();};document.addEventListener('fullscreenchange',changed);return()=>{if(timer.current)clearTimeout(timer.current);document.removeEventListener('fullscreenchange',changed);if(document.fullscreenElement===el)void document.exitFullscreen().catch(()=>{});};},[]);
 useEffect(()=>{if(controls.current)controls.current.inert=!visible;},[visible]);
 useEffect(()=>{setSource('');setVideoReady(false);if(!p.currentTrack||!network.isOnline||matchMedia('(prefers-reduced-motion: reduce)').matches||(navigator as any).connection?.saveData)return;const id=youtubeVideoId(p.currentTrack);if(!/^[\w-]{11}$/.test(id))return;const c=new AbortController();void fetch('/api/visual/'+id,{signal:c.signal,cache:'no-store'}).then(r=>r.ok?r.json():null).then(v=>{if(!c.signal.aborted&&v?.available&&v.src==='/api/visual/'+id+'/media')setSource(v.src);}).catch(()=>{});return()=>c.abort();},[p.currentTrack?.id,network.isOnline]);
 useEffect(()=>{const v=video.current;if(!v||!source)return;v.muted=true;if(!p.isPlaying||document.visibilityState==='hidden'){v.pause();return;}if(v.readyState>=1&&Math.abs(v.currentTime-p.currentTime)>1.2)try{v.currentTime=p.currentTime;}catch{}void v.play().catch(()=>setVideoReady(false));},[source,p.isPlaying,p.currentTime]);
 useEffect(()=>{const changed=()=>{const v=video.current;if(!v)return;if(document.hidden)v.pause();else if(current.current.isPlaying)void v.play().catch(()=>{});};document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[]);
 if(!p.currentTrack)return null;
 const track=p.currentTrack;
 const cover = <div className="immersive-cover"><Artwork track={track} alt={track.title+' album cover'} eager/></div>;
 return <div className={'immersive-scene' + (comics ? ' comic-immersive' : aero ? ' aero-immersive' : '')} style={{'--brand-ink':brandColor} as React.CSSProperties} ref={root} tabIndex={-1} data-autofocus data-lyrics={showLyrics?'shown':'hidden'} data-controls={visible?'visible':'hidden'} onPointerMove={e=>{if(e.pointerType!=='touch'){keyboard.current=false;reveal();}}} onPointerDown={e=>{keyboard.current=false;tapWasVisible.current=visible;if(interactive(e.target))reveal();}} onClick={e=>{if(interactive(e.target))return;root.current?.focus({preventScroll:true});if(tapWasVisible.current)hide();else reveal();}} onFocusCapture={()=>{reveal();}} onKeyDown={e=>{if(e.code==='Space'&&!interactive(e.target)){e.preventDefault();if(!e.repeat){if(visible)hide();else reveal();}return;}keyboard.current=true;reveal();if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
 {aero ? <AeroAtmosphere mode="fullscreen"/> : <div className="immersive-gloss" aria-hidden="true"><Artwork track={track}/></div>}
 {source&&<video key={source} ref={video} className={'immersive-video'+(videoReady?' is-ready':'')} src={source} muted playsInline preload="metadata" disablePictureInPicture disableRemotePlayback aria-hidden="true" onLoadedMetadata={e=>{const v=e.currentTarget;v.muted=true;try{v.currentTime=current.current.currentTime;}catch{}if(current.current.isPlaying)void v.play().catch(()=>{});}} onPlaying={()=>setVideoReady(true)} onError={()=>{setSource('');setVideoReady(false);}}/>}
 <div className="immersive-shade" aria-hidden="true"/>
 <header className="immersive-brand"><svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="currentColor" opacity=".12"/><path d="M136 228v56M184 192v128M232 152v208M280 204v104M328 177v158M376 235v42" fill="none" stroke="currentColor" strokeWidth="23" strokeLinecap="round"/></svg><span>sonora</span></header>
 <div className="immersive-close" data-visible={visible}>{lyrics&&<button className="immersive-icon" aria-label="Show fullscreen lyrics" aria-pressed={showLyrics} onClick={()=>{setLyricsChoice(!showLyrics);reveal();}}><FileText size={23}/></button>}<button className="immersive-icon" aria-label="Exit fullscreen listening" onClick={onClose}><Minimize2 size={23}/></button></div>
 <div className={comics ? 'comic-immersive-layout' : aero ? 'aero-immersive-layout' : 'contents'}>
 <main className="immersive-composition">{comics ? <ComicStage heroId={comicHeroId}>{cover}</ComicStage> : aero ? <div className="aero-immersive-art">{cover}</div> : cover}<div className="immersive-label"><h1 title={track.title}>{track.title}</h1><p>{track.artist}</p></div>
 <div className="immersive-controls" ref={controls} aria-hidden={!visible}>
 <button className="immersive-icon" aria-label="Shuffle" aria-pressed={p.shuffle} onClick={p.toggleShuffle}><Shuffle size={21}/></button><button className="immersive-icon" aria-label="Previous song" onClick={p.previousSong}><SkipBack size={26} fill="currentColor"/></button>
 <button className="immersive-play" aria-label={p.isLoading?'Cancel loading':p.isPlaying?'Pause':'Play'} onClick={p.togglePlay}>{p.isLoading?<Loader2 className="animate-spin" size={27}/>:p.isPlaying?<Pause size={27} fill="currentColor"/>:<Play size={27} fill="currentColor"/>}</button>
 <button className="immersive-icon" aria-label="Next song" onClick={p.next}><SkipForward size={26} fill="currentColor"/></button><button className="immersive-icon" aria-label="Repeat" aria-pressed={p.repeatMode!=='off'} onClick={p.cycleRepeatMode}>{p.repeatMode==='one'?<Repeat1 size={21}/>:<Repeat size={21}/>}</button>
 </div></main>
 {showLyrics&&lyrics&&<ImmersiveLyrics key={track.id} lyrics={lyrics} position={p.currentTime} seek={p.seek}/>}</div>
 <footer className="immersive-timeline" data-visible={visible} inert={!visible}><SeekBar/>{p.error&&<p role="alert">{p.error}</p>}</footer>
 </div>;
}

function ImmersiveLyrics({lyrics,position,seek}:{key?:string;lyrics:SongLyrics;position:number;seek:(time:number)=>void}){
 const ref = useRef<HTMLElement>(null), manualUntil = useRef(0);
 const index = activeLyricIndex(lyrics.lines, position);
 const centerCurrent = useCallback((behavior: ScrollBehavior) => {
  const panel = ref.current;
  const active = panel?.querySelector<HTMLElement>('[data-current="true"]');
  if (!panel || !active || Date.now() < manualUntil.current) return;
  const top = active.offsetTop + (active.offsetHeight - panel.clientHeight) / 2;
  panel.scrollTo({ top, behavior });
 }, []);

 useEffect(() => {
  centerCurrent(matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
 }, [index, centerCurrent]);

 useEffect(() => {
  const panel = ref.current;
  if (!panel) return;
  const observer = new ResizeObserver(() => centerCurrent('instant'));
  observer.observe(panel);
  return () => observer.disconnect();
 }, [centerCurrent]);

 return <section className="immersive-lyrics" aria-label="Song lyrics" data-synced={lyrics.lines.length > 0} ref={ref} onWheel={()=>manualUntil.current=Date.now()+4000} onTouchMove={()=>manualUntil.current=Date.now()+4000}>
 {lyrics.lines.length?lyrics.lines.map((line,i)=>line.text.trim()&&<button key={i} data-current={i===index} aria-current={i===index?'true':undefined} aria-label={'Seek to lyric: '+line.text} onClick={()=>seek(line.time)}>{line.text}</button>):lyrics.plain.split(/\n+/).filter(Boolean).map((line,i)=><p key={i}>{line}</p>)}
 </section>;
}
