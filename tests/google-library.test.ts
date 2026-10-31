import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import express from 'express';
import {OAuth2Client} from 'google-auth-library';import router from '../src/server/accounts/googleLibrary.ts';
test('Google auth verifies nonce, isolates accounts and merges concurrent playlist changes',async()=>{
 const temp=mkdtempSync(path.join(tmpdir(),'sonora-account-test-'));process.env.SONORA_ACCOUNT_FILE=path.join(temp,'accounts.json');process.env.GOOGLE_CLIENT_ID='fixture.apps.googleusercontent.com';const original=OAuth2Client.prototype.verifyIdToken;let payload:any;
 (OAuth2Client.prototype as any).verifyIdToken=async()=>({getPayload:()=>payload});const app=express();app.use('/api/account',router);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url='http://127.0.0.1:'+(server.address() as any).port+'/api/account';
 const owners=new Map<string,string>();
 const request=(route:string,body:any,cookie='')=>fetch(url+route,{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({...body,accountUid:owners.get(cookie)})});
 async function login(uid:string){const session=await fetch(url+'/session');const {nonce}=await session.json();payload={sub:uid,email_verified:true,nonce,email:uid+'@example.com'};const response=await request('/google',{credential:'fixture'},'sonora_nonce='+nonce);assert.equal(response.status,200);const cookie=response.headers.get('set-cookie')!.match(/sonora_session=([^;]+)/)![0];owners.set(cookie,uid);return cookie;}
 try{
  assert.equal((await request('/library',{batch:'unauthorized',changes:[]})).status,401);payload={sub:'x',email_verified:true};assert.equal((await request('/google',{credential:'fixture'})).status,401);
  const a=await login('account-a'),b=await login('account-b');const value={id:'p',title:'One',trackIds:['a','b']};const initial=await request('/library',{batch:'one',changes:[{collection:'playlists',id:'p',value}]},a);assert.equal(initial.status,200);
  let other=await(await request('/library',{batch:'empty',changes:[]},b)).json();assert.deepEqual(other.collections,{});
  await request('/library',{batch:'second-device',changes:[{collection:'playlists',id:'p',base:value,value:{...value,trackIds:['a','b','c']}}]},a);
  const merged=await(await request('/library',{batch:'first-device',changes:[{collection:'playlists',id:'p',base:value,value:{...value,trackIds:['b','d']}}]},a)).json();assert.deepEqual(merged.collections.playlists.p.trackIds,['b','c','d']);
  const retry=await(await request('/library',{batch:'first-device',changes:[{collection:'playlists',id:'p',value:null}]},a)).json();assert.ok(retry.collections.playlists.p);
  const poisoned=await request('/library',{batch:'bad',changes:[{collection:'playlists',id:'__proto__',value:{}}]},a);assert.equal(poisoned.status,400);
  const get=(route:string,cookie:string)=>fetch(url+route,{headers:{Cookie:cookie}});
  const privateView=await(await get('/profile/account-a',b)).json();assert.deepEqual(privateView.playlists,[]);assert.equal(privateView.history,null);assert.equal(privateView.recap,null);assert.equal(privateView.email,undefined);
  assert.equal((await request('/profile',{name:'Alice',picture:'',recapPublic:true,historyPublic:false,publicPlaylists:['p']},a)).status,200);
  const publicView=await(await get('/profile/account-a',b)).json();assert.equal(publicView.name,'Alice');assert.equal(publicView.playlists.length,1);assert.ok(Array.isArray(publicView.recap));assert.equal(publicView.history,null);
  assert.equal((await request('/follow/account-a',{follow:true},b)).status,200);const connections=await(await get('/connections/account-a',a)).json();assert.equal(connections.followers[0].id,'account-b');
  assert.equal((await get('/people','')).status,401);assert.equal((await request('/profile',{name:'X',picture:'',recapPublic:false,historyPublic:false,publicPlaylists:['missing']},a)).status,400);
  const listening=await(await get('/listening/account-a',b)).json();assert.ok(Array.isArray(listening.recap));assert.equal(listening.history,null);
  const oldPlay={id:'old-play',trackId:'a',playedAt:Date.parse('2026-10-20T10:34:56Z'),track:{id:'a',title:'Frozen song',artist:'A'}};
  await request('/library',{batch:'weekly-history',changes:[{collection:'history',id:'old-play',value:oldPlay}]},a);
  const weeks=await(await get('/weekly/account-a?offset=180',b)).json();assert.ok(weeks.length);assert.equal(weeks[0].entries.length,1);assert.notEqual(weeks[0].entries[0].playedAt,oldPlay.playedAt);assert.notEqual(weeks[0].entries[0].id,oldPlay.id);
  await request('/library',{batch:'late-weekly-history',changes:[{collection:'history',id:'late',value:{...oldPlay,id:'late'}}]},a);
  const frozen=await(await get('/weekly/account-a?offset=180',a)).json();assert.equal(frozen[0].entries.length,1);
  assert.equal((await get('/weekly/account-b',a)).status,403);
  await request('/logout',{},a);assert.equal((await request('/library',{batch:'after-logout',changes:[]},a)).status,401);
 }finally{OAuth2Client.prototype.verifyIdToken=original;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));delete process.env.SONORA_ACCOUNT_FILE;rmSync(temp,{recursive:true,force:true});}
});
