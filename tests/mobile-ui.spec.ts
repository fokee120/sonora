import { test, expect, type Page, type Locator } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true });
const tracks = [
 { id:'ytm:abcdefghijk', source:'ytmusic', sourceId:'abcdefghijk', cloudKey:'ytmusic://abcdefghijk', title:'Aphrodite', artist:'RINI', album:'After the Sun', duration:271, artworkUrl:'https://yt3.googleusercontent.com/test-cover=w60-h60-l90-rj' },
 { id:'ytm:lmnopqrstuv', source:'ytmusic', sourceId:'lmnopqrstuv', cloudKey:'ytmusic://lmnopqrstuv', title:'Miracle', artist:'RINI', album:'After the Sun', duration:235, artworkUrl:'https://lh3.googleusercontent.com/test-cover-b=w120-h120-l90-rj' },
];
const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#526480"/><circle cx="600" cy="600" r="320" fill="#23314b"/></svg>';
async function setup(page: Page) {
 await page.addInitScript(() => {
  class AudioFixture extends EventTarget {
   src=''; currentTime=0; duration=271; volume=1; playbackRate=1; preload=''; paused=true; error=null; buffered={length:0,end:()=>0};
   play(){ this.paused=false; queueMicrotask(()=>this.dispatchEvent(new Event('playing'))); return Promise.resolve(); }
   pause(){this.paused=true;this.dispatchEvent(new Event('pause'));} load(){} removeAttribute(){this.src='';}
  }
  (window as any).Audio=AudioFixture;
 });
 await page.route('**/api/**', route => route.request().url().includes('/artwork?') ? route.fulfill({body:cover,contentType:'image/svg+xml'}) : route.fulfill({json:{tracks:[],albums:[],artists:[],user:null,configured:false,connected:false}}));
 await page.goto('/');
 await page.evaluate(async tracks=> {
  const path='/src/lib/db.ts'; const {dbService,getDB}=await import(path);
  await dbService.saveTracks(tracks);
  await dbService.setSetting('player_queue', tracks.map((track:any)=>({track,queueId:track.id})));
  await dbService.setSetting('player_track',tracks[0]);
  const db=await getDB(); await db.put('playlists',{id:'night',title:'Night drive',trackIds:[],createdAt:1,updatedAt:1});
  await db.put('history',{id:'old-b',trackId:tracks[1].id,playedAt:1});
  for(let i=0;i<40;i++) await db.put('history',{id:'repeat-'+i,trackId:tracks[0].id,playedAt:i+2});
 },tracks);
 await page.reload(); await expect(page.locator('#bottom-player-bar')).toBeVisible();
}
async function swipe(page:Page, target:Locator, dx:number, dy=0) {
 const box=await target.boundingBox(); const x=box!.x+box!.width/2, y=box!.y+box!.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up();
}
async function playerState(page:Page) { return page.evaluate(async()=>{const path='/src/lib/audio/PlayerEngine.ts';const engine=(await import(path)).playerEngine;return{...engine.getState(),queue:engine.getQueue()};}); }

test('standalone launch fills the screen even when iOS reports a shorter visual viewport',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'standalone',{value:true});
  if(window.visualViewport)Object.defineProperty(window.visualViewport,'height',{get:()=>innerHeight-64});
  // Model the separate iOS bug where dvh itself resolves shorter than lvh.
  // Merely mocking visualViewport.height did not catch the previous bad fix.
  const original=CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty=function(name,value,priority){return original.call(this,name,name==='--app-height' && value==='100dvh' ? `${innerHeight-64}px` : value,priority);};
 });
 await setup(page);await page.addStyleTag({content:':root{--safe-top:47px;--safe-bottom:34px}'});
 await expect.poll(()=>page.locator('.app-shell').evaluate(e=>Math.round(e.getBoundingClientRect().bottom))).toBe(844);
 for(const selector of ['html','body','#root','#mobile-bottom-nav']) await expect.poll(()=>page.locator(selector).evaluate(e=>Math.round(e.getBoundingClientRect().bottom))).toBe(844);
 await page.getByRole('button',{name:'Open player for Aphrodite'}).click();const sheet=page.getByRole('dialog',{name:'Now playing'});
 await expect.poll(()=>sheet.evaluate(e=>Math.round(e.getBoundingClientRect().bottom))).toBe(844);
 await page.screenshot({path:'.sonora/qa/player-new.png'});
});

