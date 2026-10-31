import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beginDownloadJob, updateDownloadJob, readDownloadJob, validDownloadRequestId } from '../src/server/bridge/DownloadJobs.js';
test('capture progress never invents elapsed time or completes before artifact validation; jobs expire and reject collisions', () => {
  const id = randomUUID(); beginDownloadJob(id, 'session-a');
  assert.equal(readDownloadJob(id, 'session-b'), undefined);
  assert.throws(() => beginDownloadJob(id, 'session-b'), /already in use/);
  updateDownloadJob(id, 'recording', 5, 10);
  assert.equal(readDownloadJob(id, 'session-a')!.progress, 47);
  updateDownloadJob(id, 'recording', 5, 10);
  assert.equal(readDownloadJob(id, 'session-a')!.progress, 47);
  updateDownloadJob(id, 'recording', 10, 10);
  updateDownloadJob(id, 'finalizing');
  assert.equal(readDownloadJob(id, 'session-a')!.progress, 95);
  updateDownloadJob(id, 'cancelled');
  const now = Date.now; try {
    Date.now = () => now() + 120001;
    assert.equal(readDownloadJob(id, 'session-a'), undefined);
  } finally { Date.now = now; }
  assert.equal(validDownloadRequestId('invalid'), false);
  assert.equal(validDownloadRequestId(id + '!'), false);
});

test('bulk completions and cancellations never exhaust progress capacity or evict active downloads',()=>{
 const keep=randomUUID();beginDownloadJob(keep,'active-owner');
 for(let i=0;i<600;i++){const id=randomUUID();beginDownloadJob(id,'bulk');updateDownloadJob(id,i%3===0?'cancelled':i%3===1?'failed':'completed');assert.ok(readDownloadJob(keep,'active-owner'));}
 const result=randomUUID();beginDownloadJob(result,'bulk');updateDownloadJob(result,'transferring');const clock=Date.now;try{Date.now=()=>clock()+120001;assert.equal(readDownloadJob(result,'bulk')?.phase,'transferring');}finally{Date.now=clock;}
 updateDownloadJob(result,'completed');assert.equal(readDownloadJob(result,'bulk')?.progress,100);updateDownloadJob(result,'cancelled');assert.equal(readDownloadJob(result,'bulk')?.phase,'completed');updateDownloadJob(keep,'cancelled');
});

test('active progress stays bounded and capacity failures remain retryable',()=>{
 const active=Array.from({length:128},()=>randomUUID());for(const id of active)beginDownloadJob(id,'busy');
 assert.throws(()=>beginDownloadJob(randomUUID(),'busy'),(e:any)=>e.status===503&&e.code==='download_capacity_reached');
 for(const id of active)assert.ok(readDownloadJob(id,'busy'));
 updateDownloadJob(active[0],'cancelled');const replacement=randomUUID();beginDownloadJob(replacement,'next');assert.ok(readDownloadJob(replacement,'next'));assert.equal(readDownloadJob(replacement,'busy'),undefined);
 for(const id of [...active,replacement])updateDownloadJob(id,'cancelled');
});
