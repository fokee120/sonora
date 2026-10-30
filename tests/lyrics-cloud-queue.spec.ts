import {test,expect,type Page} from '@playwright/test';
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const tracks=Array.from({length:10},(_,i)=>({id:'ytm:'+String(i).padStart(11,'0'),source:'ytmusic',sourceId:String(i).padStart(11,'0'),cloudKey:'ytmusic://'+String(i).padStart(11,'0'),title:'Fixture song '+i,artist:'Fixture artist',album:'Fixture album',duration:180}));
async function setup(page:Page,lyrics=true){await page.addInitScript(()=>{(window as any).Audio=class extends EventTarget{src='';currentTime=0;duration=180;volume=1;paused=true;error=null;buffered={length:0,end:()=>0};play(){this.paused=false;queueMicrotask(()=>this.dispatchEvent(new Event('playing')));return Promise.resolve();}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}removeAttribute(){this.src='';}load(){}};});await page.route('**/api/**',r=>r.fulfill({json:{tracks:[],songs:[],artists:[],albums:[]}}));await page.route('https://lrclib.net/**',r=>r.fulfill({status:lyrics?200:404,json:lyrics?{syncedLyrics:'[00:00.00]First fixture line\n[00:10.00]Second fixture line\n[00:20.00]Third fixture line'}:[]}));await page.goto('/');await page.evaluate(async tracks=>{const d='/src/lib/db.ts',c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);const {dbService}=await import(d);await dbService.saveTracks(tracks);await dbService.setSetting('player_track',tracks[0]);await dbService.setSetting('player_queue',tracks.slice(0,3).map((track,i)=>({track,queueId:'q'+i})));},tracks);await page.reload();await expect(page.locator('#bottom-player-bar')).toBeVisible();}
test('lyrics preview sits below the controls and synced lines follow playback and seek',async({page})=>{await setup(page);await page.locator('.mini-track').click();const player=page.getByRole('dialog',{name:'Now playing'});await expect(player.getByTitle('Open lyrics')).toBeVisible();const preview=player.locator('.lyrics-preview');await expect(preview).toBeAttached();expect(await preview.evaluate(e=>{const box=e.getBoundingClientRect();return box.top>=innerHeight-20;})).toBe(true);await preview.scrollIntoViewIfNeeded();await preview.click();const lyrics=page.getByRole('dialog',{name:'Lyrics',exact:true});await expect(lyrics).toBeVisible();await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.state={...e.getState(),currentTime:12};e.notifyState();});await expect(lyrics.getByRole('button',{name:'Second fixture line',exact:true})).toHaveAttribute('aria-current','true');await lyrics.getByRole('button',{name:'Third fixture line',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';return(await import(p)).playerEngine.getState().currentTime;})).toBe(20);await page.screenshot({path:'.sonora/qa/synced-lyrics.png'});await lyrics.getByRole('button',{name:'Close lyrics'}).click();await expect(player).toBeVisible();});
test('unsupported songs render no lyrics box or button',async({page})=>{await setup(page,false);await page.locator('.mini-track').click();await expect(page.getByRole('dialog',{name:'Now playing'})).toBeVisible();await expect(page.locator('.lyrics-preview')).toHaveCount(0);await expect(page.getByTitle('Open lyrics')).toHaveCount(0);await expect(page.getByText(/No lyrics|Toggle lyrics/)).toHaveCount(0);});
test('custom queue keeps FIFO priority, then follows the last selected source playlist',async({page})=>{await setup(page);const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;await e.playPlaylist('a',tracks.slice(0,3),false);e.addToQueue(tracks[4],{playlistId:'b',tracks:tracks.slice(3,6),shuffle:false});const first=e.getQueue().slice(e.getQueueIndex()+1).map(i=>i.track.id);e.addToQueue(tracks[7],{playlistId:'c',tracks:tracks.slice(6),shuffle:false});const second=e.getQueue().slice(e.getQueueIndex()+1).map(i=>({id:i.track.id,manual:!!i.manual}));e.next();await Promise.resolve();const selectedB=e.getState().playlistId;e.next();await Promise.resolve();const selectedC=e.getState().playlistId;return {first,second,selectedB,selectedC};},tracks);expect(result.first).toEqual([tracks[4].id,tracks[5].id]);expect(result.second).toEqual([{id:tracks[4].id,manual:true},{id:tracks[7].id,manual:true},{id:tracks[8].id,manual:false},{id:tracks[9].id,manual:false}]);expect(result.selectedB).toBe('b');expect(result.selectedC).toBe('c');});
test('removing a custom pick restores the prior automatic context',async({page})=>{await setup(page);const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;await e.playPlaylist('a',tracks.slice(0,3),false);e.addToQueue(tracks[4],{playlistId:'b',tracks:tracks.slice(3,6),shuffle:false});const manual=e.getQueue().find(i=>i.manual);e.removeFromQueue(manual.queueId);return e.getQueue().slice(e.getQueueIndex()+1).map(i=>i.track.id);},tracks);expect(result).toEqual([tracks[1].id,tracks[2].id]);});
test('source queue removal survives reload and Clear never restores old automatic songs',async({page})=>{await setup(page);await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;await e.playPlaylist('a',tracks.slice(0,3),false);e.addToQueue(tracks[4],{playlistId:'b',tracks:tracks.slice(3,6),shuffle:false});await e.queuePersistence;},tracks);await page.reload();await expect.poll(()=>page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';return(await import(p)).playerEngine.getQueue().some(i=>i.manual);})).toBe(true);const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;const manual=e.getQueue().find(i=>i.manual);e.removeFromQueue(manual.queueId);const restored=e.getQueue().slice(e.getQueueIndex()+1).map(i=>i.track.id);e.addToQueue(tracks[4],{playlistId:'b',tracks:tracks.slice(3,6),shuffle:false});e.clearQueue();e.addToQueue(tracks[7]);return {restored,cleared:e.getQueue().slice(e.getQueueIndex()+1).map(i=>i.track.id)};},tracks);expect(result.restored).toEqual([tracks[1].id,tracks[2].id]);expect(result.cleared).toEqual([tracks[7].id]);});

test('lyrics scrolling yields to downward dismissal only at the top',async({page})=>{
  await setup(page);await page.locator('.mini-track').click();
  const player=page.getByRole('dialog',{name:'Now playing'}),content=player.locator('.now-playing-content');
  await expect(player.getByTitle('Open lyrics')).toBeVisible();
  const drag=async(from:number,to:number)=>content.evaluate((element,{from,to})=>{
    const target=element.querySelector('.player-art-stage')!;
    const fire=(type:string,y:number)=>{
      const touch={identifier:1,target,clientX:180,clientY:y};
      const event=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperties(event,{touches:{value:type==='touchend'?[]:[touch]},changedTouches:{value:[touch]}});
      target.dispatchEvent(event);return event.defaultPrevented;
    };
    fire('touchstart',from);const prevented=fire('touchmove',to);fire('touchend',to);return prevented;
  },{from,to});
  expect(await drag(450,300)).toBe(false);await expect(player).toBeVisible();
  await content.evaluate(e=>{e.scrollTop=150;});
  expect(await drag(300,450)).toBe(false);await expect(player).toBeVisible();
  await content.evaluate(e=>{e.scrollTop=0;});
  expect(await drag(300,450)).toBe(true);await expect(player).toHaveCount(0);
});

test('real touchscreen scrolls lyrics and can dismiss the player from the artwork',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Real touch input is dispatched through Chromium CDP');
  await setup(page);await page.locator('.mini-track').click();
  const player=page.getByRole('dialog',{name:'Now playing'}),content=player.locator('.now-playing-content');
  await expect(player.getByTitle('Open lyrics')).toBeVisible();
  await expect(player).toBeVisible();
  await expect.poll(()=>player.evaluate(e=>Math.abs(e.getBoundingClientRect().top))).toBeLessThan(1);
  const session=await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  const drag=async(from:number,to:number)=>{
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:from}]});
    for(let i=1;i<=15;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:from+(to-from)*i/15}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  const art=await player.locator('.player-art-stage').boundingBox();
  const start=art!.y+art!.height/2;
  await drag(start,start-180);await expect.poll(()=>content.evaluate(e=>e.scrollTop)).toBeGreaterThan(20);await expect(player).toBeVisible();
  await content.evaluate(e=>{e.scrollTop=0;});
  await expect.poll(()=>content.evaluate(e=>e.scrollTop)).toBe(0);
  await drag(start,start+180);await expect(player).toHaveCount(0);
});