test('playlists are first, categories and cloud integration are removed, and downloads are in Settings',async({page})=>{
 await setup(page);const nav=page.getByRole('navigation',{name:'Main navigation'});
 await expect(nav.getByRole('button')).toHaveCount(3);await expect(page.getByText('Your music.',{exact:true})).toHaveCount(0);
 await nav.getByRole('button',{name:'Library',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Playlists',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('tab')).toHaveCount(2);await expect(page.getByRole('button',{name:/Night drive/})).toBeVisible();
 await nav.getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('tabpanel',{name:'General',exact:true})).toBeVisible();
 await expect(page.getByText(/Google Drive|My Vault|Google Cloud|Sign in with Google/)).toHaveCount(0);
 await page.getByRole('tab',{name:'Downloads',exact:true}).click();await expect(page.locator('#downloads-view')).toBeVisible();
 for(const width of [375,320,430]) {await page.setViewportSize({width,height:844});await expect.poll(()=>page.locator('#settings-view').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);}
});

test('swiping the page moves between Home, Search and Library',async({page})=>{
 await setup(page);await swipe(page,page.locator('#home-view h1'),-130);await expect(page.locator('#search-view')).toBeVisible();
 await swipe(page,page.locator('#search-view h1'),-130);await expect(page.locator('#library-view')).toBeVisible();
 await swipe(page,page.locator('#library-view h1'),130);await expect(page.locator('#search-view')).toBeVisible();
});

test('library tabs switch on one tap and song rows have square corners and separators',async({page})=>{
 await setup(page); await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Library',exact:true}).click();
 const library=page.locator('#library-view'); const songs=library.getByRole('tab',{name:'Songs',exact:true}); const playlists=library.getByRole('tab',{name:'Playlists',exact:true});
 for(let i=0;i<3;i++){await songs.click();await expect(songs).toHaveAttribute('aria-selected','true');await expect(library.getByRole('tabpanel',{name:'songs'})).toBeVisible();await expect(library.getByText('Aphrodite',{exact:true})).toBeVisible();await playlists.click();await expect(playlists).toHaveAttribute('aria-selected','true');await expect(library.getByRole('tabpanel',{name:'playlists'})).toBeVisible();}
 await songs.click();const row=library.locator('.track-row').first();await expect(row).toBeVisible();expect(await row.evaluate(e=>getComputedStyle(e).borderRadius)).toBe('0px');expect(await row.locator('..').evaluate(e=>getComputedStyle(e).borderBottomWidth)).toBe('1px');
});

test('large song libraries only load nearby rows and still scroll to later songs',async({page})=>{
 await setup(page); await page.evaluate(async()=>{const dbPath='/src/lib/db.ts', cachePath='/src/lib/offline/AudioCache.ts'; await (await import(cachePath)).audioCache.setLimit(0); const {dbService}=await import(dbPath); await dbService.saveTracks(Array.from({length:500},(_,i)=>({id:`ytm:${String(i).padStart(11,'0')}`,source:'ytmusic',sourceId:String(i).padStart(11,'0'),cloudKey:`ytmusic://${String(i).padStart(11,'0')}`,title:`Large library song ${i}`,artist:'Test',album:'Test',duration:10}))); }); await page.reload(); await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Library',exact:true}).click(); const library=page.locator('#library-view'); await library.getByRole('tab',{name:'Songs'}).click(); await expect(library.getByText('Large library song 0',{exact:true})).toBeVisible(); expect(await library.locator('.track-row').count()).toBeLessThan(65);
 await page.evaluate(async()=>{const main=document.querySelector('#main-content-scroll')!; (window as any).__rowAnimations=0; main.addEventListener('animationstart',(event:Event)=>{if((event as AnimationEvent).animationName==='track-row-arrive')(window as any).__rowAnimations++;});main.scrollTop=120;await new Promise(resolve=>setTimeout(resolve,50));main.scrollTop=1500;}); await expect.poll(()=>page.evaluate(()=>(window as any).__rowAnimations)).toBeGreaterThan(0);
 const last=library.locator('.track-row-slot').last(); await last.scrollIntoViewIfNeeded(); await expect(library.getByText('Large library song 499',{exact:true})).toBeVisible(); expect(await library.locator('.track-row').count()).toBeLessThan(65);
});

test('keyboard does not displace the dock and song options are not clipped',async({page})=>{
 await setup(page); const row=page.getByTestId('recently-played').locator('.track-row').first(); await row.getByTitle('More options').click(); const menu=page.getByRole('dialog',{name:'Options for Aphrodite'}); await expect(menu.getByText('Play Next')).toBeVisible(); await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
 await page.getByRole('button',{name:'Search',exact:true}).click(); const input=page.locator('#search-view input').first(); await input.focus(); await page.evaluate(()=>{ if(window.visualViewport){Object.defineProperty(window.visualViewport,'height',{configurable:true,get:()=>innerHeight-300});window.visualViewport.dispatchEvent(new Event('resize'));} }); await expect(page.locator('.app-dock')).toBeHidden(); await expect.poll(()=>page.locator('.app-shell').evaluate(e=>Math.round(e.getBoundingClientRect().height))).toBe(844);
});

test('playlist edge swipe follows the pointer, reveals library, and leaves navigation usable',async({page})=>{
 await setup(page); const nav=page.getByRole('navigation',{name:'Main navigation'}); await nav.getByRole('button',{name:'Library',exact:true}).click(); await page.locator('#library-view').getByRole('button',{name:/Night drive/}).click(); await expect(page.locator('#playlist-detail-view')).toBeVisible();
 await page.mouse.move(10,300); await page.mouse.down(); await page.mouse.move(140,300,{steps:8});
 await expect.poll(()=>page.locator('#main-content-scroll').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41)).toBeGreaterThan(100);
 await expect(page.locator('[aria-hidden="true"] #library-view')).toBeAttached(); const previewY=await page.locator('[aria-hidden="true"] #library-view h1').evaluate(e=>e.getBoundingClientRect().top); await page.mouse.up(); await expect(page.locator('#library-view:visible')).toBeVisible(); const landedY=await page.locator('#main-content-scroll #library-view h1').evaluate(e=>e.getBoundingClientRect().top); expect(Math.abs(previewY-landedY)).toBeLessThan(2);
 await expect(page.locator('#playlist-detail-view')).toHaveCount(0); await expect(page.locator('[aria-hidden="true"] #library-view')).toHaveCount(0); await page.locator('#library-view').getByRole('tab',{name:'Songs'}).click(); await expect(page.locator('#library-view').getByRole('tabpanel',{name:'songs'})).toBeVisible(); await page.locator('#library-view').getByRole('tab',{name:'Playlists'}).click(); await expect(page.locator('#library-view').getByRole('tabpanel',{name:'playlists'})).toBeVisible();
 await nav.getByRole('button',{name:'Search',exact:true}).click(); await expect(page.locator('#search-view')).toBeVisible(); await nav.getByRole('button',{name:'Library',exact:true}).click(); await expect(page.locator('#library-view:visible')).toBeVisible();
});

