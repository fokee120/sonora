import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const tracks = ['abcdefghijk', 'lmnopqrstuv'].map((id, index) => ({
  id: `ytm:${id}`, source: 'ytmusic', sourceId: id, cloudKey: `ytmusic://${id}`,
  title: index ? 'Second song' : 'First song', artist: 'Fixture', album: 'Album', duration: 180,
  artworkUrl: `https://yt3.googleusercontent.com/cover-${index}=w60-h60-l90-rj`,
}));

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(({ unsupported, ios }) => {
    if (ios) Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
    const handlers: Record<string, any> = {};
    (window as any).__mediaHandlers = handlers;
    const session = navigator.mediaSession;
    if (!session) return;
    const original = session.setActionHandler.bind(session);
    session.setActionHandler = (action, handler) => {
      if (unsupported && action === 'seekto') throw new DOMException('Unsupported', 'NotSupportedError');
      handlers[action] = handler;
      original(action, handler);
    };
    const audios: any[] = []; (window as any).__mediaAudios = audios;
    class AudioFixture extends EventTarget {
      src = ''; currentTime = 0; duration = Infinity; volume = 1; playbackRate = 1; preload = ''; paused = true; error = null;
      buffered = { length: 0, end: () => 0 };
      constructor() { super(); audios.push(this); }
      play() { this.paused = false; queueMicrotask(() => this.dispatchEvent(new Event('playing'))); return Promise.resolve(); }
      pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
      removeAttribute() { this.src = ''; } load() {}
    }
    (window as any).Audio = AudioFixture;
  }, { unsupported: info.title.includes('unsupported'), ios: info.title.includes('iOS') });
  await page.route('**/api/**', route => route.fulfill({ json: { tracks: [], albums: [], artists: [] } }));
  await page.goto('/');
  test.skip(!await page.evaluate(() => !!navigator.mediaSession && typeof MediaMetadata !== 'undefined'), 'This browser build does not expose the Media Session API; native lock-screen controls require a supported browser/device.');
  await page.evaluate(async tracks => {
    const dbPath = '/src/lib/db.ts', artPath = '/src/lib/artwork.ts';
    const db = await (await import(dbPath)).getDB();
    const { highQualityArtwork } = await import(artPath);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1200;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#426386'; ctx.fillRect(0, 0, 1200, 1200);
    const image = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    for (const track of tracks) await db.put('artworks', {
      id: `hq:${track.id}`, bytes: await image.arrayBuffer(), mimeType: 'image/png', cachedAt: Date.now(), sourceUrl: highQualityArtwork(track.artworkUrl),
    });
  }, tracks);
});

async function start(page: Page, index = 0) {
  await page.evaluate(async ({ tracks, index }) => {
    const path = '/src/lib/audio/PlayerEngine.ts';
    await (await import(path)).playerEngine.playTrack(tracks[index], tracks);
  }, { tracks, index });
}

test('lock-screen buttons skip songs, including Previous after more than three seconds', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const handlers = (window as any).__mediaHandlers;
    const path = '/src/lib/audio/PlayerEngine.ts'; const engine = (await import(path)).playerEngine;
    handlers.nexttrack();
    const nextId = engine.getState().currentTrack?.id;
    await Promise.resolve();
    const audio = (window as any).__mediaAudios.at(-1); audio.currentTime = 45; audio.dispatchEvent(new Event('timeupdate'));
    handlers.previoustrack();
    return { nextId, previousId: engine.getState().currentTrack?.id, back: handlers.seekbackward, forward: handlers.seekforward, seekTo: typeof handlers.seekto };
  });
  expect(result.nextId).toBe(tracks[1].id); expect(result.previousId).toBe(tracks[0].id);
  expect(result.back).toBeNull(); expect(result.forward).toBeNull(); expect(result.seekTo).toBe('function');
});

test('metadata advertises actual full-resolution pixels and their correct image type', async ({ page }) => {
  await start(page);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.artwork[0]?.sizes)).toBe('1200x1200');
  const result = await page.evaluate(async () => {
    const metadata = navigator.mediaSession.metadata!, artwork = metadata.artwork[0];
    const image = new Image(); image.src = artwork.src; await image.decode();
    return { title: metadata.title, count: metadata.artwork.length, type: artwork.type, local: artwork.src.startsWith('data:image/png'), width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(result).toEqual({ title: 'First song', count: 1, type: 'image/png', local: true, width: 1200, height: 1200 });
});

test('downloaded artwork is supplied to the lock screen without network access', async ({ page, context, browserName }) => {
  if (browserName === 'webkit') {
    await page.unroute('**/api/**'); await context.route(/^https?:\/\//, route => route.abort('internetdisconnected'));
  } else await context.setOffline(true);
  await start(page);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.artwork[0]?.src.startsWith('data:image/png'))).toBe(true);
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.artwork[0]?.sizes)).toBe('1200x1200');
});

