import {test,expect} from '@playwright/test';
import {wave} from './fixtures/bridge-media';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({status:204}));
 await page.addInitScript(()=>{
  (window as any).__sessionCalls=0;
  if(navigator.mediaSession){navigator.mediaSession.setActionHandler=()=>{(window as any).__sessionCalls++;};navigator.mediaSession.setPositionState=()=>{(window as any).__sessionCalls++;};}
 });
});
for (const codec of ['WAV','MP3','AAC']) test(codec+' HTTP audio plays and resumes without Sonora or Media Session customization',async({page})=>{
 await page.goto('/native-audio-check.html');
 await page.getByRole('button',{name:'Load '+codec+' sample'}).click();
 await page.evaluate(()=>document.querySelector('audio')!.play());
 await expect.poll(()=>page.evaluate(()=>document.querySelector('audio')!.currentTime)).toBeGreaterThan(.1);
 await page.evaluate(()=>document.querySelector('audio')!.pause());
 const time=await page.evaluate(()=>document.querySelector('audio')!.currentTime);
 await page.waitForTimeout(6100);
 expect(await page.evaluate(()=>document.querySelector('audio')!.currentTime)).toBeCloseTo(time,1);
 await page.evaluate(()=>document.querySelector('audio')!.play());
 await expect.poll(()=>page.evaluate(()=>document.querySelector('audio')!.currentTime)).toBeGreaterThan(time+.1);
 expect(await page.evaluate(()=>(window as any).__sessionCalls)).toBe(0);
});
test('saved-song baseline reads the existing audio store without modifying library records',async({page})=>{
 await page.goto('/');
 await page.evaluate(async bytes=>{const p='/src/lib/db.ts';const db=await(await import(p)).getDB();await db.put('tracks',{id:'native-fixture',title:'Saved native fixture',artist:'Fixture',duration:20,source:'local'});await db.put('audioBlobs',{trackId:'native-fixture',blob:new Blob([new Uint8Array(bytes)],{type:'audio/wav'}),cachedAt:123,size:bytes.length,mimeType:'audio/wav'});},[...wave(20)]);
 await page.goto('/native-audio-check.html');
 await expect(page.locator('#saved option')).toContainText(['Saved native fixture']);
 await page.getByRole('button',{name:'Load saved song'}).click();
 await expect(page.getByRole('status')).toContainText('Saved song loaded');
 await page.evaluate(()=>document.querySelector('audio')!.play());
 await expect.poll(()=>page.evaluate(()=>document.querySelector('audio')!.currentTime)).toBeGreaterThan(.1);
 expect(await page.evaluate(()=>(window as any).__sessionCalls)).toBe(0);
 expect(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('personal-music-player-db');r.onsuccess=()=>{const db=r.result;const q=db.transaction('audioBlobs','readonly').objectStore('audioBlobs').get('native-fixture');q.onsuccess=()=>{resolve({cachedAt:q.result.cachedAt,size:q.result.size});db.close();};};}))).toEqual({cachedAt:123,size:wave(20).length});
});
