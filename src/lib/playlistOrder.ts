import type {PlaylistSort,Track} from '../types/index.js';
export function sortPlaylistTracks(tracks:Track[],sort:PlaylistSort='date-new',customOrder:string[]=[]) {
 const ordered=[...tracks];
 if(sort==='custom'){const rank=new Map(customOrder.map((id,i)=>[id,i]));return ordered.sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));}
 if(sort==='date-new')return ordered.reverse();
 if(sort==='date-old')return ordered;
 return ordered.sort((a,b)=>(a[sort]||'').localeCompare(b[sort]||'',undefined,{numeric:true,sensitivity:'base'})||(sort==='artist'?(a.album||'').localeCompare(b.album||'',undefined,{numeric:true,sensitivity:'base'})||(a.trackNumber||0)-(b.trackNumber||0):0)||a.title.localeCompare(b.title));
}
