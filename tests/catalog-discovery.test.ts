import test from 'node:test';
import assert from 'node:assert/strict';
import { YoutubeMusicClient } from '../src/server/ytmusic/YoutubeMusicClient.js';
const endpoint=(id:string,type:string)=>({browseEndpoint:{browseId:id,browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:type}}}});
const column=(runs:any[])=>({musicResponsiveListItemFlexColumnRenderer:{text:{runs}}});
const thumbnail={musicThumbnailRenderer:{thumbnail:{thumbnails:[{url:'https://image.test/large',width:544}]}}};
function responsive(id:string,title:string){return {musicResponsiveListItemRenderer:{
 navigationEndpoint:endpoint(id,id.startsWith('UC')?'MUSIC_PAGE_TYPE_ARTIST':'MUSIC_PAGE_TYPE_ALBUM'),
 flexColumns:[column([{text:title}]),column([{text:'Album • '},{text:'RINI',navigationEndpoint:endpoint('UCfixture','MUSIC_PAGE_TYPE_ARTIST')},{text:' • 2021'}])],thumbnail,
}};}
test('catalog search retains artists and albums without treating them as songs',async()=>{
 const client=new YoutubeMusicClient();
 const shelf={musicShelfRenderer:{title:{runs:[{text:'Artists'}]},contents:[responsive('UCfixture','RINI'),responsive('MPREfixture','Constellations'),responsive('UCfixture','RINI')]}};
 (client as any).innertubePost=async()=>({contents:{tabbedSearchResultsRenderer:{tabs:[{tabRenderer:{content:{sectionListRenderer:{contents:[shelf]}}}}]}}});
 const result=await client.search('RINI','artists');
 assert.equal(result.artists?.length,1);assert.equal(result.artists?.[0].browseId,'UCfixture');assert.equal(result.albums?.[0].artist,'RINI');assert.equal(result.albums?.[0].artistId,'UCfixture');assert.equal(result.albums?.[0].year,2021);assert.equal(result.albums?.[0].artworkUrl,'https://image.test/large');assert.deepEqual(result.songs,[]);
});
test('album browse fills missing artists and covers and reads fixed-column durations',async()=>{
 const client=new YoutubeMusicClient();let calls=0;
 const header={musicResponsiveHeaderRenderer:{
  title:{runs:[{text:'Constellations'}]},subtitle:{runs:[{text:'Album • 2021'}]},
  straplineTextOne:{runs:[{text:'RINI',navigationEndpoint:endpoint('UCfixture','MUSIC_PAGE_TYPE_ARTIST')}]},thumbnail,
 }};
 const row={musicResponsiveListItemRenderer:{
  playlistItemData:{videoId:'abcdefghijk'},flexColumns:[column([{text:'Aphrodite'}]),column([])],
  fixedColumns:[{musicResponsiveListItemFixedColumnRenderer:{text:{runs:[{text:'3:41'}]}}}],
 }};
 (client as any).innertubePost=async()=>{calls++;return {contents:{header,musicPlaylistShelfRenderer:{contents:[row]}}};};
 const result=await client.browse('MPREfixture');
 assert.equal(result.artist,'RINI');assert.equal(result.artistId,'UCfixture');assert.equal(result.year,2021);
 assert.equal(result.songs[0].durationSeconds,221);assert.equal(result.songs[0].artist,'RINI');assert.equal(result.songs[0].album,'Constellations');assert.equal(result.songs[0].albumId,'MPREfixture');assert.equal(result.songs[0].thumbnailUrl,'https://image.test/large');
 await client.browse('MPREfixture');assert.equal(calls,1);
});
