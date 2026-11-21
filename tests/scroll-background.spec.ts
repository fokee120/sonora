import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block',reducedMotion:'reduce',viewport:{width:393,height:852}});
for(const theme of ['gotham','notebook'])test(theme+' scenery moves exactly with page scroll without fixed/local attachments',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({json:{status:'ok',tracks:[],albums:[],artists:[],user:null,authRequired:false}}));await page.goto('/');
 await page.evaluate(async theme=>{const p='/src/lib/appearance.ts';(await import(p)).chooseTheme(theme);},theme);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const canvas=page.locator('#main-content-scroll .page-canvas');
 const before=await canvas.evaluate(e=>({y:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,background:getComputedStyle(e,'::before').backgroundImage,attachment:getComputedStyle(e,'::before').backgroundAttachment,transform:getComputedStyle(e,'::before').transform,panePadding:getComputedStyle(e.parentElement!).paddingTop}));
 expect(before.background).not.toBe('none');expect(before.attachment.split(',').every(value=>value.trim()==='scroll')).toBe(true);expect(before.transform).toBe('none');expect(before.panePadding).toBe('0px');
 const distance=await page.locator('#main-content-scroll').evaluate(e=>{e.scrollTop=260;return e.scrollTop;});expect(distance).toBeGreaterThan(100);
 const after=await canvas.boundingBox();expect(after!.y-before.y).toBeCloseTo(-distance,0);
 expect(await page.locator('.stationary-city').count()).toBe(0);
 for(const width of [320,402,1440]){await page.setViewportSize({width,height:852});expect(await page.locator('#main-content-scroll').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);}
 await page.setViewportSize({width:393,height:852});await page.locator('#main-content-scroll').evaluate(e=>e.scrollTop=180);
 await page.screenshot({path:'.sonora/qa/'+theme+'-scroll-background.png'});
});
