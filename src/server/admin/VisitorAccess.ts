import {isIP} from 'node:net';
import express, {type Request, type Response, type NextFunction} from 'express';
import {randomBytes,randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {authenticatedAccount} from '../accounts/googleLibrary.js';
import fs from 'node:fs';
import path from 'node:path';
interface Visitor {id:string;name:string;accountId?:string;device:string;ip?:string;connection?:string;browser?:string;userAgent?:string;firstSeen:number;lastSeen:number;activity:string;blocked:boolean;}
export class VisitorAccess {
 readonly token:string;
 private users=new Map<string,Visitor>();
 private bannedAccounts=new Set<string>();
 private bannedIPs=new Set<string>();
 private streams=new Map<string,Set<Response>>();
 private file:string;
 private dirty=false;
 private timer:ReturnType<typeof setInterval>;
 constructor(readonly directory=path.resolve('.sonora')) {
  fs.mkdirSync(directory,{recursive:true});
  const tokenFile=path.join(directory,'admin-token');
  try{this.token=fs.readFileSync(tokenFile,'utf8').trim();}catch{this.token=randomBytes(32).toString('hex');fs.writeFileSync(tokenFile,this.token,{mode:0o600});}
  this.file=path.join(directory,'visitors.json');
  try{const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));for(const user of saved.users||[])this.users.set(user.id,user);this.bannedAccounts=new Set(saved.bannedAccounts||[]);this.bannedIPs=new Set(saved.bannedIPs||[]);}catch(error:any){if(error.code!=='ENOENT')throw error;}
  this.timer=setInterval(()=>this.flush(),10000);this.timer.unref();
 }
 private flush(){if(!this.dirty)return;fs.writeFileSync(this.file+'.tmp',JSON.stringify({users:[...this.users.values()],bannedAccounts:[...this.bannedAccounts],bannedIPs:[...this.bannedIPs]}));fs.renameSync(this.file+'.tmp',this.file);this.dirty=false;}
 close(){clearInterval(this.timer);this.flush();}
 private clientAddress(req:Request){
  const normalize=(value:string)=>{const ip=value.replace(/^::ffff:(?=\d+\.)/,'');if(!isIP(ip))return '';return isIP(ip)===6?new URL('http://['+ip+']').hostname.slice(1,-1):ip;};
  const peer=normalize(req.socket.remoteAddress||'');
  // Only trust our local Tailscale reverse proxy. Tailscale overwrites XFF with
  // the real source address; never accept a forwarded chain from a LAN client.
  const forwarded=String(req.headers['x-forwarded-for']||'');
  if(['127.0.0.1','::1'].includes(peer)&&isIP(forwarded))return {ip:normalize(forwarded),connection:req.headers['tailscale-funnel-request']==='?1'?'Public tunnel':'Tailnet proxy'};
  return {ip:peer,connection:'Direct'};
 }
 private signature(id:string){return createHmac('sha256',this.token).update(id).digest('hex');}
 private cookies(req:Request){return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>{const at=s.indexOf('=');return[s.slice(0,at).trim(),s.slice(at+1)];}));}
 private account(req:Request){
  return authenticatedAccount(req, process.env.SONORA_ACCOUNT_FILE || path.join(this.directory,'google-library.json'));
 }
 middleware=(req:Request,res:Response,next:NextFunction)=>{
  if(req.path==='/api/health'||req.path.includes('diagnostic')||req.path.endsWith('/playback-timing')||req.path==='/sw.js'||req.path.startsWith('/assets/'))return next();
  if(!req.path.startsWith('/api/')&&!req.accepts('html'))return next();
  const cookie=this.cookies(req).sonora_visitor||'', parts=cookie.split('.');
  let id=parts[0];const signature=parts[1]||'';
  const expected=/^[a-f0-9-]{36}$/.test(id||'')?this.signature(id):'';
  if(!expected||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected))){id=randomUUID();res.cookie('sonora_visitor',id+'.'+this.signature(id),{httpOnly:true,sameSite:'lax',secure:req.secure||req.headers['x-forwarded-proto']==='https',path:'/',maxAge:365*86400000});}
  let user=this.users.get(id);
  if(!user){
   if(this.users.size>=2000){const removable=[...this.users.values()].filter(u=>!u.blocked&&!u.accountId&&Date.now()-u.lastSeen>86400000).sort((a,b)=>a.lastSeen-b.lastSeen)[0];if(removable)this.users.delete(removable.id);else return res.status(503).json({error:'visitor_capacity'});}
   const ua=req.headers['user-agent']||'';const device=/iPhone/.test(ua)?'iPhone':/iPad/.test(ua)?'iPad':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Macintosh/.test(ua)?'Mac':'Browser';
   user={id,name:'Guest '+id.slice(0,6),device,firstSeen:Date.now(),lastSeen:Date.now(),activity:'Opened Sonora',blocked:false};this.users.set(id,user);
  }
  const account=res.locals.account || this.account(req);if(account){user.accountId=account.uid;user.name=account.name;}
  const address=this.clientAddress(req);user.ip=address.ip;user.connection=address.connection;
  const ua=(req.headers['user-agent']||'').slice(0,400);user.userAgent=ua;
  const browser=ua.match(/(Edg|OPR|Chrome|Firefox|CriOS|FxiOS)\/([\d.]+)/);
  user.browser=browser?({Edg:'Edge',OPR:'Opera',CriOS:'Chrome',FxiOS:'Firefox'}[browser[1]]||browser[1])+' '+browser[2]:/Safari/.test(ua)?'Safari '+(ua.match(/Version\/([\d.]+)/)?.[1]||''):ua==='node'?'Automated client':'Other';
  user.lastSeen=Date.now();this.dirty=true;
  if(user.blocked||(user.accountId&&this.bannedAccounts.has(user.accountId))||(user.ip&&this.bannedIPs.has(user.ip))){res.setHeader('Cache-Control','no-store');return res.status(403).json({error:'access_blocked',message:'Access blocked by the server owner.'});}
  if(req.path==='/api/presence'){
   const heartbeat=req.body||{};
   user.activity=heartbeat.playing===true?'Listening':heartbeat.visible===false?'In background':'Browsing';
   res.setHeader('Cache-Control','no-store');return res.json({ok:true});
  }
  if(req.path.includes('/stream/'))user.activity='Streaming audio';else if(req.path.includes('/download/'))user.activity='Downloading';else if(req.path.includes('/search'))user.activity='Searching';
  if(req.path.includes('/stream/')||req.path.includes('/download/')){
   const active=this.streams.get(id)||new Set<Response>();active.add(res);this.streams.set(id,active);res.once('close',()=>{active.delete(res);if(!active.size)this.streams.delete(id);});
  }
  // Google sets its session cookie during sign-in. Link on completion before the
  // next heartbeat; older clients may still have a path-scoped auth cookie.
  if(req.path==='/api/account/google')res.once('finish',()=>{
   const headers=res.getHeader('set-cookie');const list=Array.isArray(headers)?headers:[String(headers||'')];
   const session=list.find(c=>c.startsWith('sonora_session='))?.split(';')[0];
   if(session){const proxy={headers:{cookie:session}} as Request;const a=this.account(proxy);if(a){user!.accountId=a.uid;user!.name=a.name;this.dirty=true;}}
  });
  next();
 };
 adminRouter(){
  const router=express.Router();
  router.use((req,res,next)=>{
   const value=String(req.headers['x-sonora-admin']||'');
   if(req.headers.origin||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')||!/^[a-f0-9]{64}$/.test(value)||!timingSafeEqual(Buffer.from(value),Buffer.from(this.token)))return res.sendStatus(403);
   res.setHeader('Cache-Control','no-store');next();
  });
  router.get('/users',(_req,res)=>res.json({blockedIPs:[...this.bannedIPs],users:[...this.users.values()].map(u=>({...u,userBlocked:u.blocked||!!u.accountId&&this.bannedAccounts.has(u.accountId),ipBlocked:!!u.ip&&this.bannedIPs.has(u.ip),blocked:u.blocked||!!u.accountId&&this.bannedAccounts.has(u.accountId)||!!u.ip&&this.bannedIPs.has(u.ip),online:Date.now()-u.lastSeen<75000||!!this.streams.get(u.id)?.size})).sort((a,b)=>Number(b.online)-Number(a.online)||b.lastSeen-a.lastSeen)}));
  router.post('/ip-access',express.json({limit:'2kb'}),(req,res)=>{
   const ip=req.body?.ip;
   if(typeof ip!=='string'||!isIP(ip)||['127.0.0.1','::1'].includes(ip)||typeof req.body.blocked!=='boolean')return res.status(400).json({error:'Select a valid remote IP address'});
   if(req.body.blocked)this.bannedIPs.add(ip);else this.bannedIPs.delete(ip);
   if(req.body.blocked)for(const row of this.users.values())if(row.ip===ip)for(const stream of this.streams.get(row.id)||[])stream.destroy();
   this.dirty=true;this.flush();res.json({ok:true,ipBlocked:req.body.blocked});
  });
  router.post('/access',express.json({limit:'2kb'}),(req,res)=>{
   const user=this.users.get(req.body?.id);if(!user||typeof req.body?.blocked!=='boolean')return res.sendStatus(400);
   const blocked=req.body.blocked,scope=req.body.scope||'visitor';
   if(!['visitor','ip'].includes(scope))return res.status(400).json({error:'Invalid block type'});
   if(scope==='ip'){
    if(!user.ip||!isIP(user.ip)||['127.0.0.1','::1'].includes(user.ip))return res.status(400).json({error:'A remote visitor IP is not available yet. Wait for their next visit.'});
    if(blocked)this.bannedIPs.add(user.ip);else this.bannedIPs.delete(user.ip);
   }else{
    if(user.accountId){if(blocked)this.bannedAccounts.add(user.accountId);else this.bannedAccounts.delete(user.accountId);}
    for(const row of this.users.values())if(row.id===user.id||user.accountId&&row.accountId===user.accountId)row.blocked=blocked;
   }
   if(blocked)for(const row of this.users.values())if(scope==='ip'?row.ip===user.ip:row.id===user.id||user.accountId&&row.accountId===user.accountId)for(const stream of this.streams.get(row.id)||[])stream.destroy();
   this.dirty=true;this.flush();res.json({ok:true,userBlocked:user.blocked||!!user.accountId&&this.bannedAccounts.has(user.accountId),ipBlocked:!!user.ip&&this.bannedIPs.has(user.ip)});
  });return router;
 }
}
