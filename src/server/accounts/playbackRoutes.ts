import express from 'express';
import {playbackRooms} from './PlaybackRooms.js';
import {sharedPlaybackEnabled,setSharedPlayback} from './googleLibrary.js';
export const playbackRouter=express.Router();
playbackRouter.use(express.json({limit:'2mb'}));
playbackRouter.use((req,res,next)=>{if(req.method==='POST'){const origin=req.headers.origin;if(!origin||!['http://localhost:3000','http://localhost:4173','http://127.0.0.1:4175',process.env.SONORA_PUBLIC_ORIGIN||'https://enzo-pc.tail1214fa.ts.net:8443'].includes(origin))return res.sendStatus(403);}next();});
playbackRouter.post('/',(req,res)=>{const uid=res.locals.account.uid,b=req.body||{},id=b.deviceId;if(typeof id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(id))return res.sendStatus(400);try{
 if(b.action==='preference'){if(typeof b.enabled!=='boolean')return res.sendStatus(400);setSharedPlayback(uid,b.enabled);if(!b.enabled)playbackRooms.release(uid,id);}
 const enabled=sharedPlaybackEnabled(uid);
 if(b.action==='heartbeat'||b.action==='preference'){
  const raw=b.snapshot;let snapshot:any;
  if(raw&&typeof raw.position==='number'&&Number.isFinite(raw.position)&&raw.position>=0&&typeof raw.playing==='boolean'&&Array.isArray(raw.queue)&&raw.queue.length<=5000&&(!raw.track||typeof raw.track.id==='string'))snapshot={track:raw.track,queue:raw.queue,position:raw.position,playing:raw.playing,playlistId:raw.playlistId||null,shuffle:raw.shuffle===true,repeatMode:['off','all','one'].includes(raw.repeatMode)?raw.repeatMode:'off',items:Array.isArray(raw.items)&&raw.items.length<=5000?raw.items:undefined,queueIndex:Number.isInteger(raw.queueIndex)?raw.queueIndex:0};
  if(snapshot){snapshot.manualBase=Array.isArray(raw.manualBase)&&raw.manualBase.length<=5000?raw.manualBase:null;snapshot.playlistProfileId=raw.playlistProfileId||null;}
  const view=playbackRooms.heartbeat(uid,id,String(b.name||'Sonora device').slice(0,60),enabled?snapshot:undefined,b.ack===true,b.epoch);return res.json({...view,enabled});}
 if(!enabled)return res.json({enabled:false});
 if(b.action==='claim')return res.json({granted:playbackRooms.claim(uid,id),...playbackRooms.view(uid,id),enabled});
 const command=b.command;if(b.action!=='command'||!command||!['transfer','play','pause','next','previous','seek','track','shuffle','repeat','queue','playlist','playlistOrder','setQueue','removeQueue','clearQueue','repeatMode'].includes(command.action))return res.sendStatus(400);
 if(command.action==='seek'&&(!Number.isFinite(command.position)||command.position<0))return res.sendStatus(400);
 if(command.action==='track'&&(!command.track||typeof command.track.id!=='string'||!Array.isArray(command.queue)||command.queue.length>5000))return res.sendStatus(400);
 if(['playlist','playlistOrder','setQueue'].includes(command.action)&&(!Array.isArray(command.tracks)||command.tracks.length>5000))return res.sendStatus(400);
 if(command.action==='repeatMode'&&!['off','all','one'].includes(command.mode))return res.sendStatus(400);
 playbackRooms.command(uid,id,command);res.json({ok:true});
 }catch(e){res.status(409).json({error:e instanceof Error?e.message:'Playback unavailable'});}});
