import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router from '../src/server/lyricsRoutes.js';
test('lyrics fallback is used only when primary misses; outages stay retryable',async()=>{
 const original=globalThis.fetch;const app=express();app.use(router);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 let primary=false,fail=false;
 globalThis.fetch=(async(input:any,init:any)=>{const u=String(input);if(u.startsWith(base))return original(input,init);if(fail)throw Error('unavailable');if(u.includes('lrclib'))return Response.json(u.includes('/search')?[]:primary?{syncedLyrics:'[00:01]Fixture'}:{},{status:!primary&&!u.includes('/search')?404:200});return Response.json({lyrics:'Fallback fixture'});}) as typeof fetch;
 try{let r=await original(base+'/api/lyrics?title=Fallback&artist=Fixture');assert.equal(r.status,200);assert.equal((await r.json()).source,'lyrics.ovh');primary=true;r=await original(base+'/api/lyrics?title=Timed&artist=Fixture');assert.equal((await r.json()).source,'lrclib');fail=true;r=await original(base+'/api/lyrics?title=Outage&artist=Fixture');assert.equal(r.status,503);fail=false;r=await original(base+'/api/lyrics?title=Outage&artist=Fixture');assert.equal(r.status,200);}finally{globalThis.fetch=original;await new Promise<void>(r=>server.close(()=>r()));}
});
