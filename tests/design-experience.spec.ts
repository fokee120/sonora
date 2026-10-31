import { test, expect, type Page, type Locator } from '@playwright/test';
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
const palette = [['#c58e69','#282d2b','NIGHT','DRIVE'],['#668976','#d9c9a1','SLOW','BLOOM'],['#7b738f','#d6bfac','AFTER','HOURS'],['#a99c72','#3c4e46','SOFT','FOCUS']];
const tracks = Array.from({ length: 24 }, (_, i) => ({ id: 'ytm:' + String(i).padStart(11,'0'), source: 'ytmusic', sourceId: String(i).padStart(11,'0'), cloudKey: 'ytmusic://' + String(i).padStart(11,'0'), title: ['Space Between','A Quiet Kind of Love','Night Windows','Something Like Summer','Golden Hour','Stay a Little Longer'][i % 6] + (i >= 6 ? ' ' + i : ''), artist: ['The Marías','Jordan Rakei','Khruangbin','Cleo Sol'][i % 4], album: ['Night Drive','Slow Bloom','After Hours','Soft Focus'][i % 4], duration: 242, artworkUrl: 'https://covers.test/' + (i % 4) + '.svg' }));
const cover = (i: number) => { const [a,b,c,d] = palette[i]; return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="'+a+'"/><circle cx="650" cy="460" r="290" fill="'+b+'"/><path d="M0 600Q350 180 800 620V800H0Z" fill="'+b+'" opacity=".6"/><text x="60" y="110" fill="#f5ebdb" font-family="sans-serif" font-size="26" letter-spacing="6">SONORA SESSIONS</text><text x="55" y="255" fill="#f5ebdb" font-family="serif" font-size="100">'+c+'</text><text x="55" y="355" fill="#f5ebdb" font-family="serif" font-size="100">'+d+'</text><text x="60" y="742" fill="#f5ebdb" font-family="sans-serif" font-size="20" letter-spacing="3">MUSIC FOR YOUR OWN WORLD</text></svg>'; };
async function setup(page: Page) {
 await page.route('**/api/**', r => r.fulfill({json:{songs:[],tracks:[],albums:[],artists:[],configured:false,connected:false}}));
 await page.route('https://covers.test/**', r => r.fulfill({body:cover(Number(new URL(r.request().url()).pathname.slice(1,2)) || 0),contentType:'image/svg+xml'}));
 await page.route('**/api/ytmusic/artwork?**', r => { const url=new URL(r.request().url()).searchParams.get('url')||''; return r.fulfill({body:cover(Number(url.match(/test\/(\d)/)?.[1]) || 0),contentType:'image/svg+xml'}); });
 await page.goto('/');
 await page.evaluate(async tracks => {
   const d='/src/lib/db.ts', c='/src/lib/offline/AudioCache.ts';
   await (await import(c)).audioCache.setLimit(0);
   const {dbService,getDB}=await import(d);
   await dbService.saveTracks(tracks);
   for(let i=0;i<8;i++) await dbService.savePlaylist({id:'mix-'+i,title:['Night drive','Slow mornings','After hours','Sunday kind of love','A place to land','In the zone','On the way','Keep these close'][i],description:i===0?'For the long way home. A few favorites for when the city gets quiet.':'Your own little world.',trackIds:tracks.slice(i,i+12).map(t=>t.id),createdAt:i,updatedAt:i,pinnedAt:i===0?1:undefined});
   const db=await getDB(); for(let i=0;i<4;i++) await db.put('history',{id:'play-'+i,trackId:tracks[i].id,playedAt:Date.now()-i*1000});
   await dbService.setSetting('player_track',tracks[0]); await dbService.setSetting('player_queue', tracks.slice(0,4).map(track=>({track,queueId:track.id})));
 },tracks);
 await page.reload(); await expect(page.locator('#bottom-player-bar')).toBeVisible();
}
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true});
async function swipe(page:Page, target:Locator, dx:number, dy=0) { const b=(await target.boundingBox())!;const x=b.x+b.width/2,y=b.y+b.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:12});await page.mouse.up(); }
test('pages retain search, selected library tab, and scroll after navigation',async({page})=>{
 await setup(page);
 await nav(page,'Library').click();await page.getByRole('tab',{name:'Songs',exact:true}).click();
 await page.locator('#main-content-scroll').evaluate(e=>e.scrollTop=650);
 const before=await page.locator('#main-content-scroll').evaluate(e=>e.scrollTop);
 await nav(page,'Search').click();await page.getByRole('button',{name:'Saved songs',exact:true}).click();await page.getByLabel('Search songs',{exact:true}).fill('Golden');
 await expect(page.locator('#search-view .track-row').first()).toContainText('Golden Hour');
 await nav(page,'Home').click();await nav(page,'Search').click();await expect(page.getByLabel('Search songs',{exact:true})).toHaveValue('Golden');await expect(page.getByRole('button',{name:'Saved songs',exact:true})).toHaveAttribute('aria-pressed','true');
 await nav(page,'Library').click();await expect(page.getByRole('tab',{name:'Songs',exact:true})).toHaveAttribute('aria-selected','true');expect(await page.locator('#main-content-scroll').evaluate(e=>e.scrollTop)).toBe(before);
});
test('playlist swipe previews and restores the actual scrolled library',async({page})=>{
 await setup(page);await nav(page,'Library').click();await page.locator('#main-content-scroll').evaluate(e=>e.scrollTop=240);
 await page.locator('#library-view').getByRole('button',{name:/After hours/}).click();
 const scroll=await page.locator('#library-view').locator('..').locator('..').evaluate(e=>e.scrollTop);
 await page.mouse.move(10,280);await page.mouse.down();await page.mouse.move(145,280,{steps:10});
 const preview=page.locator('[aria-hidden="true"] #library-view');
 const top=await preview.getByRole('heading',{name:'Library',includeHidden:true} as any).evaluate(e=>e.getBoundingClientRect().top);
 await page.mouse.up();await expect(page.locator('#playlist-detail-view')).toHaveCount(0);
 expect(await page.locator('#main-content-scroll').evaluate(e=>e.scrollTop)).toBe(scroll);
 const landed=await page.locator('#main-content-scroll #library-view h1').evaluate(e=>e.getBoundingClientRect().top);expect(Math.abs(top-landed)).toBeLessThan(2);
});
test('mobile song menu saves an unplayed discovery track to the library',async({page})=>{
 await setup(page);await page.route('**/api/ytmusic/search?**',r=>r.fulfill({json:{songs:[{videoId:'new12345678',title:'Brand New Find',artist:'New Artist',durationSeconds:180}]}}));
 await nav(page,'Search').click();await page.getByLabel('Search songs',{exact:true}).fill('Brand New Find');const row=page.locator('#search-view .track-row').first();await expect(row).toContainText('Brand New Find');await row.getByTitle('More options',{exact:true}).click();
 const menu=page.getByRole('dialog',{name:'Options for Brand New Find'});await menu.getByRole('button',{name:'Save to Liked Songs',exact:true}).click();await expect(menu).toHaveCount(0);
 const saved=await page.evaluate(async()=>{const d='/src/lib/db.ts';const {dbService}=await import(d);return {track:await dbService.getTrack('ytm:new12345678'),favorites:await dbService.getFavorites()};});expect(saved.track?.title).toBe('Brand New Find');expect(saved.favorites).toContain('ytm:new12345678');
});
test('expanded player follows dismissal continuously and springs back on cancellation',async({page})=>{
 await setup(page);await page.getByRole('button',{name:/Open player for/}).click();const sheet=page.getByRole('dialog',{name:'Now playing'});await expect.poll(()=>sheet.evaluate(e=>getComputedStyle(e).transform)).toBe('none');
 const b=(await sheet.locator('.player-artwork').boundingBox())!;const x=b.x+b.width/2,y=b.y+b.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+45,{steps:10});
 await expect.poll(()=>sheet.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m42)).toBeGreaterThan(30);
 await page.mouse.up();await expect.poll(()=>sheet.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m42)).toBeLessThan(1);await expect(sheet).toBeVisible();
});
test('representative screens fit phones and desktop, with reviewed screenshots',async({page})=>{
 await setup(page);
 for(const width of [320,390,430,1440]) {
  await page.setViewportSize({width,height:width===1440?960:844});
  const clickNav=async(name:string)=>{if(width<768)await nav(page,name).click();else await page.getByRole('navigation',{name:'Desktop navigation'}).getByRole('button',{name,exact:true}).click();};
  await clickNav('Home');await page.locator('#main-content-scroll').evaluate(e=>e.scrollTop=0);
  if(width===390||width===1440)await page.waitForTimeout(280); await page.screenshot({path:'.sonora/qa/redesign/home-'+width+'.png'});
  for(const name of ['Search','Library']) {await clickNav(name);await expect.poll(()=>page.locator('#main-content-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);if(width===390||width===1440){await page.waitForTimeout(280);await page.screenshot({path:'.sonora/qa/redesign/'+name.toLowerCase()+'-'+width+'.png'});}}
  await page.locator('#library-view').getByRole('button',{name:/Night drive/}).click();await expect.poll(()=>page.locator('#main-content-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  if(width===390||width===1440){await page.locator('#main-content-scroll').evaluate(e=>e.scrollTop=0);await page.waitForTimeout(280);await page.screenshot({path:'.sonora/qa/redesign/playlist-'+width+'.png'});}
  await page.getByRole('button',{name:'Add songs',exact:true}).first().click();await expect(page.getByRole('dialog',{name:'Add Songs to Playlist'})).toBeVisible();await expect.poll(()=>page.getByRole('dialog').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight)).toBe(true);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/Open player for/}).click();const player=page.getByRole('dialog',{name:'Now playing'});await expect(player).toBeVisible();await expect.poll(()=>player.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);if(width===390){await expect.poll(()=>player.evaluate(e=>getComputedStyle(e).transform)).toBe('none');await page.screenshot({path:'.sonora/qa/redesign/player-390.png'});}await page.keyboard.press('Escape');
 }
});
test('search loading, failure, empty and offline states provide a way forward',async({page,context})=>{
 await setup(page);await nav(page,'Search').click();
 await page.route('**/api/ytmusic/search?**',async r=>{await new Promise(resolve=>setTimeout(resolve,600));await r.fulfill({status:503,json:{error:'Temporarily unavailable'}});});
 await page.getByLabel('Search songs',{exact:true}).fill('unavailable');await expect(page.locator('#search-view').getByRole('status')).toBeVisible();await page.screenshot({path:'.sonora/qa/redesign/loading.png'});await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();await page.screenshot({path:'.sonora/qa/redesign/error.png'});
 await page.getByRole('button',{name:'Clear search',exact:true}).click();await page.route('**/api/ytmusic/search?**',r=>r.fulfill({json:{songs:[]}}));await page.getByLabel('Search songs',{exact:true}).fill('no results');await expect(page.getByRole('heading',{name:'No songs found.'})).toBeVisible();await page.screenshot({path:'.sonora/qa/redesign/empty.png'});
 await context.setOffline(true);await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await expect(page.locator('#offline-indicator-banner')).toBeVisible();await page.getByRole('button',{name:'Clear search',exact:true}).click();await expect(page.getByText('You’re offline. Search your saved songs here.')).toBeVisible();await page.screenshot({path:'.sonora/qa/redesign/offline.png'});
});
test('reduced motion keeps gestures and dialogs usable',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await setup(page);await swipe(page,page.locator('#home-view h1'),-130);await expect(page.locator('#search-view')).toBeVisible();await nav(page,'Library').click();await page.getByRole('button',{name:'New playlist',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create New Playlist'});await expect(dialog).toBeVisible();await expect(page.getByLabel('Playlist Name')).not.toBeFocused();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(nav(page,'Library')).toBeEnabled();
});

test('creating a playlist from the song picker includes the selected song',async({page})=>{
 await setup(page);const row=page.locator('#home-view').getByTestId('recently-played').locator('.track-row').first();await row.getByTitle('More options',{exact:true}).click();
 await page.getByRole('dialog',{name:/Options for/}).getByRole('button',{name:'Add to Playlist',exact:true}).click();
 await page.getByRole('dialog',{name:'Add to playlist',exact:true}).getByRole('button',{name:'New playlist',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Create New Playlist'});await expect(dialog).toContainText('Add Songs (1 selected)');
 await dialog.getByLabel('Playlist Name').fill('A new beginning');await dialog.getByRole('button',{name:/Create Playlist/}).click();
 await expect(page.getByRole('heading',{name:'A new beginning',exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{const p='/src/lib/db.ts';return (await(await import(p)).dbService.getAllPlaylists()).find((p:any)=>p.title==='A new beginning');});expect(result.trackIds).toContain(tracks[0].id);
});
