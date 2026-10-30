import {orderedPool} from '../../lib/importConcurrency.js';
const endpoint='https://api-partner.spotify.com/pathfinder/v1/query';
// Public web-player operation documented by SpotifyScraper's api/pathfinder.py:
// https://github.com/AliAkhtari78/SpotifyScraper (MIT).
const queryHash='a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4';
let retryUntil=0;
const fail=(message:string,status=502,retryAfter?:number)=>Object.assign(Error(message),{status,retryAfter});
/** Anonymous public metadata only. Session tokens remain in memory for this request. */
export async function fetchAnonymousSpotifyPlaylist(id:string,fetcher:typeof fetch=fetch){
 if(!/^[A-Za-z0-9]+$/.test(id))throw fail('Invalid Spotify playlist link.',400);
 if(fetcher===fetch&&Date.now()<retryUntil)throw fail('Spotify is rate limiting public imports. Please wait and try again.',429,Math.ceil((retryUntil-Date.now())/1000));
 const rateLimit=(r:Response)=>{const seconds=Number(r.headers.get('retry-after')),until=Date.parse(r.headers.get('retry-after')||'');const wait=Math.max(60,Number.isFinite(seconds)&&seconds>0?seconds:Number.isFinite(until)?Math.ceil((until-Date.now())/1000):60);if(fetcher===fetch)retryUntil=Date.now()+wait*1000;return fail('Spotify is rate limiting public imports. Please wait and try again.',429,wait);};
 const embed=await fetcher('https://open.spotify.com/embed/playlist/'+id,{signal:AbortSignal.timeout(15000)});
 if(embed.status===429)throw rateLimit(embed);
 if(!embed.ok)throw fail('Spotify could not open that public playlist.',embed.status===404?404:502);
 const html=await embed.text();let data:any;
 try{data=JSON.parse(html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]||'');}catch{throw fail('Spotify’s public playlist data is unavailable. Try again later.');}
 const entity=data?.props?.pageProps?.state?.data?.entity;
 if(entity?.type!=='playlist'||entity?.id!==id)throw fail('This playlist is private or unavailable.',404);
 const token=data?.props?.pageProps?.state?.settings?.session?.accessToken;
 if(typeof token!=='string'||!token)throw fail('Spotify’s public metadata session is unavailable. Try again later.');
 const page=async(offset:number)=>{const url=new URL(endpoint);url.searchParams.set('operationName','fetchPlaylist');url.searchParams.set('variables',JSON.stringify({uri:'spotify:playlist:'+id,offset,limit:100,enableWatchFeedEntrypoint:false}));url.searchParams.set('extensions',JSON.stringify({persistedQuery:{version:1,sha256Hash:queryHash}}));
 const r=await fetcher(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(r.status===429)throw rateLimit(r);
 if(!r.ok)throw fail('Spotify could not read the full public playlist. Try again later.',r.status===401||r.status===403?403:502);
 const result:any=await r.json(),playlist=result?.data?.playlistV2;
 if(result.errors?.length||!Array.isArray(playlist?.content?.items)||!Number.isSafeInteger(playlist.content.totalCount))throw fail('Spotify changed its public metadata response. The full import is unavailable; no partial playlist was imported.');
 return playlist;};
 const first=await page(0),total=first.content.totalCount;if(total<0)throw fail('Spotify returned an invalid playlist count.');
 const offsets=Array.from({length:Math.max(0,Math.ceil(total/100)-1)},(_,i)=>(i+1)*100);
 const rest=await orderedPool(offsets,3,offset=>page(offset));const pages=[first,...rest];
 for(let i=0;i<pages.length;i++)if(pages[i].content.totalCount!==total||pages[i].content.items.length!==Math.min(100,total-i*100))throw fail('The playlist changed or Spotify returned an incomplete page. Please try again.');
 const raw=pages.flatMap(p=>p.content.items),items=raw.flatMap((row:any)=>{const t=row.itemV2?.data||row.item?.data;if(!t?.name||!String(t.__typename||'').includes('Track'))return[];return [{item:{name:t.name,artists:(t.artists?.items||[]).map((a:any)=>({name:a.profile?.name||a.name||a.data?.profile?.name||''})),album:{name:t.albumOfTrack?.name},duration_ms:t.trackDuration?.totalMilliseconds}}];});
 return {name:first.name||entity.title||'Spotify playlist',items:{items},...(raw.length!==items.length?{warning:(raw.length-items.length)+' non-song or unavailable entries were skipped.'}:{})};
}
