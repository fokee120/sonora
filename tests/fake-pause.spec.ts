import {test,expect} from '@playwright/test';
import {wave} from './fixtures/bridge-media';
test.use({serviceWorkers:'block'});
test('silent pause re-arms across resumes and yields to interruptions',async({page,context})=>{
 test.setTimeout(65_000);
 await page.addInitScript(()=>{localStorage.setItem('sonora:silent-pause-enabled','1');Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});(window as any).__handlers={};const m=navigator.mediaSession;if(m){const set=m.setActionHandler.bind(m);m.setActionHandler=(a,h)=>{(window as any).__handlers[a]=h;set(a,h);};}});
 await page.addInitScript(() => {
   const audioSession = Object.assign(new EventTarget(), { state: 'active', type: 'playback' });
   Object.defineProperty(navigator, 'audioSession', { configurable: true, value: audioSession });
   const session = navigator.mediaSession;
   const setPosition = session.setPositionState.bind(session);
   session.setPositionState = position => {
     (window as any).__reportedPosition = position;
     setPosition(position);
   };
 });
 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('/account/session')?{profile:{uid:'fixture',displayName:'Fixture'},expiresAt:Date.now()+86400000}:r.request().url().includes('/account/library')?{unchanged:true}:{status:'ok',tracks:[],albums:[],artists:[],enabled:false}}));
 await page.goto('/');await expect(page.getByRole('navigation')).toBeVisible();
 await page.evaluate(async bytes=>{const p='/src/lib/audio/PlayerEngine.ts',d='/src/lib/db.ts',o='/src/lib/offline/OfflineManager.ts',c='/src/lib/offline/AudioCache.ts';const e=(await import(p)).playerEngine,m=(await import(o)).offlineManager;await(m as any).initialization;await(await import(c)).audioCache.setLimit(0);const track={id:'ytm:abcdefghijk',source:'ytmusic',sourceId:'abcdefghijk',cloudKey:'ytmusic://abcdefghijk',title:'Pause fixture',artist:'Artist',album:'Test',duration:30};await(await import(d)).dbService.saveTracks([track]);await m.audioStorage.save(track.id,new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));(m as any).downloadsCache.set(track.id,{trackId:track.id,status:'completed',progress:100});await e.playTrack(track);(window as any).__music=(e as any).audio;},[...wave(30)]);
 const state=()=>page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;return{...e.getState(),time:(window as any).__music.currentTime,src:(window as any).__music.src,silent:(e as any).silentPause,contextState:(e as any).silentContext?.state,renderTime:(e as any).silentContext?.currentTime,nativePaused:(window as any).__music.paused,transport:navigator.mediaSession.playbackState,title:navigator.mediaSession.metadata?.title,reportedPosition:(window as any).__reportedPosition};});
 await expect.poll(async()=>(await state()).time).toBeGreaterThan(.2);
 const original=(await state()).src;
 await context.setOffline(true);
 for (let cycle = 0; cycle < 2; cycle++) {
   await page.evaluate(() => (window as any).__handlers.pause());
   const paused = await state();
   expect(paused.isPlaying).toBe(false);
   expect(paused.nativePaused).toBe(true);
   expect(paused.contextState).toBe('running');
   expect(paused.title).toBe('Paused');
   expect(paused.transport).toBe('paused');
   expect(paused.reportedPosition?.position).toBeLessThan(1);

   // Outlast the reported iPhone suspension window on both pauses.
   await expect.poll(async () => (await state()).reportedPosition?.position ?? 0, { timeout: 13_000 }).toBeGreaterThan(10);
   expect((await state()).time).toBeCloseTo(paused.time, 1);
   await page.evaluate(() => (window as any).__handlers.seekto({ seekTime: 8 }));
   expect((await state()).time).toBeCloseTo(paused.time, 1);
   await page.evaluate(() => (window as any).__handlers.play());
   await expect.poll(async () => (await state()).time).toBeGreaterThan(paused.time + 0.1);
   const resumed = await state();
   expect(resumed.silent).toBe(false);
   expect(resumed.src).toBe(original);
   expect(resumed.title).toBe('Pause fixture');
   expect(resumed.contextState).toBe('running');
   expect(resumed.renderTime).toBeGreaterThan((paused.renderTime ?? 0) + 10);
   expect(resumed.transport).toBe('playing');
 }

 // iOS can pause the native song before delivering the same Pause command.
 await page.evaluate(() => (window as any).__music.pause());
 await expect.poll(async () => (await state()).title).toBe('Paused');
 const nativePauseTime = (await state()).time;
 await page.evaluate(() => (window as any).__handlers.pause());
 expect((await state()).silent).toBe(true);
 expect((await state()).contextState).toBe('running');
 expect((await state()).time).toBeCloseTo(nativePauseTime, 1);
 await page.evaluate(() => (window as any).__handlers.play());
 await expect.poll(async () => (await state()).time).toBeGreaterThan(nativePauseTime + 0.1);

 for (const alreadyPaused of [false, true]) {
   if (alreadyPaused) await page.evaluate(() => (window as any).__handlers.pause());
   await page.evaluate(async () => {
     const path = '/src/lib/audio/PlayerEngine.ts';
     const engine = (await import(path)).playerEngine as any;
     const session = (navigator as any).audioSession;
     const renderContext = engine.silentContext;
     (window as any).__beforeInterruption = renderContext;
     (window as any).__resumeRequests = 0;
     const resume = renderContext.resume.bind(renderContext);
     renderContext.resume = () => {
       (window as any).__resumeRequests++;
       return resume();
     };
     // Model iOS suspending the renderer before Sonora receives its event.
     await renderContext.suspend();
     session.state = 'interrupted';
     session.dispatchEvent(new Event('statechange'));
     (window as any).__handlers.pause();
     (window as any).__handlers.play();
   });
   const interrupted = await state();
   expect(interrupted.silent).toBe(true);
   expect(interrupted.nativePaused).toBe(true);
   expect(interrupted.title).toBe('Paused');
   expect(interrupted.transport).toBe('paused');
   expect(interrupted.contextState).toBe('suspended');
   await page.evaluate(() => {
     const session = (navigator as any).audioSession;
     session.state = 'inactive';
     session.dispatchEvent(new Event('statechange'));
   });
   expect(await page.evaluate(() => (window as any).__resumeRequests)).toBe(0);
   expect((await state()).time).toBeCloseTo(interrupted.time, 1);
   expect((await state()).title).toBe('Paused');
   await page.evaluate(() => (window as any).__handlers.play());
   await expect.poll(async () => (await state()).time).toBeGreaterThan(interrupted.time + 0.1);
   expect((await state()).contextState).toBe('running');
   expect(await page.evaluate(async () => {
     const path = '/src/lib/audio/PlayerEngine.ts';
     return (window as any).__beforeInterruption === ((await import(path)).playerEngine as any).silentContext;
   })).toBe(true);
 }
 // Keep the silent renderer alive while the native resume is pending.
 await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.pause();const audio=(window as any).__music,original=audio.play.bind(audio);audio.play=()=>new Promise<void>((resolve,reject)=>{(window as any).__releaseResume=()=>{audio.play=original;original().then(resolve,reject);};});});
 await expect.poll(async()=>(await state()).contextState).toBe('running');
 await page.evaluate(()=>(window as any).__handlers.play());
 expect((await state()).silent).toBe(false);expect((await state()).nativePaused).toBe(true);expect((await state()).contextState).toBe('running');
 await page.evaluate(()=>(window as any).__releaseResume());
 await expect.poll(async()=>(await state()).isPlaying).toBe(true);
 const history=await page.evaluate(async()=>{const p='/src/lib/db.ts';return(await(await import(p)).dbService.getPlayHistory()).length;});expect(history).toBe(0);
 await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';const e=(await import(p)).playerEngine;e.pause();e.pause({hard:true});});
 expect((await state()).silent).toBe(false);expect((await state()).contextState).toBeUndefined();expect((await state()).isPlaying).toBe(false);
 await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;await e.play();e.pause();await e.playTrack(e.getState().currentTrack!);});
 await expect.poll(async()=>(await state()).isPlaying).toBe(true);expect((await state()).silent).toBe(false);expect((await state()).contextState).toBe('running');
});

