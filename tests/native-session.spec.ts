import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {wave} from './fixtures/bridge-media';

test.use({serviceWorkers:'block'});
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
  const ms=navigator.mediaSession;
  (window as any).__handlers={};
  if(ms){const set=ms.setActionHandler.bind(ms);ms.setActionHandler=(action,handler)=>{(window as any).__handlers[action]=handler;set(action,handler);};}
  // Emulate WebKit's documented native fallback when no custom action exists.
  // These tests exercise real media events, not physical OS command delivery.
  (window as any).__remote=(action:string,details?:any)=>{
   const handler=(window as any).__handlers[action];
   if(handler)return handler(details);
   const audio=document.querySelector('audio[data-sonora-player]') as HTMLAudioElement;
   if(action==='play')return audio.play();
   if(action==='pause')return audio.pause();
   throw Error('Missing handler for '+action);
  };
 });
 await page.route('**/api/**',route=>route.fulfill({json:{status:'ok',tracks:[],artists:[],albums:[],user:null,authRequired:false}}));
 await page.goto('/');
});

async function seedNativeTransport(page:Page){
 const track={id:'ytm:abcdefghijk',source:'ytmusic',sourceId:'abcdefghijk',cloudKey:'ytmusic://abcdefghijk',title:'Native transport',artist:'Fixture',album:'Offline',duration:20};
 await page.evaluate(async({track,bytes})=>{
  const p='/src/lib/audio/PlayerEngine.ts',o='/src/lib/offline/OfflineManager.ts',d='/src/lib/db.ts';
  const e=(await import(p)).playerEngine,m=(await import(o)).offlineManager,db=(await import(d)).dbService;
  await (m as any).initialization;
  await m.audioStorage.save(track.id,new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));
  const completed={trackId:track.id,status:'completed',progress:100};
  await db.saveDownloadState(completed);(m as any).downloadsCache.set(track.id,completed);
  (window as any).__transportEngine=e;(window as any).__transportTrack=track;
  await e.playTrack(track,[track]);
 },{track,bytes:[...wave(20)]});
 await expect.poll(()=>page.evaluate(()=>(window as any).__transportEngine.getState().isPlaying)).toBe(true);
}

test('iOS local playback delegates remote transport to the browser and accepts trusted native resume without app play callbacks',async({page})=>{
 test.skip(!await page.evaluate(()=>!!navigator.mediaSession),'Native Media Session unavailable');
 await seedNativeTransport(page);
 expect(await page.evaluate(()=>({play:(window as any).__handlers.play,pause:(window as any).__handlers.pause}))).toEqual({play:null,pause:null});
 await page.evaluate(()=>{const e=(window as any).__transportEngine;e.audio.currentTime=4;e.audio.pause();Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});});
 await expect.poll(()=>page.evaluate(()=>(window as any).__transportEngine.getState().isPlaying)).toBe(false);
 const paused=await page.evaluate(()=>{const e=(window as any).__transportEngine;return {time:e.audio.currentTime,src:e.audio.src,queue:e.getQueue()};});
 await page.waitForTimeout(6000);
 expect(await page.evaluate(()=>(window as any).__transportEngine.audio.currentTime)).toBeCloseTo(paused.time,1);
 const resumed=await page.evaluate(async()=>{
  const e=(window as any).__transportEngine,a=e.audio;
  const source=a.src;let loads=0,trusted=false,registrations=0;
  const load=a.load.bind(a);a.load=()=>{loads++;load();};
  a.addEventListener('play',(event:Event)=>trusted=event.isTrusted,{once:true});
  const register=navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  navigator.mediaSession.setActionHandler=(action,handler)=>{registrations++;register(action,handler);};
  e.play=()=>{throw Error('Native transport must not reenter the app Play callback');};
  await a.play();
  return {loads,trusted,registrations,source,src:a.src,wants:e.wantsPlayback,playing:e.getState().isPlaying};
 });
 expect(resumed).toMatchObject({loads:0,trusted:true,registrations:0,source:paused.src,src:paused.src,wants:true,playing:true});
 await expect.poll(()=>page.evaluate(()=>(window as any).__transportEngine.audio.currentTime)).toBeGreaterThan(paused.time+.1);
 expect(await page.evaluate(()=>(window as any).__transportEngine.getQueue())).toEqual(paused.queue);
});

