import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, serviceWorkers: 'block' });

const accountFixture = () => ({ profile: { uid: 'import-fixture' }, expiresAt: Date.now() + 86_400_000 });

for (const viewport of [{ width: 390, height: 667 }, { width: 667, height: 320 }]) {
  test(`import remains inside the viewport after scrolling (${viewport.width}x${viewport.height})`, async ({ page, browserName }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path === '/api/account/session' ? accountFixture()
        : { status: 'ok', unchanged: true, configured: true, connected: false, tracks: [], albums: [], artists: [] } });
    });
    await page.goto('/?spotify=connected');
    const dialog = page.getByRole('dialog', { name: 'Import playlist' });
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Close import' }).click();
    await page.getByText('Listening & tools', { exact: true }).click();
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
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    if (browserName === 'chromium') await expect(open).toBeFocused();
  });
}

test('Spotify URL imports title and artist JSON directly',async({page})=>{
 const queries:string[]=[];await page.route('**/api/**',route=>{const url=route.request().url();if(url.endsWith('/api/account/session'))return route.fulfill({json:accountFixture()});if(url.includes('/ytmusic/search')){queries.push(new URL(url).searchParams.get('q')||'');return route.fulfill({json:{songs:[{videoId:'abcdefghijk',title:'Feather',artist:'Nujabes',album:'Modal Soul',durationSeconds:180}]}});}return route.fulfill({json:url.includes('/import/spotify')?{title:'Public fixture',tracks:[{title:'Feather',artist:'Nujabes'}],warning:'Spotify public preview supplied 1 song. This may be only part of the playlist.'}:{status:'ok',unchanged:true,configured:false,connected:false,tracks:[],user:null}});});
 await page.goto('/');
 await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Library' }).tap();
 await expect(page.getByRole('tabpanel', { name: 'Playlists' }).getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
 await page.getByRole('button', { name: 'New playlist', exact: true }).tap();
 const create = page.getByRole('dialog', { name: 'Create New Playlist' });
 const url = create.getByRole('textbox', { name: 'Playlist URL' });
 await expect(url).not.toBeFocused();
 await expect(create.getByPlaceholder('Search songs to add...')).toHaveCount(0);
 await url.fill('https://open.spotify.com/playlist/abc123');await page.getByRole('button',{name:'Fetch',exact:true}).click();await expect(page.locator('#playlist-detail-view h1')).toHaveText('Public fixture');await expect(page.getByRole('note')).toContainText('only part of the playlist');await expect(page.locator('#playlist-detail-view .track-row')).toHaveCount(1);expect(queries).toContain('Feather Nujabes');expect(await page.evaluate(async()=>{const p='/src/lib/db.ts';const jobs=await(await import(p)).dbService.getSetting('playlist_import_jobs',[]);return jobs[0].playlist.tracks;})).toEqual([{title:'Feather',artist:'Nujabes'}]);
});

test('large imports match concurrently and preserve source order past 100 songs',async({page})=>{
 let active=0,max=0;const entries=Array.from({length:103},(_,i)=>({title:'Bulk song '+i,artist:'Bulk artist'}));
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/api/account/session')return route.fulfill({json:accountFixture()});if(url.pathname==='/api/import/spotify')return route.fulfill({json:{title:'Large import',tracks:entries}});if(url.pathname==='/api/ytmusic/search'){const match=url.searchParams.get('q')?.match(/^Bulk song (\d+) Bulk artist$/);if(match){const i=Number(match[1]);active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,10+(5-i%6)*5));active--;return route.fulfill({json:{songs:[{videoId:String(i).padStart(11,'0'),title:'Bulk song '+i,artist:'Bulk artist',album:'Bulk record',durationSeconds:180}]}});}}return route.fulfill({json:{status:'ok',unchanged:true,configured:false,connected:false,songs:[],tracks:[],albums:[],artists:[],user:null}});});
 await page.goto('/?spotify=connected');await page.getByRole('textbox',{name:'Playlist URL'}).fill('https://open.spotify.com/playlist/largefixture');await page.getByRole('button',{name:'Fetch',exact:true}).press('Enter');await expect(page.locator('#playlist-detail-view h1')).toHaveText('Large import');
 await expect.poll(()=>page.evaluate(async()=>{const p='/src/lib/db.ts';return(await(await import(p)).dbService.getSetting('playlist_import_jobs',[]))[0]?.status;}),{timeout:20000}).toBe('done');
 const ids=await page.evaluate(async()=>{const p='/src/lib/db.ts',db=(await import(p)).dbService;const jobs=await db.getSetting('playlist_import_jobs',[]);return(await db.getPlaylist(jobs[0].playlistId))?.trackIds;});expect(ids).toEqual(entries.map((_,i)=>'ytm:'+String(i).padStart(11,'0')));expect(max).toBeGreaterThan(1);expect(max).toBeLessThanOrEqual(6);
});

test('the compact plus menu imports YouTube playlists and can add individual videos to a new playlist', async ({ page }) => {
  const track = { videoId: 'abcdefghijk', title: 'Fixture song', artist: 'Artist', durationSeconds: 180 };
  const calls: string[] = [];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account/session') return route.fulfill({ json: accountFixture() });
    if (path === '/api/import/ytmusic') {
      calls.push(route.request().postDataJSON().id);
      return route.fulfill({ json: { title: 'YouTube fixture', tracks: [track] } });
    }
    if (path.endsWith('/track/' + track.videoId)) {
      calls.push(track.videoId);
      return route.fulfill({ json: track });
    }
    return route.fulfill({ json: { status: 'ok', unchanged: true, tracks: [], songs: [], albums: [], artists: [] } });
  });
  await page.goto('/');
  const library = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Library' });
  await library.tap();
  const add = page.getByRole('button', { name: 'New playlist', exact: true });
  await add.tap();
  const dialog = page.getByRole('dialog', { name: 'Create New Playlist' });
  const box = dialog.getByRole('textbox', { name: 'Playlist URL' });
  await box.fill('https://music.youtube.com/playlist?list=PLfixture123');
  await dialog.getByRole('button', { name: 'Fetch' }).tap();
  await dialog.getByRole('button', { name: 'Import in background' }).tap();
  await expect(page.locator('#playlist-detail-view h1')).toHaveText('YouTube fixture');
  await expect(page.locator('#playlist-detail-view').getByText(track.title, { exact: true })).toBeVisible();

  await expect(dialog).toHaveCount(0);
  await page.locator('#playlist-detail-view').getByRole('button', { name: 'Back', exact: true }).tap();
  await add.tap();
  await box.fill('https://youtu.be/' + track.videoId);
  await dialog.getByRole('button', { name: 'Fetch' }).tap();
  await expect(dialog.getByText('Add Songs (1 selected)')).toBeVisible();
  await dialog.getByLabel('Playlist Name').fill('Individual import');
  await dialog.getByRole('button', { name: 'Create Playlist', exact: true }).tap();
  await expect(page.locator('#playlist-detail-view h1')).toHaveText('Individual import');
  await expect(page.locator('#playlist-detail-view').getByText(track.title, { exact: true })).toBeVisible();
  expect(calls).toEqual(['PLfixture123', track.videoId]);
});
