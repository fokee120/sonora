type Json = Record<string, any>;
export type CatalogArtist = { browseId:string; name:string; artworkUrl?:string };
export type CatalogAlbum = { browseId:string; title:string; artist:string; artistId?:string; artworkUrl?:string; year?:number; kind?:string };
export const textOf=(node:any):string=>typeof node==='string'?node:node?.simpleText||node?.runs?.map((r:any)=>r.text||'').join('')||'';
export function walk(node:any, visit:(node:Json)=>void){if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const child of node)walk(child,visit);return;}visit(node);for(const child of Object.values(node))walk(child,visit);}
export function thumbnailOf(node:any):string|undefined{
 let best:{url:string;width:number}|undefined;
 walk(node,n=>{for(const item of Array.isArray(n.thumbnails)?n.thumbnails:[])if(typeof item.url==='string'&&(!best||(item.width||0)>best.width))best={url:item.url,width:item.width||0};});
 return best?.url;
}
export function browseOf(node:Json):Json|undefined{
 return node.navigationEndpoint?.browseEndpoint||node.title?.runs?.find((r:any)=>r.navigationEndpoint?.browseEndpoint)?.navigationEndpoint?.browseEndpoint||node.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.find((r:any)=>r.navigationEndpoint?.browseEndpoint)?.navigationEndpoint?.browseEndpoint;
}
export function linkedIds(renderer:Json){
 const runs=(renderer.flexColumns||[]).flatMap((c:any)=>c.musicResponsiveListItemFlexColumnRenderer?.text?.runs||[]);
 const endpoints=runs.map((r:any)=>r.navigationEndpoint?.browseEndpoint).filter(Boolean);
 return { artistId:endpoints.find((e:any)=>e.browseId?.startsWith('UC'))?.browseId,albumId:endpoints.find((e:any)=>e.browseId?.startsWith('MPRE')||e.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType==='MUSIC_PAGE_TYPE_ALBUM')?.browseId };
}
export function collectCatalog(data:any){
 const artists=new Map<string,CatalogArtist>(),albums=new Map<string,CatalogAlbum>(),rows:Json[]=[];
 walk(data,n=>{
  const r=n.musicTwoRowItemRenderer||n.musicResponsiveListItemRenderer;
  if(!r)return;
  if(n.musicResponsiveListItemRenderer)rows.push(r);
  const endpoint=browseOf(r),id=endpoint?.browseId;
  if(!id)return;
  const name=textOf(r.title)||textOf(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
  if(!name)return;
  const runs=r.subtitle?.runs||r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs||[];
  const tokens=textOf({runs}).split(/\s*[•·]\s*/).filter(Boolean);
  const type=endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  if(type==='MUSIC_PAGE_TYPE_ARTIST'||id.startsWith('UC'))artists.set(id,{browseId:id,name,artworkUrl:thumbnailOf(r)});
  else if(type==='MUSIC_PAGE_TYPE_ALBUM'||id.startsWith('MPRE')){
   const artistRun=runs.find((run:any)=>run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'));
   const artist=textOf(artistRun?.text)||tokens.find((t:string)=>!/^album$|^single$|^ep$|^\d{4}$|^song/i.test(t))||'';
   albums.set(id,{browseId:id,title:name,artist,artistId:artistRun?.navigationEndpoint?.browseEndpoint?.browseId,artworkUrl:thumbnailOf(r),year:Number(tokens.find((t:string)=>/^\d{4}$/.test(t)))||undefined,kind:tokens.find((t:string)=>/^(album|single|ep)$/i.test(t))});
  }
 });
 return {artists:[...artists.values()],albums:[...albums.values()],rows};
}
export function browseHeader(data:any){
 const header=data.header?.musicImmersiveHeaderRenderer||data.header?.musicVisualHeaderRenderer||data.header?.musicDetailHeaderRenderer||data.header?.musicResponsiveHeaderRenderer;
 let found=header;
 if(!found)walk(data,n=>{if(!found)found=n.musicResponsiveHeaderRenderer||n.musicDetailHeaderRenderer;});
 const title=textOf(found?.title)||textOf(found?.straplineTextOne);
 const subtitle=textOf(found?.subtitle),description=textOf(found?.description);
 const artist=textOf(found?.straplineTextOne);const artistId=found?.straplineTextOne?.runs?.find((r:any)=>r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))?.navigationEndpoint?.browseEndpoint?.browseId;
 return {title,subtitle,description,artist,artistId,year:Number(subtitle.match(/\b(19|20)\d{2}\b/)?.[0])||undefined,artworkUrl:thumbnailOf(found?.thumbnail||found)};
}
