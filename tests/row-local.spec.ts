import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const tracks=['abcdefghijk','lmnopqrstuv','12345678901'].map((id,i)=>({id:'ytm:'+id,source:'ytmusic',sourceId:id,cloudKey:'ytmusic://'+id,title:'Song '+i,artist:'Fixture',album:'Fixture',duration:180}));
async function swipe(page:any,index:number){const row=page.locator('#library-view .track-row').nth(index);const b=await row.locator('.song-row-copy').boundingBox();await page.mouse.move(b.x+100,b.y+10);await page.mouse.down();await page.mouse.move(b.x+10,b.y+10,{steps:10});await page.mouse.up();}
test.beforeEach(async({page})=>{await page.route('**/api/**',route=>{
 const path=new URL(route.request().url()).pathname;
 if(path==='/api/account/session')return route.fulfill({json:{profile:{uid:'row-fixture',displayName:'Fixture'},expiresAt:Date.now()+86400000}});
 if(path==='/api/account/library')return route.fulfill({json:{unchanged:true}});
 return route.fulfill({json:{status:'ok',tracks:[],songs:[],artists:[],albums:[]}});
});await page.goto('/');await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();await page.evaluate(async tracks=>{const d='/src/lib/db.ts',c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);const db=(await import(d)).dbService;await db.saveTracks(tracks);await db.savePlaylist({id:'mix',title:'My mix',trackIds:[],createdAt:1,updatedAt:1});await db.savePlaylist({id:'later',title:'Later',trackIds:[],createdAt:2,updatedAt:2});},tracks);await page.reload();await page.getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('tab',{name:'Songs',exact:true}).click();await expect(page.locator('#library-view .track-row')).toHaveCount(3);});
test('swipes reuse the selected playlist without a popup and forget it on refresh',async({page})=>{
 await swipe(page,0);await page.getByRole('dialog',{name:'Add to playlist'}).getByRole('button',{name:'My mix',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await swipe(page,1);await expect(page.locator('#library-view .track-row').nth(1).getByRole('status')).toHaveText('Added to My mix');await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(async()=>{const d='/src/lib/db.ts';return(await(await import(d)).dbService.getPlaylist('mix')).trackIds;})).toEqual([tracks[2].id,tracks[0].id]);
 await page.reload();await page.getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('tab',{name:'Songs',exact:true}).click();await swipe(page,2);await expect(page.getByRole('dialog',{name:'Add to playlist'})).toBeVisible();
});
test('downloads show only a bottom bar and keep an accessible cancel action',async({page})=>{
 await page.evaluate(async id=>{const o='/src/lib/offline/OfflineManager.ts',m=(await import(o)).offlineManager;(m as any).downloadsCache.set(id,{trackId:id,status:'downloading',progress:43,phase:'fetching',bytesDownloaded:43,totalBytes:100});(m as any).notify();},tracks[0].id);
 const row=page.getByRole('group',{name:'Song 0 by Fixture',exact:true});await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow','43');await expect(row).not.toContainText(/43%|Downloading audio|Preparing audio|Cancel/);await expect(row.getByRole('button',{name:'Add Song 0 to playlist',exact:true})).toBeVisible();await expect(row.locator('.row-download-meter')).toHaveCSS('height','2px');
 await row.getByTitle('More options').click();
 await expect(page.getByRole('dialog',{name:'Options for Song 0'}).getByRole('button',{name:'Cancel download',exact:true})).toBeVisible();
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

test('offline downloaded rows can swipe to queue and save to playlists',async({page,context})=>{
 await page.evaluate(async ids=>{const o='/src/lib/offline/OfflineManager.ts',n='/src/lib/serverConnection.ts';const m=(await import(o)).offlineManager;for(const id of ids)(m as any).downloadsCache.set(id,{trackId:id,status:'completed',progress:100});(m as any).notify();(await import(n)).markNetworkOffline();},tracks.map(t=>t.id));
 await context.setOffline(true);
 const row=page.locator('#library-view .track-row').first();await expect(row).toHaveAttribute('data-offline-unavailable','false');
 await expect(row.getByTitle('Available offline')).toHaveCount(0);
 const b=(await row.locator('.song-row-copy').boundingBox())!;
 await page.mouse.move(b.x+15,b.y+10);await page.mouse.down();await page.mouse.move(b.x+125,b.y+10,{steps:10});await page.mouse.up();
 await expect(row.getByRole('status')).toHaveText('Added to queue');
 await swipe(page,0);await page.getByRole('dialog',{name:'Add to playlist'}).getByRole('button',{name:'My mix',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(async()=>{const d='/src/lib/db.ts';return(await(await import(d)).dbService.getPlaylist('mix')).trackIds.length;})).toBe(1);
 await swipe(page,1);await expect(page.locator('#library-view .track-row').nth(1).getByRole('status')).toHaveText('Added to My mix');
});

test('row buttons remember the destination and show editable playlist membership', async ({ page }) => {
 const dialog = page.getByRole('dialog', { name: 'Add to playlist' });
 const song = (index: number) => page.getByRole('group', { name: `Song ${index} by Fixture`, exact: true });
 const plus = (index: number) => song(index).getByRole('button', { name: `Add Song ${index} to playlist`, exact: true });
 const check = (index: number) => song(index).getByRole('button', { name: `Manage playlists for Song ${index}`, exact: true });
 const mix = dialog.getByRole('button', { name: 'My mix', exact: true });
 const later = dialog.getByRole('button', { name: 'Later', exact: true });
 const stored = (id: string) => page.evaluate(async id => {
  const path = '/src/lib/db.ts';
  return (await (await import(path)).dbService.getPlaylist(id)).trackIds;
 }, id);

 await plus(0).click();
 await expect(mix).toHaveAttribute('aria-pressed', 'false');
 await mix.click();
 await expect(dialog).toHaveCount(0);
 await expect(check(0)).toBeVisible();

 await plus(1).click();
 await expect(song(1).getByRole('status')).toHaveText('Added to My mix');
 await expect(dialog).toHaveCount(0);
 expect(await stored('mix')).toEqual([tracks[0].id, tracks[1].id]);

 await check(0).click();
 await expect(mix).toHaveAttribute('aria-pressed', 'true');
 await later.click();
 await expect(dialog).toHaveCount(0);

 await check(0).click();
 await expect(later).toHaveAttribute('aria-pressed', 'true');
 await mix.click();
 await expect(mix).toHaveAttribute('aria-pressed', 'false');
 await expect(later).toHaveAttribute('aria-pressed', 'true');
 await dialog.getByRole('button', { name: 'Close playlist picker' }).click();
 await expect(check(0)).toBeVisible();

 await plus(2).click();
 await expect(song(2).getByRole('status')).toHaveText('Added to Later');
 await expect(dialog).toHaveCount(0);
 expect(await stored('later')).toEqual([tracks[0].id, tracks[2].id]);

 await check(0).click();
 await later.click();
 await expect(later).toHaveAttribute('aria-pressed', 'false');
 await dialog.getByRole('button', { name: 'Close playlist picker' }).click();
 await expect(plus(0)).toBeVisible();
 expect(await stored('mix')).toEqual([tracks[1].id]);
 expect(await stored('later')).toEqual([tracks[2].id]);

 await page.reload();
 await page.getByRole('button', { name: 'Library', exact: true }).click();
 await page.getByRole('tab', { name: 'Songs', exact: true }).click();
 await expect(check(1)).toBeVisible();
 await plus(0).click();
 await expect(dialog).toBeVisible();
});

test('removing the song from the open playlist leaves the picker available', async ({ page }) => {
 const dialog = page.getByRole('dialog', { name: 'Add to playlist' });
 const mix = dialog.getByRole('button', { name: 'My mix', exact: true });
 await page.getByRole('button', { name: 'Add Song 0 to playlist', exact: true }).click();
 await mix.click();
 await expect(dialog).toHaveCount(0);
 await page.getByRole('tab', { name: 'Playlists', exact: true }).click();
 await page.locator('#library-view').getByText('My mix', { exact: true }).click();

 const row = page.getByRole('group', { name: 'Song 0 by Fixture', exact: true });
 await row.getByRole('button', { name: 'Manage playlists for Song 0', exact: true }).click();
 await mix.click();
 await expect(mix).toHaveAttribute('aria-pressed', 'false');
 await expect(row).toHaveCount(0);
});

test.describe('song picker on iPhone 16 Pro', () => {
 test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, reducedMotion: 'reduce' });
 test('stays in the lower half, scrolls inside, and dismisses on an outside tap', async ({ page }) => {
  await page.evaluate(async () => {
   const path = '/src/lib/db.ts';
   const { dbService } = await import(path);
   for (let i = 0; i < 12; i++) {
    await dbService.savePlaylist({ id: 'extra-' + i, title: 'Extra playlist ' + i, trackIds: [], createdAt: i + 3, updatedAt: i + 3 });
   }
  });
  await page.reload();
  await page.getByRole('button', { name: 'Library', exact: true }).tap();
  await page.getByRole('tab', { name: 'Songs', exact: true }).tap();
  await page.locator('html').evaluate(element => element.style.setProperty('--safe-bottom', '34px'));
  const plus = page.getByRole('button', { name: 'Add Song 0 to playlist', exact: true });
  await plus.tap();
  const picker = page.getByRole('dialog', { name: 'Add to playlist' });
  await expect(picker).toBeVisible();
  const bounds = (await picker.boundingBox())!;
  expect(bounds.y).toBeCloseTo(874 / 2, 0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(874 - 34);
  const options = picker.locator('.playlist-picker-options');
  expect(await options.evaluate(list => list.scrollHeight)).toBeGreaterThan(await options.evaluate(list => list.clientHeight));
  const close = picker.getByRole('button', { name: 'Close playlist picker' });
  const closeY = (await close.boundingBox())!.y;
  await options.evaluate(list => { list.scrollTop = list.scrollHeight; });
  expect((await close.boundingBox())!.y).toBeCloseTo(closeY, 0);

  await page.touchscreen.tap(200, 400);
  await expect(picker).toHaveCount(0);
  await expect(plus).toBeVisible();
  await plus.tap();
  await picker.getByRole('button', { name: 'My mix', exact: true }).tap();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage playlists for Song 0', exact: true })).toBeVisible();
 });
});
