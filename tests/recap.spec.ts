import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const tracks=[['Zulu','Beta','Alpha'],['Alpha','Zulu','Gamma'],['Gamma','Alpha','Beta'],['New song','Beta','Delta']].map(([title,artist,album],i)=>({id:'ytm:recaptrack'+i,title,artist,album,genre:i===2?'Soul':'Jazz',source:'ytmusic',sourceId:'recaptrack'+i,cloudKey:'ytmusic://recaptrack'+i,duration:180}));
async function seed(page:any){
 await page.route('**/api/**',(r:any)=>r.fulfill({json:{songs:[],tracks:[],artists:[],albums:[]}}));await page.goto('/');
 await page.evaluate(async tracks=>{const d='/src/lib/db.ts',c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);const {dbService,getDB}=await import(d);await dbService.saveTracks(tracks);await dbService.savePlaylist({id:'recap-mix',title:'Recap mix',trackIds:tracks.slice(0,3).map(t=>t.id),createdAt:1,updatedAt:1});const db=await getDB();const now=Date.now();for(let i=0;i<6;i++)await db.put('history',{id:'today-'+i,trackId:tracks[i<3?0:i<5?1:2].id,playedAt:now-i*1000});for(let i=0;i<305;i++)await db.put('history',{id:'old-'+i,trackId:tracks[2].id,playedAt:now-15*86400000-i*1000});await dbService.setSetting('player_track',tracks[0]);await dbService.setSetting('player_queue',tracks.map((track,i)=>({track,queueId:'recap-q-'+i})));await dbService.setSetting('player_queue_cursor','recap-q-0');},tracks);
 await page.reload();await expect(page.locator('#bottom-player-bar')).toBeVisible();
}
test('recap counts repeats, browses periods, keeps full history and fits phone/desktop',async({page})=>{
 await seed(page);const nav=page.getByRole('navigation',{name:'Main navigation'});await expect(nav.getByRole('button')).toHaveText(['Home','Search','Recap','Library']);await nav.getByRole('button',{name:'Recap'}).click();
 await expect(page.locator('.recap-edition-daily .recap-edition-totals')).toContainText('6');
 const songs=page.locator('.recap-ranking').nth(0);await expect(songs.locator('.recap-ranked-name strong')).toHaveText(['Zulu','Alpha','Gamma']);await expect(songs.locator('.recap-count strong')).toHaveText(['3','2','1']);
 const artists=page.locator('.recap-ranking').nth(1);await expect(artists.locator('.recap-ranked-name strong')).toHaveText(['Beta','Zulu','Alpha']);await expect(artists.locator('.recap-count strong')).toHaveText(['3','2','1']);
 await expect(page.locator('.recap-ranking').nth(2).locator('.recap-count strong')).toHaveText(['5','1']);
 await expect(page.locator('.recap-day h3').first()).toContainText(new Date().toLocaleDateString('en-US',{weekday:'long'}));
 await page.getByRole('button',{name:'Previous week'}).click();await expect(page.locator('.recap-edition-weekly .recap-edition-date strong')).toHaveText(/\d{2}\/\d{2}\/\d{4} – \d{2}\/\d{2}\/\d{4}/);await page.getByRole('button',{name:'Next week'}).click();await expect(page.getByRole('button',{name:'Next week'})).toBeDisabled();
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'Show more history'}).click();await expect(page.locator('.recap-history-row')).toHaveCount(311);await expect(page.getByRole('button',{name:'Show more history'})).toHaveCount(0);await expect(page.locator('.recap-day h3').last()).toContainText(/\d{2}\/\d{2}\/\d{4}/);
 for(const theme of ['classic','notebook','retro','gotham']){await page.evaluate(async id=>{const p='/src/lib/appearance.ts';(await import(p)).chooseTheme(id);},theme);for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});const overflow=await page.locator('#recap-view').evaluate(e=>e.scrollWidth-e.clientWidth);if(overflow>1)console.log(theme,width,await page.locator('#recap-view').evaluate(e=>[...e.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>e.getBoundingClientRect().right+1).map(n=>({class:n.className,width:n.getBoundingClientRect().width,text:n.textContent?.slice(0,60)}))));expect(overflow).toBeLessThanOrEqual(1);expect(await page.locator('body').evaluate(e=>e.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}}
 await page.setViewportSize({width:390,height:844});await page.locator('#main-content-scroll').evaluate(e=>e.scrollTop=0);await page.screenshot({path:'.sonora/qa/recap-gotham.png'});
});
test('playlist sorting preserves saved order and recommendations hide saved songs',async({page})=>{
 await seed(page);await expect(page.locator('#home-view [data-track-id="ytm:recaptrack3"]')).toHaveCount(1);
 // The song in the playlist is unplayed, making it otherwise eligible for recommendations.
 await page.evaluate(async()=>{const p='/src/lib/db.ts';const db=await(await import(p)).getDB();await db.clear('history');window.dispatchEvent(new Event('sonora:history-changed'));});
 const recs=page.locator('#home-view section').filter({has:page.getByRole('heading',{name:'Recommended for you',exact:true})});await expect(recs.getByText('Zulu',{exact:true})).toHaveCount(0);await expect(recs.getByText('Alpha',{exact:true})).toHaveCount(0);
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('tab',{name:'Playlists',exact:true}).click();await page.locator('#library-view').getByText('Recap mix',{exact:true}).click();
 const titles=page.locator('#playlist-detail-view .track-row .song-row-copy>div>p');
 await expect(titles).toHaveText(['Gamma','Alpha','Zulu']);
 for(const [sort,order] of [['artist',['Gamma','Zulu','Alpha']],['album',['Zulu','Gamma','Alpha']],['title',['Alpha','Gamma','Zulu']],['date-old',['Zulu','Alpha','Gamma']]] as const){await page.getByLabel('Sort playlist',{exact:true}).selectOption(sort);await expect(titles).toHaveText([...order]);}
 expect(await page.evaluate(async()=>{const p='/src/lib/db.ts';return(await(await import(p)).dbService.getPlaylist('recap-mix')).trackIds;})).toEqual(tracks.slice(0,3).map(t=>t.id));
});
test('player tilt stays stable during updates and changes with tracks in both themes',async({page})=>{
 await seed(page);await page.locator('#bottom-player-bar .mini-track').click();
 for(const theme of ['notebook','gotham']){
  await page.evaluate(async id=>{const p='/src/lib/appearance.ts';(await import(p)).chooseTheme(id);},theme);
  const art=page.locator('.player-artwork');const before=await art.evaluate(e=>(e as HTMLElement).style.getPropertyValue('--artwork-tilt'));await page.locator('#expanded-player-modal').getByTitle('Shuffle: Off').click();await expect(art).toHaveCSS('--artwork-tilt',before);
  await page.evaluate(async track=>{const p='/src/lib/audio/PlayerEngine.ts';const engine=(await import(p)).playerEngine;engine.state={...engine.getState(),currentTrack:track};engine.notifyState();},tracks[theme==='notebook'?1:2]);
  await expect.poll(()=>art.evaluate(e=>(e as HTMLElement).style.getPropertyValue('--artwork-tilt'))).not.toBe(before);const angle=parseFloat(await art.evaluate(e=>(e as HTMLElement).style.getPropertyValue('--artwork-tilt')));expect(Math.abs(angle)).toBeGreaterThanOrEqual(1);expect(Math.abs(angle)).toBeLessThanOrEqual(4);
  await page.locator('#expanded-player-modal').getByTitle('Shuffle: On').click();
 }
});
test('recap handles empty, missing genre, offline history and recoverable errors',async({page,context})=>{
 await seed(page);await page.evaluate(async()=>{const p='/src/lib/db.ts';const db=await(await import(p)).getDB();await db.clear('history');window.dispatchEvent(new Event('sonora:history-changed'));});await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Recap'}).click();await expect(page.getByText('Your story starts with a song.',{exact:true})).toBeVisible();
 await page.evaluate(async()=>{const p='/src/lib/db.ts';const db=(await import(p)).dbService;await db.addHistory('removed-song',{id:'removed-song',title:'Still remembered',artist:'Past artist',album:'Old record',cloudKey:'',duration:100});});await expect(page.locator('.recap-history-row')).toContainText('Still remembered');await expect(page.locator('.recap-ranking').nth(2)).toContainText('Genre information isn’t available');
 await context.setOffline(true);await expect(page.locator('.recap-history-row')).toContainText('Past artist');await context.setOffline(false);
 await page.evaluate(async()=>{const p='/src/lib/db.ts';const db=(await import(p)).dbService;const original=db.getPlayHistory;db.getPlayHistory=async()=>{db.getPlayHistory=original;throw new Error('fixture');};window.dispatchEvent(new Event('sonora:history-changed'));});await expect(page.getByRole('alert')).toContainText('couldn’t load');await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.locator('.recap-history-row')).toContainText('Still remembered');
});
test('swipes move continuously through Search, Recap and Library',async({page})=>{
 await seed(page);await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Search',exact:true}).click();
 async function swipe(selector:string,dx:number){const box=(await page.locator(selector).boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2,{steps:12});await page.mouse.up();}
 await swipe('#search-view h1',-130);await expect(page.locator('#recap-view')).toBeVisible();await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Recap'})).toHaveAttribute('aria-current','page');
 await swipe('#recap-view h1',-130);await expect(page.locator('#library-view')).toBeVisible();await swipe('#library-view h1',130);await expect(page.locator('#recap-view')).toBeVisible();
});