test('playback progress does not disturb a held player drag or repaint the artwork',async({page})=>{
 await setup(page);await page.locator('.mini-track').click();const player=page.getByRole('dialog',{name:'Now playing'});
 await expect(player.getByTitle('Open lyrics')).toBeVisible();await expect.poll(()=>player.evaluate(e=>Math.abs(e.getBoundingClientRect().top))).toBeLessThan(1);
 const art=await player.locator('.player-art-stage').boundingBox();const y=art!.y+art!.height/2;
 await page.mouse.move(180,y);await page.mouse.down();await page.mouse.move(180,y+120,{steps:10});
 await expect.poll(()=>player.evaluate(e=>e.getBoundingClientRect().top)).toBeGreaterThan(100);
 await player.locator('.player-art-stage').evaluate(e=>{(window as any).__artChanges=0;const observer=new MutationObserver(records=>{(window as any).__artChanges+=records.length;});observer.observe(e,{subtree:true,attributes:true,childList:true});(window as any).__artObserver=observer;});
 await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;for(let i=1;i<=60;i++){e.state={...e.getState(),currentTime:i,bufferedTime:i+10};e.notifyState();}});
 expect(await page.evaluate(()=>(window as any).__artChanges)).toBe(0);
 expect(await player.evaluate(e=>e.getBoundingClientRect().top)).toBeGreaterThan(100);
 await page.mouse.up();await expect(player).toHaveCount(0);await expect(page.locator('#bottom-player-bar')).toBeVisible();
});