test('native transport rejects synthetic autoplay and returns app handlers for failure recovery and previews',async({page})=>{
 test.skip(!await page.evaluate(()=>!!navigator.mediaSession),'Native Media Session unavailable');
 await seedNativeTransport(page);
 const paused=await page.evaluate(async()=>{const e=(window as any).__transportEngine,a=e.audio;await new Promise<void>(resolve=>{a.addEventListener('pause',()=>resolve(),{once:true});a.pause();});a.dispatchEvent(new Event('play'));a.dispatchEvent(new Event('playing'));return {paused:a.paused,wants:e.wantsPlayback,playing:e.getState().isPlaying};});
 expect(paused).toEqual({paused:true,wants:false,playing:false});
 const recovery=await page.evaluate(()=>{const e=(window as any).__transportEngine;e.failPlayback('Fixture error');return {play:typeof(window as any).__handlers.play,pause:typeof(window as any).__handlers.pause};});
 expect(recovery).toEqual({play:'function',pause:'function'});
 await page.evaluate(()=>(window as any).__remote('play'));
 await expect.poll(()=>page.evaluate(()=>(window as any).__transportEngine.getState().isPlaying)).toBe(true);
 expect(await page.evaluate(()=>(window as any).__handlers.play===null)).toBe(true);
 await page.evaluate(()=>(window as any).__transportEngine.previewTrack((window as any).__transportTrack));
 expect(await page.evaluate(()=>({play:typeof(window as any).__handlers.play,pause:typeof(window as any).__handlers.pause}))).toEqual({play:'function',pause:'function'});
 await page.evaluate(()=>(window as any).__transportEngine.stopPreview(false));
 expect(await page.evaluate(()=>({playing:(window as any).__transportEngine.getState().isPlaying,paused:(window as any).__transportEngine.audio.paused}))).toEqual({playing:false,paused:true});
});

test('native Pause during buffering remains authoritative and native replay restores track handlers after EOF',async({page})=>{
 test.skip(!await page.evaluate(()=>!!navigator.mediaSession),'Native Media Session unavailable');
 await seedNativeTransport(page);
 const paused=await page.evaluate(()=>{const e=(window as any).__transportEngine;e.audio.dispatchEvent(new Event('waiting'));e.audio.pause();return {loading:e.getState().isLoading,wants:e.wantsPlayback};});
 await expect.poll(()=>page.evaluate(()=>(window as any).__transportEngine.getState().isPlaying)).toBe(false);
 expect(await page.evaluate(()=>({loading:(window as any).__transportEngine.getState().isLoading,wants:(window as any).__transportEngine.wantsPlayback}))).toEqual({loading:false,wants:false});
 await page.evaluate(()=>(window as any).__remote('play'));
 await expect.poll(()=>page.evaluate(()=>(window as any).__transportEngine.getState().isPlaying)).toBe(true);
 await page.evaluate(()=>{const a=(window as any).__transportEngine.audio;a.currentTime=a.duration-.1;});
 await expect.poll(()=>page.evaluate(()=>(window as any).__transportEngine.audio.ended)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).__handlers.play)).toBe('function');
 await page.evaluate(()=>(window as any).__remote('play'));
 await expect.poll(()=>page.evaluate(()=>(window as any).__transportEngine.getState().isPlaying)).toBe(true);
 expect(await page.evaluate(()=>({play:(window as any).__handlers.play,pause:(window as any).__handlers.pause}))).toEqual({play:null,pause:null});
});