test('a delayed previous cover cannot replace the next song on the lock screen', async ({ page }) => {
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL; let first = true;
    FileReader.prototype.readAsDataURL = function(blob) {
      if (!first) { original.call(this, blob); return; }
      first = false;
      (window as any).__oldCoverFinished = new Promise<void>(resolve => this.addEventListener('loadend', () => queueMicrotask(resolve), { once: true }));
      (window as any).__releaseCover = () => original.call(this, blob);
    };
  });
  await start(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseCover)).toBe('function');
  await start(page, 1);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.artwork[0]?.sizes)).toBe('1200x1200');
  await page.evaluate(async () => { (window as any).__releaseCover(); await (window as any).__oldCoverFinished; });
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Second song');
});

test('an unsupported optional action does not prevent track controls from being registered', async ({ page }) => {
  const handlers = await page.evaluate(() => {
    const value = (window as any).__mediaHandlers;
    return { next: typeof value.nexttrack, previous: typeof value.previoustrack, back: value.seekbackward, forward: value.seekforward };
  });
  expect(handlers).toEqual({ next: 'function', previous: 'function', back: null, forward: null });
});


test('iOS advertises track buttons and disables ten-second commands', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(() => {
    const handlers = (window as any).__mediaHandlers;
    return { next: typeof handlers.nexttrack, previous: typeof handlers.previoustrack, forward: handlers.seekforward, back: handlers.seekbackward };
  });
  expect(result).toEqual({ next: 'function', previous: 'function', forward: null, back: null });
});

test('iOS track controls are restored after the audio session starts again', async ({ page }) => {
  await start(page);
  const handlers = await page.evaluate(() => {
    const handlers = (window as any).__mediaHandlers;
    for (const key of ['nexttrack', 'previoustrack', 'seekforward', 'seekbackward']) handlers[key] = null;
    (window as any).__mediaAudios.at(-1).dispatchEvent(new Event('playing'));
    return Object.fromEntries(Object.entries(handlers).map(([key, value]) => [key, value === null ? 'disabled' : typeof value]));
  });
  expect(handlers).toMatchObject({ nexttrack: 'function', previoustrack: 'function', seekforward: 'disabled', seekbackward: 'disabled' });
});

test('iOS ignores an old pause event and repairs a stale lock-screen state without undoing a real pause', async ({ page }) => {
  await start(page);
  const playing = await page.evaluate(async () => { const path='/src/lib/audio/PlayerEngine.ts';const engine=(await import(path)).playerEngine;const audio=(window as any).__mediaAudios.at(-1);audio.dispatchEvent(new Event('pause'));navigator.mediaSession.playbackState='paused';audio.currentTime=2;audio.dispatchEvent(new Event('timeupdate'));return {playing:engine.getState().isPlaying,native:navigator.mediaSession.playbackState}; });
  expect(playing).toEqual({playing:true,native:'playing'});
  await page.evaluate(async()=>{const path='/src/lib/audio/PlayerEngine.ts';(await import(path)).playerEngine.pause();});
  await page.waitForTimeout(1200);
  expect(await page.evaluate(async()=>{const path='/src/lib/audio/PlayerEngine.ts';return {playing:(await import(path)).playerEngine.getState().isPlaying,native:navigator.mediaSession.playbackState};})).toEqual({playing:false,native:'paused'});
});


test('iOS automatically advances a queue on the same unlocked audio element', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const path = '/src/lib/audio/PlayerEngine.ts'; const engine = (await import(path)).playerEngine;
    const audios = (window as any).__mediaAudios;
    const first = audios.at(-1), count = audios.length;
    first.dispatchEvent(new Event('ended'));
    await Promise.resolve(); await Promise.resolve();
    return { same: first === audios.at(-1), addedPlayers: audios.length - count,
      nextId: engine.getState().currentTrack?.id };
  });
  expect(result).toEqual({ same: true, addedPlayers: 0, nextId: tracks[1].id });
  await expect.poll(() => page.evaluate(async () => { const path='/src/lib/audio/PlayerEngine.ts'; return {playing:(await import(path)).playerEngine.getState().isPlaying,native:navigator.mediaSession.playbackState}; })).toEqual({playing:true,native:'playing'});
});

