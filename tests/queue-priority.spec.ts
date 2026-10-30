import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
const tracks=['abcdefghijk','lmnopqrstuv','12345678901','11223344556'].map((id,i)=>({id:'ytm:'+id,source:'ytmusic',sourceId:id,cloudKey:'ytmusic://'+id,title:['Current song','Playlist next','My first pick','My second pick'][i],artist:'Artist',album:'Album',duration:180}));
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const audios:any[]=[];(window as any).__audios=audios;
  (window as any).Audio=class extends EventTarget{
   src='';currentTime=0;duration=180;volume=1;playbackRate=1;paused=true;error=null;buffered={length:0,end:()=>0};
   constructor(){super();audios.push(this);}play(){this.paused=false;queueMicrotask(()=>this.dispatchEvent(new Event('playing')));return Promise.resolve();}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}removeAttribute(){this.src='';}load(){}
  };
 });
 await page.route('**/api/**',r=>r.fulfill({json:{tracks:[],songs:[],artists:[],albums:[]}}));await page.goto('/');
 await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);await(await import(p)).playerEngine.playTrack(tracks[0],tracks.slice(0,2));},tracks);
});
test('manual requests play FIFO before the playlist and repeated adds stay one request',async({page})=>{
 const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;
  for(let i=0;i<20;i++)e.addToQueue(tracks[2]);e.addToQueue(tracks[3]);
  const order=e.getQueue().slice(e.getQueueIndex()+1).map(q=>q.track.id);
  const played=[];for(let i=0;i<3;i++){e.next();await Promise.resolve();played.push(e.getState().currentTrack.id);}
  return{order,played,count:e.getQueue().length};
 },tracks);
 expect(result.order).toEqual([tracks[2].id,tracks[3].id,tracks[1].id]);expect(result.played).toEqual(result.order);expect(result.count).toBe(4);
});
test('clear then add has no array alias and queuing the current song plays it exactly once',async({page})=>{
 const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.clearQueue();e.addToQueue(tracks[0]);e.addToQueue(tracks[1]);e.next();await Promise.resolve();const cursor=e.getQueueIndex();e.next();await Promise.resolve();return{count:e.getQueue().length,cursor,next:e.getState().currentTrack.id};},tracks);
 expect(result).toEqual({count:3,cursor:1,next:tracks[1].id});
});
test('manual Next ignores repeat-one while natural completion repeats only without pending manual picks',async({page})=>{
 const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.setRepeatMode('one');e.addToQueue(tracks[2]);(window as any).__audios.at(-1).dispatchEvent(new Event('ended'));await Promise.resolve();const natural=e.getState().currentTrack.id;e.next();await Promise.resolve();return{natural,next:e.getState().currentTrack.id};},tracks);
 expect(result).toEqual({natural:tracks[2].id,next:tracks[1].id});
});
test('Play Next promotes an existing pick and shuffle never moves manual requests behind the context',async({page})=>{
 const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.addToQueue(tracks[2]);e.addToQueue(tracks[3]);e.playNext(tracks[3]);e.toggleShuffle();e.toggleShuffle();return e.getQueue().slice(e.getQueueIndex()+1).map(q=>({id:q.track.id,manual:!!q.manual}));},tracks);
 expect(result).toEqual([{id:tracks[3].id,manual:true},{id:tracks[2].id,manual:true},{id:tracks[1].id,manual:false}]);
});
test('requesting a context song promotes it to Your queue without an extra future copy',async({page})=>{
 const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.addToQueue(tracks[2]);e.addToQueue(tracks[1]);return e.getQueue().slice(e.getQueueIndex()+1).map(q=>({id:q.track.id,manual:!!q.manual}));},tracks);
 expect(result).toEqual([{id:tracks[2].id,manual:true},{id:tracks[1].id,manual:true}]);
});
test('the exact repeated-song cursor survives reload and consumed manual requests do not repeat-all',async({page})=>{
 await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.addToQueue(tracks[0]);e.next();await Promise.resolve();const d='/src/lib/db.ts';await(await import(d)).dbService.getSetting('player_queue_cursor');},tracks);
 await page.reload();await expect(page.locator('#bottom-player-bar')).toBeVisible();
 const result=await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;const restored=e.getQueueIndex();e.setRepeatMode('all');e.next();await Promise.resolve();e.next();await Promise.resolve();return{restored,current:e.getState().currentTrack.id,manual:e.getQueue().filter(q=>q.manual).length};});
 expect(result).toEqual({restored:1,current:tracks[0].id,manual:0});
});
test('queue UI displays only upcoming entries, with manual picks first',async({page})=>{
 await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.addToQueue(tracks[2]);e.addToQueue(tracks[3]);e.next();await Promise.resolve();},tracks);
 await page.setViewportSize({width:1200,height:900});await page.locator('#bottom-player-bar').getByTitle('Queue',{exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Play Queue'});await expect(dialog.getByRole('region',{name:'Your queue'})).toContainText('My second pick');await expect(dialog.getByRole('region',{name:'Up next'})).toContainText('Playlist next');await expect(dialog.locator('.queue-row')).toHaveCount(2);await expect(dialog.locator('.queue-scroll')).not.toContainText('Current song');
});
test('loading and errors occupy a stable slot outside the mini player',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300);const before=await page.locator('#bottom-player-bar').boundingBox();
 await page.evaluate(async()=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;(window as any).__audios.at(-1).dispatchEvent(new Event('waiting'));});
 await expect(page.getByTestId('dock-notices')).toContainText('Buffering');await expect(page.locator('#bottom-player-bar [role=status],#bottom-player-bar [role=alert]')).toHaveCount(0);
 const after=await page.locator('#bottom-player-bar').boundingBox();expect(Math.abs(after!.height-before!.height)).toBeLessThan(1);expect(Math.abs(after!.y-before!.y)).toBeLessThan(1);
 await page.evaluate(()=>{const audio=(window as any).__audios.at(-1);audio.error={code:3};audio.dispatchEvent(new Event('error'));});await expect(page.getByTestId('dock-notices').getByRole('alert')).toBeVisible();
 const status=await page.getByTestId('dock-notices').boundingBox(),nav=await page.locator('#mobile-bottom-nav').boundingBox();if(nav)expect(status!.y+status!.height).toBeLessThanOrEqual(nav.y+1);
});

test('repeat-all restores promoted context songs in playlist order without repeating standalone manual picks',async({page})=>{
 const result=await page.evaluate(async tracks=>{const p='/src/lib/audio/PlayerEngine.ts',e=(await import(p)).playerEngine;e.addToQueue(tracks[2]);e.addToQueue(tracks[1]);e.setRepeatMode('all');const played=[];for(let i=0;i<5;i++){e.next();await Promise.resolve();played.push(e.getState().currentTrack.id);}return played;},tracks);
 expect(result).toEqual([tracks[2].id,tracks[1].id,tracks[0].id,tracks[1].id,tracks[0].id]);
});