test('offline validation parses bytes without acquiring any native audio session',async({page})=>{
 const fixtures=['offline-complete.webm','offline-infinite.webm','offline-complete.mp3'].map(name=>[...readFileSync(new URL(`./fixtures/${name}`,import.meta.url))]);
 const result=await page.evaluate(async({fixtures,wav})=>{
  const path='/src/lib/offline/audioCompleteness.ts';
  const {readAudioDuration,validateAudioBlob}=await import(path);
  const original=window.Audio,ctx=window.AudioContext;
  const forbidden=class{constructor(){throw Error('Validation acquired a native audio session');}};
  (window as any).Audio=forbidden;(window as any).AudioContext=forbidden;
  try{
   const durations=[];
   for(const bytes of fixtures)durations.push(await readAudioDuration(new Blob([new Uint8Array(bytes)],{type:'audio/webm'})));
   const blob=new Blob([new Uint8Array(wav)],{type:'audio/wav'});
   durations.push(await readAudioDuration(blob));
   let rejected=false;
   try{await validateAudioBlob(blob,{duration:120} as any,undefined,new Response(null,{headers:{'X-Audio-Complete':'true','X-Audio-Duration':'120'}}));}catch(e){rejected=String(e).includes('incomplete');}
   return {durations,rejected};
  }finally{window.Audio=original;window.AudioContext=ctx;}
 },{fixtures,wav:[...wave(3)]});
 for(const duration of result.durations)expect(duration).toBeCloseTo(3,1);
 expect(result.rejected).toBe(true);
});

test('installed iOS remote pause retains real music and a stopped clock even with a legacy keepalive preference',async({page})=>{
 test.skip(!await page.evaluate(()=>!!navigator.mediaSession),'Native Media Session unavailable in this browser build');
 const track={id:'ytm:abcdefghijk',source:'ytmusic',sourceId:'abcdefghijk',cloudKey:'ytmusic://abcdefghijk',title:'Pause contract',artist:'Fixture',album:'Offline',duration:15};
 await page.evaluate(async({track,bytes})=>{
  Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
  localStorage.setItem('sonora:ios-paused-keepalive:v1','1');
  const p='/src/lib/audio/PlayerEngine.ts',o='/src/lib/offline/OfflineManager.ts',d='/src/lib/db.ts';
  const engine=(await import(p)).playerEngine,manager=(await import(o)).offlineManager,db=(await import(d)).dbService;
  await (manager as any).initialization;
  await manager.audioStorage.save(track.id,new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));
  const completed={trackId:track.id,status:'completed',progress:100};
  await db.saveDownloadState(completed);(manager as any).downloadsCache.set(track.id,completed);
  await engine.playTrack(track,[track]);(window as any).__realPauseEngine=engine;
 },{track,bytes:[...wave(15)]});
 const snapshot=()=>page.evaluate(()=>{const e=(window as any).__realPauseEngine,a=e.audio;return {src:a.src,time:a.currentTime,paused:a.paused,loop:a.loop,playing:e.getState().isPlaying,position:e.getState().currentTime};});
 await expect.poll(async()=>(await snapshot()).time).toBeGreaterThan(.1);
 const original=(await snapshot()).src;
 await page.evaluate(()=>(window as any).__realPauseEngine.seek(4));
 await expect.poll(()=>page.evaluate(()=>{const e=(window as any).__realPauseEngine;return !e.audio.seeking&&e.audio.readyState>=2&&e.getState().isPlaying&&!e.getState().isLoading;})).toBe(true);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});(window as any).__remote('pause');});
 const paused=await snapshot();
 expect(paused.src).toBe(original);expect(paused.loop).toBe(false);expect(paused.paused).toBe(true);expect(paused.playing).toBe(false);
 await page.waitForTimeout(6000);
 expect((await snapshot()).time).toBeCloseTo(paused.time,1);
 const resume=await page.evaluate(()=>{const e=(window as any).__realPauseEngine,a=e.audio,play=a.play.bind(a);let calls=0;a.play=()=>{calls++;return play();};(window as any).__remote('play');return {calls,src:a.src};});
 expect(resume).toEqual({calls:1,src:original});
 await expect.poll(async()=>(await snapshot()).time).toBeGreaterThan(paused.time+.05);
});

