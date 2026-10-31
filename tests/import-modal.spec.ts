import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 390, height: 667 }, { width: 667, height: 320 }]) {
  test(`import remains inside the viewport after scrolling (${viewport.width}x${viewport.height})`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/**', route => route.fulfill({ json: {
      configured: true, connected: false, user: null, tracks: [], albums: [], artists: [],
    } }));
    await page.goto('/?spotify=connected');
    const dialog = page.getByRole('dialog', { name: 'Import playlist' });
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Close import' }).click();
    const open = page.getByRole('button', { name: 'Import a playlist', exact: true });
    await open.scrollIntoViewIfNeeded();
    await open.click();
    await expect(dialog).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Playlist URL' })).not.toBeFocused();
    await page.getByRole('textbox', { name: 'Playlist URL' }).click();
    await expect(page.getByRole('textbox', { name: 'Playlist URL' })).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(await dialog.evaluate(element => element.parentElement?.parentElement === document.body)).toBe(true);
    await expect(page.getByRole('link', { name: 'Connect Spotify', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Playlist URL' }).click();
    await page.getByRole('textbox', { name: 'Playlist URL' }).click();
  await page.getByRole('textbox', { name: 'Playlist URL' }).fill('https://open.spotify.com/playlist/abc123');
    await page.getByRole('textbox', { name: 'Playlist URL' }).press('Shift+Tab');
    if (browserName === 'chromium') await expect(page.getByRole('link', { name: 'Connect Spotify', exact: true })).toBeFocused();
    else expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    if (browserName === 'chromium') await expect(open).toBeFocused();
  });
}

test('Spotify URL imports title and artist JSON directly',async({page})=>{
 const queries:string[]=[];await page.route('**/api/**',route=>{const url=route.request().url();if(url.includes('/ytmusic/search')){queries.push(new URL(url).searchParams.get('q')||'');return route.fulfill({json:{songs:[{videoId:'abcdefghijk',title:'Feather',artist:'Nujabes',album:'Modal Soul',durationSeconds:180}]}});}return route.fulfill({json:url.includes('/import/spotify')?{title:'Public fixture',tracks:[{title:'Feather',artist:'Nujabes'}],warning:'Spotify public preview supplied 1 song. This may be only part of the playlist.'}:{configured:false,connected:false,tracks:[],user:null}});});
 await page.goto('/?spotify=connected');await page.getByRole('textbox',{name:'Playlist URL'}).fill('https://open.spotify.com/playlist/abc123');await page.getByRole('button',{name:'Fetch',exact:true}).click();await expect(page.locator('#playlist-detail-view h1')).toHaveText('Public fixture');await expect(page.getByRole('note')).toContainText('only part of the playlist');await expect(page.locator('#playlist-detail-view .track-row')).toHaveCount(1);expect(queries).toContain('Feather Nujabes');expect(await page.evaluate(async()=>{const p='/src/lib/db.ts';const jobs=await(await import(p)).dbService.getSetting('playlist_import_jobs',[]);return jobs[0].playlist.tracks;})).toEqual([{title:'Feather',artist:'Nujabes'}]);
});

test('large imports match concurrently and preserve source order past 100 songs',async({page})=>{
 let active=0,max=0;const entries=Array.from({length:103},(_,i)=>({title:'Bulk song '+i,artist:'Bulk artist'}));
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/api/import/spotify')return route.fulfill({json:{title:'Large import',tracks:entries}});if(url.pathname==='/api/ytmusic/search'){const match=url.searchParams.get('q')?.match(/^Bulk song (\d+) Bulk artist$/);if(match){const i=Number(match[1]);active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,10+(5-i%6)*5));active--;return route.fulfill({json:{songs:[{videoId:String(i).padStart(11,'0'),title:'Bulk song '+i,artist:'Bulk artist',album:'Bulk record',durationSeconds:180}]}});}}return route.fulfill({json:{configured:false,connected:false,songs:[],tracks:[],albums:[],artists:[],user:null}});});
 await page.goto('/?spotify=connected');await page.getByRole('textbox',{name:'Playlist URL'}).fill('https://open.spotify.com/playlist/largefixture');await page.getByRole('button',{name:'Fetch',exact:true}).press('Enter');await expect(page.locator('#playlist-detail-view h1')).toHaveText('Large import');
 await expect.poll(()=>page.evaluate(async()=>{const p='/src/lib/db.ts';return(await(await import(p)).dbService.getSetting('playlist_import_jobs',[]))[0]?.status;}),{timeout:20000}).toBe('done');
 const ids=await page.evaluate(async()=>{const p='/src/lib/db.ts',db=(await import(p)).dbService;const jobs=await db.getSetting('playlist_import_jobs',[]);return(await db.getPlaylist(jobs[0].playlistId))?.trackIds;});expect(ids).toEqual(entries.map((_,i)=>'ytm:'+String(i).padStart(11,'0')));expect(max).toBeGreaterThan(1);expect(max).toBeLessThanOrEqual(6);
});