test('interrupted playlist downloads resume and can be cancelled without removing completed songs',async({page})=>{
 await setup(page); await page.evaluate(async tracks => { const path='/src/lib/db.ts'; const {dbService}=await import(path); await dbService.mutatePlaylist('night',(p:any)=>({...p,trackIds:tracks.map((t:any)=>t.id)})); await dbService.saveDownloadState({trackId:tracks[0].id,status:'queued',progress:0,bytesDownloaded:0,totalBytes:0}); await dbService.saveDownloadState({trackId:tracks[1].id,status:'completed',progress:100,bytesDownloaded:1,totalBytes:1}); }, tracks);
 await page.route('**/api/ytmusic/download/**',async route=>{ await new Promise(resolve=>setTimeout(resolve,15000)); await route.abort().catch(()=>{}); });
 await page.reload(); const nav=page.getByRole('navigation',{name:'Main navigation'}); await nav.getByRole('button',{name:'Library',exact:true}).click(); await page.locator('#library-view').getByRole('button',{name:/Night drive/}).click(); const cancel=page.getByRole('button',{name:/Cancel playlist downloads, 1 of 2 complete/}); await expect(cancel).toBeVisible(); await cancel.click(); await expect(cancel).toHaveCount(0);
 const states=await page.evaluate(async()=>{const path='/src/lib/db.ts';return (await import(path)).dbService.getAllDownloads();}); expect(states.some((s:any)=>s.trackId==='ytm:lmnopqrstuv'&&s.status==='completed')).toBeTruthy();
});