test('real offline audio pauses, resumes, seeks and skips while background validation cannot create another player',async({page,context})=>{
 test.skip(!await page.evaluate(()=>!!navigator.mediaSession),'Native Media Session unavailable in this browser build');
 const tracks=['abcdefghijk','lmnopqrstuv'].map((id,i)=>({id:`ytm:${id}`,source:'ytmusic',sourceId:id,cloudKey:`ytmusic://${id}`,title:`Native control ${i}`,artist:'Fixture',album:'Offline',duration:15}));
 await page.evaluate(async({tracks,bytes})=>{
  const path='/src/lib/offline/OfflineManager.ts',player='/src/lib/audio/PlayerEngine.ts';
  await import(player);
  const validation='/src/lib/offline/audioCompleteness.ts';
  await(await import(validation)).readAudioDuration(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));
  const manager=(await import(path)).offlineManager;
  const db='/src/lib/db.ts';const service=(await import(db)).dbService;
  await (manager as any).initialization;
  for(const track of tracks){const blob=new Blob([new Uint8Array(bytes)],{type:'audio/wav'});await manager.audioStorage.save(track.id,blob);const state={trackId:track.id,status:'completed',progress:100};await service.saveDownloadState(state);(manager as any).downloadsCache.set(track.id,state);}
  (window as any).Audio=class{constructor(){throw Error('A second audio element would steal Now Playing');}};
  (window as any).AudioContext=class{constructor(){throw Error('A second audio context would steal Now Playing');}};
 },{tracks,bytes:[...wave(15)]});
 await context.setOffline(true);
 await page.evaluate(async tracks=>{const path='/src/lib/audio/PlayerEngine.ts';await(await import(path)).playerEngine.playTrack(tracks[0],tracks);},tracks);
 const state=()=>page.evaluate(async()=>{const path='/src/lib/audio/PlayerEngine.ts',e=(await import(path)).playerEngine;return {...e.getState(),paused:(e as any).audio.paused,time:(e as any).audio.currentTime,players:document.querySelectorAll('audio').length};});
 await expect.poll(async()=>(await state()).time).toBeGreaterThan(.1);
 // Reproduce validation completing while the real media element owns Now Playing.
 await page.evaluate(async bytes=>{const path='/src/lib/offline/audioCompleteness.ts';await(await import(path)).readAudioDuration(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));},[...wave(3)]);
 for(let i=0;i<3;i++){
  await page.evaluate(()=>(window as any).__remote('pause'));
  const paused=await state();expect(paused.paused).toBe(true);expect(paused.isLoading).toBe(false);expect(paused.isPlaying).toBe(false);
  await page.waitForTimeout(350);
  expect((await state()).time).toBeCloseTo(paused.time,1);
  await page.evaluate(()=>(window as any).__remote('play'));
  await expect.poll(async()=>(await state()).time).toBeGreaterThan(paused.time+.05);
 }
 await page.evaluate(()=>(window as any).__handlers.seekto({seekTime:5}));
 await expect.poll(async()=>(await state()).time).toBeGreaterThanOrEqual(5);
 await page.evaluate(()=>(window as any).__handlers.nexttrack());
 await expect.poll(async()=>(await state()).currentTrack?.id).toBe(tracks[1].id);
 await expect.poll(async()=>(await state()).isLoading).toBe(false);
 await page.evaluate(()=>(window as any).__handlers.previoustrack());
 await expect.poll(async()=>(await state()).currentTrack?.id).toBe(tracks[0].id);
 await expect.poll(async()=>(await state()).isPlaying).toBe(true);
 const end=await state();expect(end.error).toBeNull();expect(end.players).toBe(1);
});