test('online iPhone source starts without declaring a paused session while buffering',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});(window as any).__states=[];const m=navigator.mediaSession,d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(m),'playbackState')!;Object.defineProperty(m,'playbackState',{get:()=>d.get!.call(m),set:v=>{(window as any).__states.push(v);d.set!.call(m,v);}});});
 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('/account/session')?{profile:{uid:'fixture',displayName:'Fixture'},expiresAt:Date.now()+86400000}:r.request().url().includes('/account/library')?{unchanged:true}:{status:'ok',tracks:[],albums:[],artists:[],enabled:false}}));
 await page.route('**/api/ytmusic/stream/**',async r=>{await new Promise(resolve=>setTimeout(resolve,600));await r.fulfill({contentType:'audio/wav',body:wave(30)});});
 await page.goto('/');await expect(page.getByRole('navigation')).toBeVisible();
 await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);(window as any).__states=[];await(await import(p)).playerEngine.playTrack({id:'ytm:klmnopqrstz',source:'ytmusic',sourceId:'klmnopqrstz',cloudKey:'ytmusic://klmnopqrstz',title:'Online fixture',artist:'Artist',album:'Test',duration:30});});
 await expect.poll(()=>page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';return(await import(p)).playerEngine.getState().isPlaying;})).toBe(true);
 expect(await page.evaluate(()=>(window as any).__states)).not.toContain('paused');
});

test('silent pause is off by default and disabling it stops an active silent loop',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{const pref='/src/lib/audio/playbackPreferences.ts',engine='/src/lib/audio/PlayerEngine.ts';localStorage.removeItem('sonora:silent-pause-enabled');const p=await import(pref),e=(await import(engine)).playerEngine;const off=p.silentPauseEnabled();p.setSilentPauseEnabled(true);const on=p.silentPauseEnabled();(e as any).silentPause=true;let stopped=false;(e as any).silentContext={state:'running',close:async()=>{stopped=true;}};p.setSilentPauseEnabled(false);return{off,on,stopped,silent:(e as any).silentPause};});
 expect(result).toEqual({off:false,on:true,stopped:true,silent:false});
});
