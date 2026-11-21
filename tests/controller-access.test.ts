import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {VisitorAccess} from '../src/server/admin/VisitorAccess.js';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

test('Windows controller action executes ban/allow and IP blocks against the real admin API',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sonora-controller-'));const access=new VisitorAccess(dir),app=express();app.use(express.json());app.use('/admin',access.adminRouter());app.use(access.middleware);app.get('/api/test',(_q,r)=>r.json({ok:true}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 const proxy={'X-Forwarded-For':'203.0.113.17','Tailscale-Funnel-Request':'?1','User-Agent':'Mozilla/5.0 (iPhone) Version/18.0 Safari/604.1'};
 try{
  const response=await fetch(base+'/api/test',{headers:proxy});const cookie=response.headers.get('set-cookie')!.split(';')[0];const headers={'X-Sonora-Admin':access.token};
  const user=(await(await fetch(base+'/admin/users',{headers})).json()).users[0];assert.equal(user.ip,'203.0.113.17');assert.equal(user.connection,'Public tunnel');assert.match(user.browser,/Safari/);
  const source=readFileSync('scripts/server-control.ps1','utf8');const start=source.indexOf('function Set-SelectedAccess('),end=source.indexOf('$banUser.Add_Click',start);const fn=source.slice(start,end).replaceAll('http://127.0.0.1:3002',base+'/admin');
  const script=`$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName System.Net.Http\n$script:userHttp=New-Object System.Net.Http.HttpClient\n$script:userHttp.DefaultRequestHeaders.Add('X-Sonora-Admin','${access.token}')\n$script:selectedVisitorId='${user.id}'\n$script:userAction=$null\n$userResult=New-Object System.Windows.Forms.Label\n$banUser=New-Object System.Windows.Forms.Button\n$allowUser=New-Object System.Windows.Forms.Button\n$banIP=New-Object System.Windows.Forms.Button\n$allowIP=New-Object System.Windows.Forms.Button\nfunction Set-AdminHeader { return $true }\n${fn}\nforeach($scope in @('visitor','ip')) { foreach($blocked in @($true,$false)) { Set-SelectedAccess $blocked $scope; if(-not $script:userAction){throw $userResult.Text};$r=$script:userAction.GetAwaiter().GetResult();if(-not $r.IsSuccessStatusCode){throw $r.Content.ReadAsStringAsync().GetAwaiter().GetResult()};Write-Output ($scope+':'+$blocked+':'+[int]$r.StatusCode);$r.Dispose();$script:userAction=$null } }\n$script:userHttp.Dispose()`;
  const scriptPath=join(dir,'check-controller.ps1');writeFileSync(scriptPath,script);
  const result=await new Promise<{code:number|null;out:string}>((resolve,reject)=>{const p=spawn(join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',scriptPath],{windowsHide:true});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',reject);p.on('close',code=>resolve({code,out}));});
  assert.equal(result.code,0,result.out);assert.equal((result.out.match(/:200/g)||[]).length,4,result.out);
  await fetch(base+'/admin/access',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:user.id,scope:'ip',blocked:true})});
  assert.equal((await fetch(base+'/api/test',{headers:proxy})).status,403,'Fresh cookie must not bypass IP block');
  assert.equal((await fetch(base+'/api/test',{headers:{...proxy,'X-Forwarded-For':'203.0.113.18'}})).status,200,'Another IP stays allowed');
  await fetch(base+'/admin/access',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:user.id,scope:'ip',blocked:false})});
  assert.equal((await fetch(base+'/api/test',{headers:{...proxy,Cookie:cookie}})).status,200);
  assert.equal((access as any).clientAddress({socket:{remoteAddress:'203.0.113.4'},headers:{'x-forwarded-for':'1.2.3.4'}}).ip,'203.0.113.4','Untrusted direct client cannot spoof forwarded IP');
 }finally{access.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});}
});
