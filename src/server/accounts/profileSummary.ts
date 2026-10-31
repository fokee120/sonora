/** Compact profile cards: audio metadata/history are fetched only on their own pages. */
export function profilePlaylistPreviews(collections:any,publicIds:string[],own:boolean){
 const visible=new Set(publicIds);return Object.values(collections.playlists||{}).filter((p:any)=>own||visible.has(p.id)).map((p:any)=>{
  let trackCount=0;const tracks:any[]=[];
  for(const id of p.trackIds||[]){const t=collections.tracks?.[id];if(!t)continue;trackCount++;if(!p.artworkUrl&&t.artworkUrl&&tracks.length<4)tracks.push({id:t.id,artworkUrl:t.artworkUrl});}
  return {id:p.id,title:p.title,artworkUrl:p.artworkUrl,trackCount,tracks};
 });
}