test('iOS interface sounds never create a competing audio session', async ({ page }) => {
  expect(await page.evaluate(async () => {
    let created = 0;
    (window as any).AudioContext = class { constructor() { created++; } };
    const path = '/src/lib/uiFeedback.ts'; (await import(path)).playUiSound('tap');
    return created;
  })).toBe(0);
});


test('iOS repeated lock-screen taps cannot accumulate queue changes while switching', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async tracks => {
    const path = '/src/lib/audio/PlayerEngine.ts'; const engine = (await import(path)).playerEngine;
    const queue = [tracks[0], tracks[1], { ...tracks[1], id: 'ytm:12345678901', sourceId: '12345678901' }];
    engine.setQueue(queue, queue[0]);
    const handlers = (window as any).__mediaHandlers;
    handlers.nexttrack(); handlers.nexttrack(); handlers.previoustrack();
    return engine.getState().currentTrack?.id;
  }, tracks);
  expect(result).toBe(tracks[1].id);
});

test('iOS long-pause Play reconnects an expired capture at its saved position on the same native element', async ({page})=>{
 await start(page);
 await page.evaluate(()=>{
  const audio=(window as any).__mediaAudios.at(-1);audio.currentTime=47;audio.dispatchEvent(new Event('timeupdate'));
  (window as any).__mediaHandlers.pause();
 });
 const before=await page.evaluate(()=>({src:(window as any).__mediaAudios.at(-1).src,count:(window as any).__mediaAudios.length,paused:navigator.mediaSession.playbackState}));
 expect(before.paused).toBe('paused');
 await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';const engine=(await import(p)).playerEngine;(engine as any).pausedAt=Date.now()-120_000;(window as any).__resumeAudio=(engine as any).audio;Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});(window as any).__mediaHandlers.play();});
 await expect.poll(()=>page.evaluate(()=>(window as any).__mediaAudios.at(-1).src)).toContain('start=47');
 const result=await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';const engine=(await import(p)).playerEngine;return{same:(engine as any).audio===(window as any).__resumeAudio,count:(window as any).__mediaAudios.length,position:engine.getState().currentTime,id:engine.getState().currentTrack.id};});
 expect(result.same).toBe(true);expect(result.count).toBe(before.count);expect(result.position).toBe(47);expect(result.id).toBe(tracks[0].id);
});
test('iOS paused native sources remain attached and page-show repair never starts playback',async({page})=>{
 await start(page);
 const result=await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';const engine=(await import(p)).playerEngine;const audio=(engine as any).audio,src=audio.src;audio.currentTime=31;audio.dispatchEvent(new Event('timeupdate'));engine.pause();window.dispatchEvent(new PageTransitionEvent('pageshow'));return{src:audio.src,original:src,paused:audio.paused,position:engine.getState().currentTime,state:navigator.mediaSession.playbackState,play:typeof(window as any).__mediaHandlers.play};});
 expect(result.src).toBe(result.original);expect(result.paused).toBe(true);expect(result.position).toBe(31);expect(result.state).toBe('paused');expect(result.play).toBe('function');
});
test('iOS resumes a complete prepared current source after a long pause without reopening a live stream',async({page})=>{
 await start(page);
 await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';const engine=(await import(p)).playerEngine,audio=(engine as any).audio;audio.currentTime=52;audio.dispatchEvent(new Event('timeupdate'));engine.pause();(engine as any).resumeBuffer={id:engine.getState().currentTrack.id,duration:180,url:URL.createObjectURL(new Blob(['fixture'],{type:'audio/mpeg'})),source:'cloud'};(engine as any).pausedAt=Date.now()-120_000;await engine.play();});
 const result=await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';const engine=(await import(p)).playerEngine;return{src:(engine as any).audio.src,seek:(engine as any).nativeSeekOnMetadata,position:engine.getState().currentTime,sourceOffset:(engine as any).sourceOffset};});expect(result.src).toMatch(/^blob:/);expect(result.seek).toBe(52);expect(result.position).toBe(52);expect(result.sourceOffset).toBe(0);
});
test('iOS restores the paused song position after the page is discarded without autoplay',async({page})=>{
 await start(page);await page.evaluate(()=>{const audio=(window as any).__mediaAudios.at(-1);audio.currentTime=67;audio.dispatchEvent(new Event('timeupdate'));(window as any).__mediaHandlers.pause();});
 await page.reload();await expect(page.locator('#bottom-player-bar')).toBeVisible();
 const result=await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';const engine=(await import(p)).playerEngine;return{time:engine.getState().currentTime,playing:engine.getState().isPlaying,id:engine.getState().currentTrack?.id};});expect(result.time).toBe(67);expect(result.playing).toBe(false);expect(result.id).toBe(tracks[0].id);
 await page.evaluate(()=>(window as any).__mediaHandlers.play());await expect.poll(()=>page.evaluate(()=>(window as any).__mediaAudios.at(-1).src)).toContain('start=67');
});

