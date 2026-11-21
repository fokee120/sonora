type Snapshot={track:any;queue:any[];position:number;playing:boolean;playlistId?:string|null;shuffle?:boolean;repeatMode?:string;items?:any[];queueIndex?:number};
type Device={id:string;name:string;seen:number;commands:any[]};
type Room={devices:Map<string,Device>;owner:string|null;until:number;snapshot:Snapshot|null;transfer:string|null;epoch:number};
export class PlaybackRooms{
 private rooms=new Map<string,Room>();
 room(uid:string){let r=this.rooms.get(uid);if(!r){r={devices:new Map(),owner:null,until:0,snapshot:null,transfer:null,epoch:0};this.rooms.set(uid,r);}if(r.owner&&r.until<=Date.now()){r.owner=r.transfer;r.transfer=null;r.epoch++;r.until=Date.now()+10000;}for(const[id,d]of r.devices)if(Date.now()-d.seen>30000&&id!==r.owner)r.devices.delete(id);return r;}
 heartbeat(uid:string,id:string,name:string,snapshot?:Snapshot,ack=false,epoch?:number){const r=this.room(uid);if(!r.devices.has(id)&&r.devices.size>=16)throw Error('Too many devices');const d=r.devices.get(id)||{id,name,seen:0,commands:[]};d.name=name;d.seen=Date.now();r.devices.set(id,d);
 if(r.owner===id){r.until=Date.now()+10000;if(snapshot&&epoch===r.epoch&&!d.commands.length)r.snapshot=snapshot;if(r.transfer&&ack){r.owner=r.transfer;r.transfer=null;r.epoch++;r.until=Date.now()+10000;}}
 const commands=d.commands.splice(0);return this.view(uid,id,commands);}
 view(uid:string,id:string,commands:any[]=[]){const r=this.room(uid);return{owner:r.owner,leaseMs:r.owner===id?Math.max(0,r.until-Date.now()-1000):0,epoch:r.epoch,revoked:r.owner===id&&!!r.transfer,snapshot:r.snapshot,commands,devices:[...r.devices.values()].filter(d=>Date.now()-d.seen<12000).map(d=>({id:d.id,name:d.name,active:d.id===r.owner}))};}
 claim(uid:string,id:string){const r=this.room(uid);if(!r.devices.has(id))throw Error('Device is not online');if(!r.owner){r.owner=id;r.until=Date.now()+10000;r.epoch++;}return r.owner===id&&!r.transfer;}
 command(uid:string,id:string,command:any){const r=this.room(uid);if(!r.devices.has(id))throw Error('Device is not online');if(command.action==='transfer'){const target=r.devices.get(command.target);if(!target||Date.now()-target.seen>12000)throw Error('Device is no longer online');if(r.owner===target.id)return;if(!r.owner){r.owner=target.id;r.epoch++;r.until=Date.now()+10000;}else r.transfer=target.id;return;}const owner=r.owner&&r.devices.get(r.owner);if(!owner)throw Error('Choose an online device first');if(owner.commands.length>=20)throw Error('Playback controls are busy');owner.commands.push(command);if(r.snapshot&&(command.action==='play'||command.action==='pause'))r.snapshot={...r.snapshot,playing:command.action==='play'};}
 release(uid:string,id:string){const r=this.room(uid);if(r.owner===id){r.owner=null;r.transfer=null;r.epoch++;}}
}
export const playbackRooms=new PlaybackRooms();
