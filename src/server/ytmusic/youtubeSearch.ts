import type {YtmSongDto} from '../../lib/ytmusic/youtubeMusic.js';

/** Read the public results document without executing any scripts from it. */
export function parseYoutubeResults(html:string):YtmSongDto[]{
 const marker=/(?:var\s+ytInitialData\s*=|window\["ytInitialData"\]\s*=)\s*/g.exec(html);
 if(!marker)throw new Error('YouTube did not return search results.');
 const start=html.indexOf('{',marker.index+marker[0].length);let depth=0,quoted=false,escape=false,end=-1;
 for(let i=start;i<html.length;i++){const c=html[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}}
 if(start<0||end<0)throw new Error('Incomplete YouTube search response.');
 const data=JSON.parse(html.slice(start,end)),songs:YtmSongDto[]=[],seen=new Set<string>();
 const text=(v:any)=>v?.simpleText||v?.runs?.map((r:any)=>r.text||'').join('')||'';
 // Only primary search results; do not include sidebar suggestions or ads.
 const sections=data.contents?.twoColumnSearchResultsRenderer?.primaryContents||data.contents?.sectionListRenderer||data.contents;
 function visit(node:any){if(!node||typeof node!=='object')return;if(node.videoRenderer){const v=node.videoRenderer,id=v.videoId,duration=text(v.lengthText),title=text(v.title);if(/^[\w-]{11}$/.test(id)&&title&&/^\d+(?::\d{2}){1,2}$/.test(duration)&&!seen.has(id)){seen.add(id);songs.push({videoId:id,title,artist:text(v.ownerText)||text(v.longBylineText)||'YouTube',album:'YouTube',isVideo:true,durationSeconds:duration.split(':').reduce((n:number,p:string)=>n*60+Number(p),0),thumbnailUrl:v.thumbnail?.thumbnails?.at(-1)?.url});}return;}for(const [key,value] of Object.entries(node)){if(!/adSlot|promoted|shelfRenderer|reelShelfRenderer/i.test(key))visit(value);}}
 visit(sections);return songs.slice(0,40);
}
const cache=new Map<string,{expires:number;songs:YtmSongDto[]}>();
export async function searchYoutubeVideos(query:string):Promise<YtmSongDto[]>{
 const key=query.trim().toLowerCase(),saved=cache.get(key);if(saved&&saved.expires>Date.now())return saved.songs;
 const url=new URL('https://www.youtube.com/results');url.searchParams.set('search_query',query);url.searchParams.set('sp','EgIQAQ==');url.searchParams.set('hl','en');
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('YouTube search unavailable.');
 const songs=parseYoutubeResults(await response.text());if(cache.size>=30)cache.delete(cache.keys().next().value!);cache.set(key,{songs,expires:Date.now()+300000});return songs;
}
