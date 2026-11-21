import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page})=>{await page.route('**/connection-fixture',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('/connection-fixture');});
test('transient health failure is confirmed before disabling playback',async({page})=>{
 let requests=0;await page.route('**/api/health?*',r=>{requests++;return requests===1?r.abort('connectionreset'):r.fulfill({json:{status:'ok'}});});
 const result=await page.evaluate(async()=>{const path='/src/lib/serverConnection.ts',m=await import(path);let offline=false;m.subscribeConnection(()=>{if(!m.isServerOnline())offline=true;});return {online:await m.checkServerConnection(),offline};});
 expect(result).toEqual({online:true,offline:false});expect(requests).toBe(2);
});
test('real server outage becomes offline and next successful check recovers',async({page})=>{
 await page.route('**/api/health?*',r=>r.fulfill({status:502,body:'unavailable'}));
 expect(await page.evaluate(async()=>{const p='/src/lib/serverConnection.ts';return(await import(p)).checkServerConnection();})).toBe(false);
 await page.unroute('**/api/health?*');await page.route('**/api/health?*',r=>r.fulfill({json:{status:'ok'}}));
 expect(await page.evaluate(async()=>{const p='/src/lib/serverConnection.ts';return(await import(p)).checkServerConnection();})).toBe(true);
});
test('offline event cancels stale check and reconnect starts a fresh request immediately',async({page})=>{
 let requests=0;await page.route('**/api/health?*',async r=>{requests++;if(requests===1)await new Promise(resolve=>setTimeout(resolve,250));await r.fulfill({json:{status:'ok'}}).catch(()=>{});});
 const result=await page.evaluate(async()=>{const path='/src/lib/serverConnection.ts',m=await import(path);const old=m.checkServerConnection();m.markNetworkOffline();const fresh=m.checkServerConnection();return {different:old!==fresh,online:await fresh};});
 expect(result).toEqual({different:true,online:true});
});

test('reachable server overrides a stale Safari device-offline flag',async({page})=>{
 await page.route('**/api/health?*',r=>r.fulfill({json:{status:'ok'}}));
 const result=await page.evaluate(async()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});const p='/src/lib/serverConnection.ts',m=await import(p);m.markNetworkOffline();return{probe:await m.checkServerConnection(),state:m.getConnectionState().isOnline,playable:m.isServerOnline()};});
 expect(result).toEqual({probe:true,state:true,playable:true});
});

test('manual reconnect replaces a stalled automatic probe without waiting for it', async ({page}) => {
  let requests = 0;
  let releaseStale!: () => void;
  const stalled = new Promise<void>(resolve => { releaseStale = resolve; });
  await page.route('**/api/health?*', async route => {
    if (++requests === 1) {
      await stalled;
      await route.fulfill({status: 503}).catch(() => {});
    } else {
      await route.fulfill({json: {status: 'ok'}});
    }
  });
  try {
    await page.evaluate(async () => {
      const path = '/src/lib/serverConnection.ts';
      void (await import(path)).checkServerConnection();
    });
    await expect.poll(() => requests).toBe(1);
    expect(await page.evaluate(async () => {
      const path = '/src/lib/serverConnection.ts';
      return (await import(path)).reconnectToServer();
    })).toBe(true);
    expect(requests).toBe(2);
  } finally {
    releaseStale();
  }
});