test('fullscreen title opens its source playlist and preserves playback',async({page})=>{await setup(page,false);await page.evaluate(async tracks=>{const d='/src/lib/db.ts',p='/src/lib/audio/PlayerEngine.ts';await(await import(d)).dbService.savePlaylist({id:'title-source',title:'Source playlist',trackIds:tracks.slice(0,3).map(t=>t.id),createdAt:1,updatedAt:1});await(await import(p)).playerEngine.playPlaylist('title-source',tracks.slice(0,3),false);},tracks);await page.locator('.mini-track').click();await page.getByRole('button',{name:'Open source playlist for Fixture song 0'}).click();await expect(page.locator('#playlist-detail-view h1')).toHaveText('Source playlist');expect(await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts';return(await import(p)).playerEngine.getState().currentTrack?.id;})).toBe(tracks[0].id);});

test('fullscreen Add to playlist saves the current song and keeps the player open',async({page})=>{await setup(page,false);await page.evaluate(async()=>{const p='/src/lib/db.ts';await(await import(p)).dbService.savePlaylist({id:'player-picks',title:'Player picks',trackIds:[],createdAt:1,updatedAt:1});});await page.reload();await page.locator('.mini-track').click();const player=page.getByRole('dialog',{name:'Now playing'});await player.getByRole('button',{name:'Add to playlist',exact:true}).click();const picker=page.getByRole('dialog',{name:'Add to playlist',exact:true});await expect(picker).toContainText('Fixture song 0');await picker.locator('.playlist-library-row').filter({hasText:'Player picks'}).click();await expect(picker).toHaveCount(0);await expect(player).toBeVisible();await expect(player.getByTitle('Download song')).toHaveCount(0);expect(await page.evaluate(async()=>{const p='/src/lib/db.ts';return(await(await import(p)).dbService.getPlaylist('player-picks'))?.trackIds;})).toEqual([tracks[0].id]);});
