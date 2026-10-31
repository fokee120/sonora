import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const tracks=['abcdefghijk','lmnopqrstuv','12345678901'].map((id,i)=>({id:'ytm:'+id,source:'ytmusic',sourceId:id,cloudKey:'ytmusic://'+id,title:'Song '+i,artist:'Fixture',album:'Fixture',duration:180}));
async function swipe(page:any,index:number){const row=page.locator('#library-view .track-row').nth(index);const b=await row.locator('.song-row-copy').boundingBox();await page.mouse.move(b.x+100,b.y+10);await page.mouse.down();await page.mouse.move(b.x+10,b.y+10,{steps:10});await page.mouse.up();}
test.beforeEach(async({page})=>{await page.route('**/api/**',r=>r.fulfill({json:{tracks:[],songs:[],artists:[],albums:[]}}));await page.goto('/');await page.evaluate(async tracks=>{const d='/src/lib/db.ts',c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);const db=(await import(d)).dbService;await db.saveTracks(tracks);await db.savePlaylist({id:'mix',title:'My mix',trackIds:[],createdAt:1,updatedAt:1});},tracks);await page.reload();await page.getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('tab',{name:'Songs',exact:true}).click();await expect(page.locator('#library-view .track-row')).toHaveCount(3);});
test('swipes reuse the selected playlist without a popup and forget it on refresh',async({page})=>{
 await swipe(page,0);await page.getByRole('dialog',{name:'Add to playlist'}).getByRole('button',{name:'My mix',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await swipe(page,1);await expect(page.locator('#library-view .track-row').nth(1).getByRole('status')).toHaveText('Added to My mix');await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(async()=>{const d='/src/lib/db.ts';return(await(await import(d)).dbService.getPlaylist('mix')).trackIds;})).toEqual([tracks[2].id,tracks[0].id]);
 await page.reload();await page.getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('tab',{name:'Songs',exact:true}).click();await swipe(page,2);await expect(page.getByRole('dialog',{name:'Add to playlist'})).toBeVisible();
});
test('downloads show only a bottom bar and keep an accessible cancel action',async({page})=>{
 await page.evaluate(async id=>{const o='/src/lib/offline/OfflineManager.ts',m=(await import(o)).offlineManager;(m as any).downloadsCache.set(id,{trackId:id,status:'downloading',progress:43,phase:'fetching',bytesDownloaded:43,totalBytes:100});(m as any).notify();},tracks[0].id);
 const row=page.getByRole('group',{name:'Song 0 by Fixture',exact:true});await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow','43');await expect(row).not.toContainText(/43%|Downloading audio|Preparing audio|Cancel/);await expect(row.getByRole('button',{name:'Cancel download',exact:true})).toBeVisible();await expect(row.locator('.row-download-meter')).toHaveCSS('height','2px');
});
test('playlist cover stays clickable without a camera overlay',async({page})=>{
 await page.getByRole('tab',{name:'Playlists',exact:true}).click();await page.locator('#library-view').getByText('My mix',{exact:true}).click();await expect(page.getByRole('button',{name:'Change playlist cover',exact:true})).toBeVisible();await expect(page.locator('.playlist-cover-edit')).toHaveCount(0);const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Change playlist cover',exact:true}).click();await(await chooser).setFiles([]);
});

test('holding and vertical scrolling never reveal swipe actions in any theme',async({page})=>{
 const row=page.locator('#library-view .track-row').first(),underlay=row.locator('..').locator('.song-swipe-underlay');
 for(const theme of ['classic','notebook','retro','gotham','pink']){
  await page.evaluate(async theme=>{const p='/src/lib/appearance.ts';(await import(p)).chooseTheme(theme);},theme);
  await expect(underlay).toHaveCSS('visibility','hidden');
  const box=(await row.locator('.song-row-copy').boundingBox())!;const x=box.x+20,y=box.y+12;
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(480);await expect(underlay).toHaveCSS('visibility','hidden');await page.mouse.move(x+5,y+42,{steps:8});await expect(underlay).toHaveCSS('visibility','hidden');await row.dispatchEvent('pointercancel');await page.mouse.up();
 }
 const box=(await row.locator('.song-row-copy').boundingBox())!;const x=box.x+55,y=box.y+10;
 for(const direction of [1,-1]){
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+direction*48,y+12,{steps:10});await expect(underlay).toHaveAttribute('data-direction',direction===1?'right':'left');await expect(underlay).toHaveCSS('visibility','visible');await expect(underlay.locator('.song-swipe-action').nth(direction===1?1:0)).toHaveCSS('visibility','hidden');expect(await underlay.evaluate(e=>getComputedStyle(e).clipPath)).not.toBe('none');await row.dispatchEvent('pointercancel');await page.mouse.up();await expect(underlay).toHaveCSS('visibility','hidden');
 }
});
