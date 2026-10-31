import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
const track={id:'ytm:abcdefghijk',source:'ytmusic',sourceId:'abcdefghijk',title:'A complete song',artist:'Artist',album:'Album',duration:1};
function wav(){const size=16000,b=Buffer.alloc(size+44);b.write('RIFF');b.writeUInt32LE(size+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);return b;}
test.beforeEach(async({page})=>{await page.route('**/api/**',r=>r.fulfill({json:{tracks:[],songs:[],artists:[],albums:[]}}));await page.goto('/');await page.evaluate(async()=>{const c='/src/lib/offline/AudioCache.ts';await(await import(c)).audioCache.setLimit(0);});});
test('complete downloads are reused without network requests or automatic-cache bytes',async({page})=>{
 let requests=0;await page.route('**/api/ytmusic/download/**',r=>{requests++;return r.abort();});
 const result=await page.evaluate(async({track,bytes})=>{const d='/src/lib/db.ts',c='/src/lib/offline/AudioCache.ts';const {dbService}=await import(d);const blob=new Blob([new Uint8Array(bytes)],{type:'audio/wav'});await dbService.saveAudioBlob(track.id,blob,'audio/wav');await dbService.saveDownloadState({trackId:track.id,status:'completed',progress:100,bytesDownloaded:blob.size,totalBytes:blob.size});const cache=(await import(c)).audioCache;const reused=await cache.ensure(track);await cache.setLimit(.25);cache.enqueue([track]);await new Promise(r=>setTimeout(r,150));return{size:reused.size,stats:await cache.stats()};},{track,bytes:[...wav()]});
 expect(requests).toBe(0);expect(result.size).toBe(wav().length);expect(result.stats.count).toBe(0);expect(result.stats.failed).toBe(0);
});
test('legacy duplicate cache entries are removed on startup while the downloaded file stays intact',async({page})=>{
 await page.evaluate(async({track,bytes})=>{const d='/src/lib/db.ts';const {dbService,getDB}=await import(d),db=await getDB(),blob=new Blob([new Uint8Array(bytes)],{type:'audio/wav'});await dbService.saveAudioBlob(track.id,blob,'audio/wav');await dbService.saveDownloadState({trackId:track.id,status:'completed',progress:100,bytesDownloaded:blob.size,totalBytes:blob.size});await db.put('autoAudio',{trackId:track.id,bytes:await blob.arrayBuffer(),mimeType:blob.type,size:blob.size,cachedAt:Date.now(),lastPlayedAt:0});},{track,bytes:[...wav()]});await page.reload();
 const result=await page.evaluate(async id=>{const d='/src/lib/db.ts',c='/src/lib/offline/AudioCache.ts';const cache=(await import(c)).audioCache;const stats=await cache.stats();return{count:stats.count,download:await(await import(d)).dbService.hasAudioBlob(id)};},track.id);expect(result).toEqual({count:0,download:true});
});
test('a new download removes its old automatic cache copy and an uncached song can still be cached',async({page})=>{
 await page.route('**/api/ytmusic/download/**',r=>r.fulfill({body:wav(),contentType:'audio/wav'}));
 await page.evaluate(async track=>{const c='/src/lib/offline/AudioCache.ts';const cache=(await import(c)).audioCache;await cache.setLimit(.25);await cache.ensure(track);},track);
 await expect.poll(()=>page.evaluate(async()=>{const c='/src/lib/offline/AudioCache.ts';return(await(await import(c)).audioCache.stats()).count;})).toBe(1);
 await page.evaluate(async({track,bytes})=>{const d='/src/lib/db.ts',db=(await import(d)).dbService,blob=new Blob([new Uint8Array(bytes)],{type:'audio/wav'});await db.saveAudioBlob(track.id,blob,'audio/wav');await db.saveDownloadState({trackId:track.id,status:'completed',progress:100,bytesDownloaded:blob.size,totalBytes:blob.size});},{track,bytes:[...wav()]});
 await expect.poll(()=>page.evaluate(async()=>{const c='/src/lib/offline/AudioCache.ts';return(await(await import(c)).audioCache.stats()).count;})).toBe(0);
});

test('an in-flight automatic fetch cannot recreate a cache copy after its download completes',async({page})=>{
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),requestStarted=new Promise<void>(r=>started=r);
 await page.route('**/api/ytmusic/download/**',async r=>{started();await gate;await r.fulfill({body:wav(),contentType:'audio/wav'});});
 await page.evaluate(async track=>{const c='/src/lib/offline/AudioCache.ts',cache=(await import(c)).audioCache;await cache.setLimit(.25);(window as any).__cachePending=cache.ensure(track);},track);
 await requestStarted;
 await page.evaluate(async({track,bytes})=>{const d='/src/lib/db.ts',db=(await import(d)).dbService,blob=new Blob([new Uint8Array(bytes)],{type:'audio/wav'});await db.saveAudioBlob(track.id,blob,'audio/wav');await db.saveDownloadState({trackId:track.id,status:'completed',progress:100,bytesDownloaded:blob.size,totalBytes:blob.size});},{track,bytes:[...wav()]});
 release();await page.evaluate(()=>(window as any).__cachePending);
 await expect.poll(()=>page.evaluate(async()=>{const c='/src/lib/offline/AudioCache.ts',cache=(await import(c)).audioCache;await(cache as any).writes;return(await cache.stats()).count;})).toBe(0);
});
