import { test, expect, type Page } from '@playwright/test';
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const track={id:'ytm:abcdefghijk',source:'ytmusic',sourceId:'abcdefghijk',cloudKey:'ytmusic://abcdefghijk',title:'Aphrodite',artist:'RINI',artistId:'UCfixture',album:'Constellations',albumId:'MPREfixture',duration:240};
const songs=[{videoId:'abcdefghijk',title:'Aphrodite',artist:'RINI',artistId:'UCfixture',album:'Constellations',albumId:'MPREfixture',durationSeconds:240},{videoId:'lmnopqrstuv',title:'Miracle',artist:'RINI',artistId:'UCfixture',album:'Constellations',albumId:'MPREfixture',durationSeconds:205}];
async function setup(page:Page){
 await page.route('**/api/**',r=>r.fulfill({json:{tracks:[],artists:[],albums:[],songs:[],configured:false,connected:false}}));
 await page.route('**/api/ytmusic/search?**',r=>{const filter=new URL(r.request().url()).searchParams.get('filter');return r.fulfill({json:filter==='artists'?{artists:[{browseId:'UCfixture',name:'RINI'}],songs:[]}:filter==='albums'?{albums:[{browseId:'MPREfixture',title:'Constellations',artist:'RINI',artistId:'UCfixture',year:2021}],songs:[]}:{songs}});});
 await page.route('**/api/ytmusic/browse/UCfixture',r=>r.fulfill({json:{browseId:'UCfixture',kind:'artist',title:'RINI',artist:'RINI',artistId:'UCfixture',songs,albums:[{browseId:'MPREfixture',title:'Constellations',artist:'RINI',artistId:'UCfixture',year:2021}]}}));
 await page.route('**/api/ytmusic/browse/MPREfixture',r=>r.fulfill({json:{browseId:'MPREfixture',kind:'album',title:'Constellations',artist:'RINI',artistId:'UCfixture',year:2021,songs,albums:[]}}));
 await page.goto('/');
 await page.evaluate(async track=>{const d='/src/lib/db.ts',c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);const {dbService}=await import(d);await dbService.saveTracks([track]);await dbService.addHistory(track.id);},track);
 await page.reload();await expect(page.getByTestId('recently-played').locator('.track-row')).toBeVisible();
}
async function settings(page:Page){await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{name:'Appearance',exact:true})).toBeVisible();}
test('theme presets, custom colors and local photo settings persist through reload',async({page})=>{
 await setup(page);await settings(page);await page.getByRole('button',{name:'Velvet colors'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','violet');
 await page.getByLabel('Accent color',{exact:true}).fill('#f5aa55');await page.getByLabel('Background color',{exact:true}).fill('#191022');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=96;c.height=96;const ctx=c.getContext('2d')!;ctx.fillStyle='#3355aa';ctx.fillRect(0,0,96,96);return c.toDataURL('image/png').split(',')[1];});
 await page.getByLabel('Background photo',{exact:true}).setInputFiles({name:'my-photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect(page.getByRole('button',{name:'Remove photo',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-photo','true');
 await page.getByLabel('Photo dimming',{exact:true}).fill('82');await page.getByLabel('Photo blur',{exact:true}).fill('8');
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','custom');await expect(page.locator('html')).toHaveAttribute('data-photo','true');
 expect(await page.locator('html').evaluate(e=>getComputedStyle(e).getPropertyValue('--accent').trim())).toBe('#f5aa55');
 await settings(page);await expect(page.getByLabel('Background color',{exact:true})).toHaveValue('#191022');await expect(page.getByLabel('Photo dimming',{exact:true})).toHaveValue('82');await expect(page.getByLabel('Photo blur',{exact:true})).toHaveValue('8');
 await page.screenshot({path:'.sonora/qa/phase2/appearance-'+test.info().project.name+'.png'});
 await page.getByRole('button',{name:'Remove photo',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-photo','false');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-photo','false');
});
test('Settings edge swipe tracks the pointer and returns to its Home preview',async({page})=>{
 await setup(page);await settings(page);
 await page.mouse.move(10,300);await page.mouse.down();await page.mouse.move(145,300,{steps:10});
 await expect.poll(()=>page.locator('#main-content-scroll').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41)).toBeGreaterThan(100);
 const top=await page.locator('[aria-hidden="true"] #home-view h1').evaluate(e=>e.getBoundingClientRect().top);
 await page.mouse.up();await expect(page.locator('#settings-view')).toHaveCount(0);expect(Math.abs(await page.locator('#home-view h1').evaluate(e=>e.getBoundingClientRect().top)-top)).toBeLessThan(2);
 await settings(page);await page.getByText('made by enzo',{exact:true}).scrollIntoViewIfNeeded();await expect(page.getByText('made by enzo',{exact:true})).toBeVisible();
});
test('the queued notice has square row corners',async({page})=>{
 await setup(page);const row=page.getByTestId('recently-played').locator('.track-row'),b=(await row.getByText('Aphrodite',{exact:true}).boundingBox())!;const x=b.x+10,y=b.y+b.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+115,y+20,{steps:10});await page.mouse.up();await expect(row.getByRole('status')).toHaveText('Added to queue');await expect(row.locator('.song-notice')).toHaveCSS('border-radius','0px');
});
test('artist discovery opens releases and complete album songs, retaining the search on Back',async({page})=>{
 await setup(page);await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Search',exact:true}).click();
 await page.getByLabel('Search songs',{exact:true}).fill('RINI');await page.getByRole('button',{name:'Artists',exact:true}).click();await page.getByRole('button',{name:'RINI Artist',exact:true}).click();await expect(page.locator('#artist-detail-view').getByRole('heading',{name:'RINI',exact:true})).toBeVisible();
 await page.screenshot({path:'.sonora/qa/phase2/artist-'+test.info().project.name+'.png'});
 await page.locator('#artist-detail-view .catalog-card').click();await expect(page.locator('#album-detail-view').getByRole('heading',{name:'Constellations',exact:true})).toBeVisible();await expect(page.locator('#album-detail-view .track-row')).toHaveCount(2);
 await expect(page.locator('#album-detail-view')).toContainText('RINI');await expect(page.getByRole('button',{name:'Download album',exact:true})).toBeEnabled();await page.screenshot({path:'.sonora/qa/phase2/album-'+test.info().project.name+'.png'});
 await page.getByRole('button',{name:'Back to artist',exact:true}).click();await expect(page.locator('#artist-detail-view')).toBeVisible();await page.getByRole('button',{name:'Back to Search',exact:true}).click();await expect(page.getByLabel('Search songs',{exact:true})).toHaveValue('RINI');await expect(page.getByRole('button',{name:'Artists',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('song menus and song artist names open real profiles',async({page})=>{
 await setup(page);const row=page.getByTestId('recently-played').locator('.track-row');await row.getByRole('button',{name:'RINI',exact:true}).click();await expect(page.locator('#artist-detail-view')).toBeVisible();
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Home',exact:true}).click();await row.getByTitle('More options').click();await page.getByRole('button',{name:'Go to album',exact:true}).click();await expect(page.locator('#album-detail-view').getByRole('heading',{name:'Constellations',exact:true})).toBeVisible();
});
test('appearance and catalog controls fit a narrow phone and desktop',async({page})=>{
 await setup(page);await settings(page);
 for(const width of [320,430,1440]){await page.setViewportSize({width,height:844});await expect.poll(()=>page.locator('#settings-view').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);}
});
