import {textOf, walk} from './catalog.js';
import type {YtmSong} from './YoutubeMusicClient.js';
/** Normalize the real Up next radio response without taking menu/watch links as songs. */
export function parseRadioSongs(data: unknown, seed: string): YtmSong[]{
 const songs:YtmSong[]=[],seen=new Set([seed]);
 walk(data,node=>{
  const row=node.playlistPanelVideoRenderer;
  if(!row||typeof row.videoId!=='string'||!/^[\w-]{11}$/.test(row.videoId)||seen.has(row.videoId)||row.isPlayable===false)return;
  const title=textOf(row.title);if(!title)return;
  const runs=row.longBylineText?.runs||row.shortBylineText?.runs||[];
  const artistRun=runs.find((r:any)=>r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'));
  const albumRun=runs.find((r:any)=>r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPRE'));
  const durationText=textOf(row.lengthText),parts=durationText.split(':').map(Number);
  const thumbnails=row.thumbnail?.thumbnails||[];
  seen.add(row.videoId);songs.push({videoId:row.videoId,title,artist:artistRun?.text||runs.find((r:any)=>r.text?.trim()&&!/^[•·]$/.test(r.text.trim()))?.text||'Unknown Artist',artistId:artistRun?.navigationEndpoint.browseEndpoint.browseId,album:albumRun?.text,albumId:albumRun?.navigationEndpoint.browseEndpoint.browseId,durationSeconds:parts.every(Number.isFinite)?parts.reduce((n:number,p:number)=>n*60+p,0):0,durationText,thumbnailUrl:thumbnails.at(-1)?.url});
 });
 return songs;
}
