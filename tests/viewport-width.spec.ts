import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block',viewport:{width:402,height:874},hasTouch:true});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account/session') {
      return route.fulfill({ json: { profile: { uid: 'viewport-fixture' }, expiresAt: Date.now() + 86_400_000 } });
    }
    if (path === '/api/account/library') return route.fulfill({ json: { unchanged: true } });
    return route.fulfill({ json: { status: 'ok', songs: [], tracks: [], artists: [], albums: [] } });
  });
});
test('phone pages cannot pan sideways across themes, focus, and responsive widths',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('sonora:recent-searches',JSON.stringify(['The adults are talking','A very long search title '.repeat(8)]));});await page.goto('/');await page.locator('#mobile-bottom-nav').getByRole('button',{name:'Search',exact:true}).click();
 for(const theme of ['classic','gotham','retro','notebook','pink','aero','comics']){
  await page.evaluate(async theme=>{const p='/src/lib/appearance.ts';(await import(p)).chooseTheme(theme);await document.fonts.ready;},theme);
  for(const width of [320,360,375,390,402,430,440]){await page.setViewportSize({width,height:874});await expect.poll(()=>page.locator('#main-content-scroll').evaluate(e=>e.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
   const metrics=await page.evaluate(()=>{const stage=document.querySelector<HTMLElement>('.page-stage')!,pane=document.querySelector<HTMLElement>('#main-content-scroll')!,view=document.querySelector<HTMLElement>('#search-view')!;stage.scrollLeft=120;pane.scrollLeft=120;return{stage:stage.scrollLeft,pane:pane.scrollLeft,overflow:view.scrollWidth-view.clientWidth,root:document.documentElement.scrollWidth-innerWidth};});expect(metrics,theme+' '+width).toEqual({stage:0,pane:0,overflow:0,root:0});
   const search = page.getByRole('searchbox');
   await search.tap();
   await expect(search).toBeFocused();
   expect(await search.evaluate(input => parseFloat(getComputedStyle(input).fontSize)), theme + ' ' + width).toBeGreaterThanOrEqual(18);
   await page.getByRole('searchbox').fill('A search with a very long song name '.repeat(4));await page.getByRole('searchbox').fill('');await page.getByRole('searchbox').blur();expect(await page.locator('.page-stage').evaluate(e=>e.scrollLeft)).toBe(0);
  }
 }
 await page.setViewportSize({width:402,height:874});await page.evaluate(async()=>{const p='/src/lib/appearance.ts';(await import(p)).chooseTheme('gotham');});await page.screenshot({path:'.sonora/qa/iphone-16-pro-search-fixed.png'});
});
test('resizing during a page swipe leaves the page centered and swipe navigation working',async({page})=>{await page.goto('/');await page.locator('#mobile-bottom-nav').getByRole('button',{name:'Search',exact:true}).click();await expect.poll(()=>page.locator('#main-content-scroll').evaluate(e=>e.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);const title=await page.locator('#search-view h1').boundingBox();await page.mouse.move(title!.x+40,title!.y+10);await page.mouse.down();await page.mouse.move(title!.x-20,title!.y+10,{steps:5});await page.setViewportSize({width:440,height:956});await page.mouse.up();await expect.poll(()=>page.locator('#main-content-scroll').evaluate(e=>getComputedStyle(e).transform)).toBe('none');expect(await page.locator('.page-stage').evaluate(e=>e.scrollLeft)).toBe(0);await page.locator('#mobile-bottom-nav').getByRole('button',{name:'Recap',exact:true}).click();await expect(page.locator('#recap-view')).toBeVisible();});

test('keyboard viewport changes repair horizontal focus panning without changing layout width or pinch zoom',async({page})=>{
 await page.addInitScript(()=>{const vv=new EventTarget() as any;Object.assign(vv,{height:874,width:402,scale:1,offsetLeft:0,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:vv});(window as any).__keyboardViewport=vv;});await page.goto('/');await page.locator('#mobile-bottom-nav').getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('searchbox').tap();await expect(page.getByRole('searchbox')).toBeFocused();await expect.poll(()=>page.locator('#main-content-scroll').evaluate(e=>getComputedStyle(e).transform)).toBe('none');
 await page.evaluate(()=>{const vv=(window as any).__keyboardViewport;vv.height=500;Object.defineProperty(window,'innerHeight',{configurable:true,value:500});let pan=60;const stage=document.querySelector('.page-stage')!;Object.defineProperty(stage,'scrollLeft',{configurable:true,get:()=>pan,set:value=>{pan=value;}});vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'));});
 await expect(page.locator('html')).toHaveClass(/keyboard-open/);await expect.poll(()=>page.locator('.page-stage').evaluate(e=>e.scrollLeft)).toBe(0);expect(await page.locator('html').evaluate(e=>(e as HTMLElement).style.getPropertyValue('--app-height'))).toBe('874px');expect(await page.locator('#search-view').evaluate(e=>e.scrollWidth-e.clientWidth)).toBe(0);
 await page.evaluate(()=>{const vv=(window as any).__keyboardViewport;vv.scale=2;document.querySelector('.page-stage')!.scrollLeft=60;vv.dispatchEvent(new Event('scroll'));});await expect.poll(()=>page.locator('.page-stage').evaluate(e=>e.scrollLeft)).toBe(60);
 await page.getByRole('searchbox').blur();await page.evaluate(()=>{const vv=(window as any).__keyboardViewport;Object.assign(vv,{height:874,scale:1});Object.defineProperty(window,'innerHeight',{configurable:true,value:874});vv.dispatchEvent(new Event('resize'));});await expect(page.locator('html')).not.toHaveClass(/keyboard-open/);
});

test('standalone phone keeps page headings and top actions below the status bar fade', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/');
  const root = page.locator('html');
  await expect(root).toHaveClass(/standalone-app/);
  await root.evaluate(element => element.style.setProperty('--safe-top', '62px'));

  const pane = page.locator('#main-content-scroll');
  const statusBarClearance = 86;
  await expect.poll(async () => (await pane.boundingBox())?.y).toBe(statusBarClearance);
  const heading = page.getByText('SONORA / FOR YOU', { exact: true });
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const profile = page.getByRole('button', { name: 'Your profile', exact: true });
  for (const item of [heading, settings, profile]) {
    await expect(item).toBeVisible();
    expect((await item.boundingBox())!.y).toBeGreaterThan(statusBarClearance);
  }
  await pane.evaluate(element => { element.scrollTop = 40; });
  expect(await page.evaluate(() => !!document.elementFromPoint(40, 80)?.closest('.page-pane'))).toBe(false);
  await pane.evaluate(element => { element.scrollTop = 0; });
  await settings.tap();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(async () => (await pane.boundingBox())?.y).toBe(statusBarClearance);
});
