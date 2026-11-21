import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {VisitorAccess} from '../src/server/admin/VisitorAccess.js';

test('visitor presence, local admin authentication, persistent bans, accounts and active-stream cancellation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sonora-users-'));let access=new VisitorAccess(dir);
 const app=express();app.use(express.json());app.use((q,r,n)=>access.middleware(q,r,n));
 app.get('/api/test',(_q,r)=>r.json({ok:true}));app.get('/api/ytmusic/stream/fixture',(_q,r)=>{r.setHeader('Content-Type','text/plain');r.write('playing');});
 const publicServer=app.listen(0,'127.0.0.1');const admin=express();admin.use(access.adminRouter());const adminServer=admin.listen(0,'127.0.0.1');
 await Promise.all([new Promise<void>(r=>publicServer.once('listening',r)),new Promise<void>(r=>adminServer.once('listening',r))]);
 const base='http://127.0.0.1:'+(publicServer.address() as any).port,local='http://127.0.0.1:'+(adminServer.address() as any).port;
 const headers={'X-Sonora-Admin':access.token};
 try{
  assert.equal((await fetch(local+'/users')).status,403);
  assert.equal((await fetch(local+'/users',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(local+'/users',{headers:{'X-Sonora-Admin':'x'.repeat(64)}})).status,403);
  const first=await fetch(base+'/api/test',{headers:{'User-Agent':'iPhone Safari'}}),cookie=first.headers.get('set-cookie')!.split(';')[0];
  const pulse=()=>fetch(base+'/api/presence',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({playing:true,visible:true})});
  await pulse();let users=(await(await fetch(local+'/users',{headers})).json()).users;
  assert.equal(users.length,1);assert.equal(users[0].device,'iPhone');assert.equal(users[0].online,true);assert.equal(users[0].activity,'Listening');assert.ok(users[0].lastSeen>0);
  const id=users[0].id;const controller=new AbortController();const stream=await fetch(base+'/api/ytmusic/stream/fixture',{headers:{Cookie:cookie},signal:controller.signal});const reader=stream.body!.getReader();await reader.read();
  const setAccess=(blocked:boolean)=>fetch(local+'/access',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id,blocked})});
  assert.equal((await setAccess(true)).status,200);
  await assert.rejects(reader.read());assert.equal((await pulse()).status,403);
  access.close();access=new VisitorAccess(dir);assert.equal((await pulse()).status,403);
  // The admin service captures the old instance; reopen its router for persistence assertions.
  const next=express();next.use(access.adminRouter());const s=next.listen(0,'127.0.0.1');await new Promise<void>(r=>s.once('listening',r));const nextBase='http://127.0.0.1:'+(s.address() as any).port;
  assert.equal((await fetch(nextBase+'/access',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id,blocked:false})})).status,200);assert.equal((await pulse()).status,200);
  const token='account-fixture';writeFileSync(join(dir,'google-library.json'),JSON.stringify({sessions:{[createHash('sha256').update(token).digest('hex')]:{uid:'u1',expires:Date.now()+60000}},accounts:{u1:{profile:{displayName:'Fixture user'}}}}));
  await fetch(base+'/api/test',{headers:{Cookie:cookie+'; sonora_session='+token}});
  users=(await(await fetch(nextBase+'/users',{headers})).json()).users;assert.equal(users[0].name,'Fixture user');
  await fetch(nextBase+'/access',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id,blocked:true})});
  assert.equal((await fetch(base+'/api/test',{headers:{Cookie:'sonora_session='+token}})).status,403);
  s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));controller.abort();
 }finally{access.close();publicServer.closeAllConnections();adminServer.closeAllConnections();await Promise.all([new Promise<void>(r=>publicServer.close(()=>r())),new Promise<void>(r=>adminServer.close(()=>r()))]);rmSync(dir,{recursive:true,force:true});}
});
