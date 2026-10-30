import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRadioSongs} from '../src/server/ytmusic/radio.ts';
import {YoutubeMusicClient} from '../src/server/ytmusic/YoutubeMusicClient.ts';
import app from '../src/server/ytmusic/api.ts';
const seed='abcdefghijk',other='lmnopqrstuv';
const row=(id:string)=>({playlistPanelVideoRenderer:{videoId:id,title:{runs:[{text:'A real radio song'}]},longBylineText:{runs:[{text:'Artist',navigationEndpoint:{browseEndpoint:{browseId:'UCtest'}}},{text:' • '},{text:'Album',navigationEndpoint:{browseEndpoint:{browseId:'MPREtest'}}}]},lengthText:{simpleText:'3:21'},thumbnail:{thumbnails:[{url:'small'},{url:'large'}]}}});
test('radio parses playable rows, preserves catalog links and excludes seed/duplicates',()=>{
 const songs=parseRadioSongs({contents:[row(seed),row(other),row(other),row('invalid'),{playlistPanelVideoRenderer:{...row('12345678901').playlistPanelVideoRenderer,isPlayable:false}}, {menu:{videoId:'12345678901'}}]},seed);
 assert.equal(songs.length,1);assert.deepEqual(songs[0],{videoId:other,title:'A real radio song',artist:'Artist',artistId:'UCtest',album:'Album',albumId:'MPREtest',durationSeconds:201,durationText:'3:21',thumbnailUrl:'large'});
});
test('radio validates seeds, shares in-flight requests and caches successful responses',async()=>{
 const client=new YoutubeMusicClient();let calls=0;
 (client as any).innertubePost=async(endpoint:string,body:any)=>{assert.equal(endpoint,'next');assert.equal(body.playlistId,'RDAMVM'+seed);calls++;return {contents:[row(seed),row(other)]};};
 const [a,b]=await Promise.all([client.radio(seed),client.radio(seed)]);assert.deepEqual(a,b);await client.radio(seed);assert.equal(calls,1);await assert.rejects(()=>client.radio('bad'));
});
test('radio endpoint rejects invalid IDs and exposes upstream failure for fallback',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const {port}=server.address() as {port:number};
 const {youtubeMusicClient}=await import('../src/server/ytmusic/YoutubeMusicClient.ts');const original=youtubeMusicClient.radio;
 try{assert.equal((await fetch(`http://127.0.0.1:${port}/api/ytmusic/radio/bad`)).status,400);youtubeMusicClient.radio=async()=>{throw Error('fixture');};assert.equal((await fetch(`http://127.0.0.1:${port}/api/ytmusic/radio/${seed}`)).status,502);youtubeMusicClient.radio=async()=>parseRadioSongs({contents:[row(other)]},seed);const response=await fetch(`http://127.0.0.1:${port}/api/ytmusic/radio/${seed}`);assert.equal(response.status,200);const data=await response.json();assert.equal(data.source,'youtube-music-radio');assert.equal(data.songs[0].videoId,other);}
 finally{youtubeMusicClient.radio=original;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
