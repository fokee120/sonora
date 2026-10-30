import {test,expect,type Page} from '@playwright/test';
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const tracks=Array.from({length:15},(_,i)=>({id:'ytm:theme'+String(i).padStart(6,'0'),source:'ytmusic',sourceId:'theme'+String(i).padStart(6,'0'),cloudKey:'ytmusic://theme'+String(i).padStart(6,'0'),title:['Daylight','The long way home','A little room for more','Somewhere, softly','Golden hour'][i%5],artist:['RINI','Men I Trust','Khruangbin'][i%3],album:'Songs for the margins',duration:180}));
async function setup(page:Page){
 await page.route('**/api/**',r=>r.fulfill({json:{tracks:[],songs:[],artists:[],albums:[],configured:false,connected:false}}));await page.goto('/');
 await page.evaluate(async tracks=>{const d='/src/lib/db.ts',c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);const {dbService,getDB}=await import(d);const db=await getDB();
  for(let i=0;i<tracks.length;i++){const canvas=document.createElement('canvas');canvas.width=canvas.height=320;const ctx=canvas.getContext('2d')!;ctx.fillStyle=['#ab614c','#526a5d','#445a78','#b49b71','#50465e'][i%5];ctx.fillRect(0,0,320,320);ctx.fillStyle='#e6dcc8';ctx.beginPath();ctx.arc(160,155,80,0,Math.PI*2);ctx.fill();ctx.fillStyle=['#6b493a','#233d31','#242c45'][i%3];ctx.fillRect(0,215,320,105);ctx.font='22px Georgia';ctx.fillStyle='#f4efdf';ctx.fillText('SONGS / '+String(i+1).padStart(2,'0'),25,284);(tracks[i] as any).artworkUrl=canvas.toDataURL('image/jpeg');}
  await dbService.saveTracks(tracks);for(let i=0;i<4;i++){await dbService.addHistory(tracks[i].id);await dbService.savePlaylist({id:'theme-mix-'+i,title:['Paper planes','A softer side','After hours','On the way'][i],description:'A few favorites for the long way home.',trackIds:tracks.slice(i,i+4).map(t=>t.id),createdAt:Date.now(),updatedAt:Date.now()});}
  await dbService.setSetting('player_track',tracks[0]);await dbService.setSetting('player_queue',tracks.slice(0,3).map((track,i)=>({track,queueId:'theme-q-'+i,contextIndex:i})));await db.put('settings',{key:'player_queue_cursor',value:'theme-q-0'});
 },tracks);await page.reload();await expect(page.locator('#bottom-player-bar')).toBeVisible();
}
async function setTheme(page:Page,id:string){await page.evaluate(async id=>{const p='/src/lib/appearance.ts';(await import(p)).chooseTheme(id);await document.fonts.ready;},id);}
for(const theme of ['notebook','retro','gotham']){
 test(theme+' changes surfaces, rows, controls and persists its custom colors',async({page})=>{
  await setup(page);await setTheme(page,theme);await expect(page.locator('html')).toHaveAttribute('data-style',theme);
  const style=await page.evaluate(()=>({background:getComputedStyle(document.querySelector('.page-pane[aria-hidden="false"]')??document.querySelector('.page-pane')!).backgroundImage,font:getComputedStyle(document.body).fontFamily,button:getComputedStyle(document.querySelector('.primary-button')!).borderRadius}));if(theme==='gotham')await expect(page.locator('.stationary-city')).toBeVisible();else expect(style.background).not.toBe('none');expect(style.font).toContain(theme==='notebook'?'Sonora Hand':theme==='retro'?'Sonora Pixel':'Inter');expect(style.button).not.toBe('100px');
  if(theme==='gotham')await expect(page.locator('.primary-button').first()).toHaveCSS('background-color','rgb(215, 180, 119)');
  await page.screenshot({path:'.sonora/qa/phase3/'+theme+'-home-'+test.info().project.name+'.png'});
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('tab',{name:'Songs',exact:true}).click();await expect(page.locator('#library-view .track-row-slot')).toHaveCount(15);
  await page.screenshot({path:'.sonora/qa/phase3/'+theme+'-library-'+test.info().project.name+'.png'});
  await page.evaluate(async()=>{const p='/src/lib/appearance.ts';(await import(p)).updateAppearance({accent:'#b65f55',preset:'custom'});});await page.reload();await expect(page.locator('html')).toHaveAttribute('data-style',theme);await expect(page.locator('html')).toHaveAttribute('data-theme','custom');
  await page.locator('#bottom-player-bar .mini-track').click();await expect(page.getByRole('dialog',{name:'Now playing'})).toBeVisible();await expect.poll(()=>page.locator('#expanded-player-modal').evaluate(e=>Math.round(e.getBoundingClientRect().top))).toBe(0);await page.screenshot({path:'.sonora/qa/phase3/'+theme+'-player-'+test.info().project.name+'.png'});
  if(theme==='retro')expect(await page.locator('#expanded-player-modal .pixel-icon').count()).toBeGreaterThan(3);
  expect(await page.locator('.player-cover-image').evaluate(e=>getComputedStyle(e).imageRendering)).toBe('auto');
  for(const viewport of [{width:320,height:568},{width:667,height:320}]){await page.setViewportSize(viewport);const dialog=page.getByRole('dialog',{name:'Now playing'});expect(await dialog.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);await dialog.getByRole('button',{name:'Play',exact:true}).scrollIntoViewIfNeeded();await expect(dialog.getByRole('button',{name:'Play',exact:true})).toBeVisible();}
 });
 test(theme+' fits narrow phones, settings, queue and desktop',async({page})=>{
  await setup(page);await setTheme(page,theme);await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('button',{name:theme==='notebook'?'Notebook theme':theme==='retro'?'Retro theme':'Gotham Nights theme'})).toHaveAttribute('aria-pressed','true');
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});expect(await page.locator('#settings-view').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);expect(await page.locator('body').evaluate(e=>e.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
  await page.screenshot({path:'.sonora/qa/phase3/'+theme+'-settings-desktop-'+test.info().project.name+'.png'});
  await page.locator('#bottom-player-bar').getByTitle('Queue',{exact:true}).click();await expect(page.getByRole('dialog',{name:'Play Queue'})).toBeVisible();await page.screenshot({path:'.sonora/qa/phase3/'+theme+'-queue-'+test.info().project.name+'.png'});
  expect(await page.getByRole('dialog',{name:'Play Queue'}).evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
 });
}