// Model the native UI independently: WebKit can retain the declared JS value
// while replacing the underlying Now Playing session during a source handoff.
async function emulateStaleNativeSession(page: Page) {
  await page.evaluate(() => {
    const session = navigator.mediaSession;
    const state = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'playbackState')!;
    const metadata = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata')!;
    (window as any).__nativePlayback = 'paused';
    Object.defineProperty(session, 'playbackState', {
      configurable: true,
      get: () => state.get!.call(session),
      set: value => {
        const previous = state.get!.call(session);
        state.set!.call(session, value);
        // WebKit's setter returns early when the declared value is unchanged.
        if (previous !== value) (window as any).__nativePlayback = value;
      },
    });
    Object.defineProperty(session, 'metadata', {
      configurable: true,
      get: () => metadata.get!.call(session),
      set: value => { metadata.set!.call(session, value); (window as any).__nativePlayback = 'paused'; },
    });
    const register = session.setActionHandler.bind(session);
    session.setActionHandler = (action, handler) => {
      register(action, handler);
      (window as any).__nativePlayback = 'paused';
    };
  });
}

test('iOS republishes Playing after native controls and artwork refresh, even when the declared state is already playing', async ({ page }) => {
  await emulateStaleNativeSession(page);
  await start(page);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.artwork[0]?.sizes)).toBe('1200x1200');
  expect(await page.evaluate(() => (window as any).__nativePlayback)).toBe('playing');
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => (window as any).__nativePlayback)).toBe('playing');
  await page.evaluate(() => {
    (window as any).__nativePlayback = 'paused';
    (window as any).__mediaAudios.at(-1).dispatchEvent(new Event('playing'));
  });
  expect(await page.evaluate(() => (window as any).__nativePlayback)).toBe('playing');
  await start(page, 1);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Second song');
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.artwork[0]?.sizes)).toBe('1200x1200');
  expect(await page.evaluate(() => (window as any).__nativePlayback)).toBe('playing');
});

test('iOS a real pause survives delayed artwork, remote-control refresh and pending Playing updates', async ({ page }) => {
  await emulateStaleNativeSession(page);
  await start(page);
  await page.evaluate(() => (window as any).__mediaHandlers.pause());
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.artwork[0]?.sizes)).toBe('1200x1200');
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => ({ declared: navigator.mediaSession.playbackState, native: (window as any).__nativePlayback, paused: (window as any).__mediaAudios.at(-1).paused }))).toEqual({ declared: 'paused', native: 'paused', paused: true });
});

test('iOS refresh survives native same-task coalescing without releasing the media session',async({page})=>{
 await start(page);await expect.poll(()=>page.evaluate(()=>navigator.mediaSession.metadata?.artwork[0]?.sizes)).toBe('1200x1200');await page.waitForTimeout(1100);
 await page.evaluate(async()=>{const session=navigator.mediaSession,descriptor=Object.getOwnPropertyDescriptor(MediaSession.prototype,'playbackState')!;let committed=session.playbackState,pending=committed,timer:any=null;(window as any).__coalescedNative='paused';(window as any).__sessionWrites=[];Object.defineProperty(session,'playbackState',{configurable:true,get:()=>descriptor.get!.call(session),set:value=>{descriptor.set!.call(session,value);(window as any).__sessionWrites.push(value);pending=value;if(timer===null)timer=setTimeout(()=>{timer=null;if(pending!==committed){committed=pending;(window as any).__coalescedNative=pending;}},0);}});const p='/src/lib/audio/PlayerEngine.ts';(await import(p)).playerEngine.setupMediaSession();});
 await expect.poll(()=>page.evaluate(()=>(window as any).__coalescedNative)).toBe('playing');expect(await page.evaluate(()=>(window as any).__sessionWrites.includes('none'))).toBe(false);
 await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.setupMediaSession();e.pause();});await expect.poll(()=>page.evaluate(()=>(window as any).__coalescedNative)).toBe('paused');
});