test('playlist queue starts twenty downloads concurrently and cancels the whole batch',async({page})=>{
 await setup(page); await page.route('**/api/ytmusic/download/**',async route=>{await new Promise(resolve=>setTimeout(resolve,15000));await route.abort().catch(()=>{});});
 await page.evaluate(async()=>{const path='/src/lib/offline/OfflineManager.ts';const manager=(await import(path)).offlineManager;const tracks=Array.from({length:21},(_,i)=>({id:`ytm:${String(i).padStart(11,'0')}`,source:'ytmusic',sourceId:String(i).padStart(11,'0'),cloudKey:`ytmusic://${String(i).padStart(11,'0')}`,title:`Song ${i}`,artist:'Test',album:'Test',duration:100})); await manager.downloadPlaylist({id:'parallel-test',title:'Test',trackIds:tracks.map(t=>t.id),createdAt:1,updatedAt:1},tracks);});
 await expect.poll(()=>page.evaluate(async()=>{const path='/src/lib/offline/OfflineManager.ts';const manager=(await import(path)).offlineManager;return Array.from({length:21},(_,i)=>manager.getDownloadState(`ytm:${String(i).padStart(11,'0')}`)?.status).filter(s=>s==='downloading').length;})).toBe(20);
 await page.evaluate(async()=>{const path='/src/lib/offline/OfflineManager.ts';(await import(path)).offlineManager.cancelPlaylistDownloads({id:'parallel-test',title:'Test',trackIds:Array.from({length:21},(_,i)=>`ytm:${String(i).padStart(11,'0')}`),createdAt:1,updatedAt:1});});
 await expect.poll(()=>page.evaluate(async()=>{const path='/src/lib/offline/OfflineManager.ts';const manager=(await import(path)).offlineManager;return Array.from({length:21},(_,i)=>manager.isTrackDownloading(`ytm:${String(i).padStart(11,'0')}`)).filter(Boolean).length;})).toBe(0);
});

test('song-row swipes queue a song or open a playlist picker without playing or navigating',async({page})=>{
 await setup(page);const row=page.getByTestId('recently-played').locator('.track-row').first();
 const title=row.getByText('Aphrodite',{exact:true});await swipe(page,title,110);await expect(row.getByRole('status')).toHaveText('Added to queue');
 expect((await playerState(page)).queue.length).toBe(3);expect((await playerState(page)).isPlaying).toBe(false);
 await swipe(page,title,-95);await expect(page.getByRole('dialog',{name:'Add to playlist'})).toBeVisible();
 await page.getByRole('button',{name:'Night drive',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const ids=await page.evaluate(async()=>{const path='/src/lib/db.ts';return (await(await import(path)).dbService.getAllPlaylists())[0].trackIds;});
 expect(ids).toContain(tracks[0].id);expect((await playerState(page)).isPlaying).toBe(false);await expect(page.locator('#home-view')).toBeVisible();
});

test('song row keeps following horizontal motion when the finger drifts down',async({page})=>{
 await setup(page); const row=page.getByTestId('recently-played').locator('.track-row').first(); const box=await row.getByText('Aphrodite',{exact:true}).boundingBox(); const x=box!.x+8, y=box!.y+box!.height/2;
 await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+35,y,{steps:4}); await page.mouse.move(x+145,y+115,{steps:8}); await expect.poll(()=>row.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41)).toBeGreaterThan(125); await page.mouse.up(); await expect(row.getByRole('status')).toHaveText('Added to queue'); expect((await playerState(page)).queue.length).toBe(3);
});

test('mini and expanded players slide between songs and downward swipes close away from the handle',async({page})=>{
 await setup(page);await swipe(page,page.locator('.mini-track'),-120);await expect(page.getByRole('button',{name:'Open player for Miracle'})).toBeVisible();
 await swipe(page,page.locator('.mini-track'),120);await expect(page.getByRole('button',{name:'Open player for Aphrodite'})).toBeVisible();
 await page.getByRole('button',{name:'Open player for Aphrodite'}).click();let sheet=page.getByRole('dialog',{name:'Now playing'});
 await expect.poll(()=>sheet.evaluate(e=>getComputedStyle(e).transform)).toBe('none');
 await swipe(page,sheet.locator('.player-artwork'),-110);await expect(sheet.getByRole('heading',{name:'Miracle'})).toBeVisible();
 await swipe(page,sheet.locator('.player-song-heading'),110);await expect(sheet.getByRole('heading',{name:'Aphrodite'})).toBeVisible();
 await swipe(page,sheet.locator('.player-artwork'),0,130);await expect(sheet).toHaveCount(0);
 await page.getByRole('button',{name:'Open player for Aphrodite'}).click();await expect(sheet).toBeVisible();
 await expect.poll(()=>sheet.evaluate(e=>getComputedStyle(e).transform)).toBe('none');
 await swipe(page,sheet.locator('.player-song-heading'),0,125);await expect(sheet).toHaveCount(0);
});

test('high-resolution artwork is stored as image bytes and loads in the player offline',async({page,context,browserName})=>{
 await setup(page);
 await expect.poll(()=>page.evaluate(async()=>{const path='/src/lib/artwork.ts';return !!(await(await import(path)).readArtwork('ytm:abcdefghijk'));})).toBe(true);
 const saved=await page.evaluate(async()=>{const path='/src/lib/db.ts';const r=await(await(await import(path)).getDB()).get('artworks','hq:ytm:abcdefghijk');return{url:r.sourceUrl,size:r.bytes.byteLength};});
 expect(saved.url).toContain('w1200-h1200');expect(saved.size).toBeGreaterThan(0);
 if (browserName === 'webkit') {
  // WebKit offline emulation can reject locally fulfilled resources (#42775).
  // Block every HTTP request instead; local data URLs must still render.
  await page.unroute('**/api/**'); await context.route(/^https?:\/\//,route=>route.abort('internetdisconnected'));
 } else await context.setOffline(true);
 await page.getByRole('button',{name:'Open player for Aphrodite'}).click();
 const image=page.getByRole('dialog',{name:'Now playing'}).locator('.player-artwork img').last();
 await expect(image).toHaveAttribute('src',/^(blob:|data:image\/)/);await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>e.naturalWidth)).toBe(1200);
});

test('repeat history shows one row per song and updates immediately',async({page})=>{
 await setup(page);const rows=page.getByTestId('recently-played').locator('.track-row');await expect(rows).toHaveCount(2);
 await page.evaluate(async()=>{const path='/src/lib/db.ts';await(await import(path)).dbService.addHistory('ytm:lmnopqrstuv');});
 await expect(rows.first()).toContainText('Miracle');await expect(rows).toHaveCount(2);
});

test('native touch gestures are not cancelled by vertical page scrolling', async ({ page, browserName }) => {
 test.skip(browserName !== 'chromium', 'Native touch protocol check uses Chromium CDP; pointer gestures are checked in both engines.');
 await setup(page);
 const client = await page.context().newCDPSession(page);
 const touchSwipe = async (target: Locator, dx: number, dy: number) => {
  const box = await target.boundingBox(); const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 12; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 12, y: y + dy * i / 12, id: 1 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
 };
 const row = page.getByTestId('recently-played').locator('.track-row').first();
 await touchSwipe(row.getByText('Aphrodite', { exact: true }), 110, 0);
 await expect(row.getByRole('status')).toHaveText('Added to queue');
 await page.getByRole('button', { name: 'Open player for Aphrodite' }).click();
 const sheet = page.getByRole('dialog', { name: 'Now playing' });
 await expect.poll(() => sheet.evaluate(element => getComputedStyle(element).transform)).toBe('none');
 await touchSwipe(sheet.locator('.player-artwork'), 0, 130);
 await expect(sheet).toHaveCount(0);
 await client.detach();
});
