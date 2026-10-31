import { dbService } from '../db.js';
import { ytmSongToTrack, type YtmSongDto } from './youtubeMusic.js';
import type { Track, ViewRoute, Album } from '../../types/index.js';
export type CatalogArtist={browseId:string;name:string;artworkUrl?:string};
export type CatalogAlbum={browseId:string;title:string;artist:string;artistId?:string;artworkUrl?:string;year?:number;kind?:string};
export type CatalogPage={browseId:string;kind:'artist'|'album';title:string;artist:string;artistId?:string;year?:number;description?:string;artworkUrl?:string;songs:YtmSongDto[];albums:CatalogAlbum[];continuation?:string;offline?:boolean};
export const artistRoute=(track:Pick<Track,'artist'|'artistId'>):ViewRoute=>({type:'artist',id:track.artistId?'catalog:'+track.artistId:'name:'+encodeURIComponent(track.artist),name:track.artist});
export const albumRoute=(track:Pick<Track,'album'|'artist'|'artistId'|'albumId'>):ViewRoute=>({type:'album',id:track.albumId?'catalog:'+track.albumId:'name:'+encodeURIComponent(JSON.stringify({title:track.album,artist:track.artist})),title:track.album,artist:track.artist,artistId:track.artistId});
export async function searchCatalog(query:string,filter:'artists'|'albums',signal?:AbortSignal):Promise<{artists:CatalogArtist[];albums:CatalogAlbum[]}>{
 const r=await fetch('/api/ytmusic/search?'+new URLSearchParams({q:query,filter}),{signal});
 const data=await r.json().catch(()=>null);if(!r.ok||!data)throw Error(data?.details||data?.error||'Couldn’t search the catalog. Try again.');
 return {artists:Array.isArray(data.artists)?data.artists:[],albums:Array.isArray(data.albums)?data.albums:[]};
}
const fold=(text:string)=>text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export async function resolveArtist(name:string,signal?:AbortSignal):Promise<string>{
 const key='catalog:artist-name:'+fold(name),saved=await dbService.getSetting<string|null>(key,null);
 if(saved)return saved;
 const result=await searchCatalog(name,'artists',signal);const artist=result.artists.find(a=>fold(a.name)===fold(name));if(!artist)throw Error('No artist page found. Search for the artist by name.');
 await dbService.setSetting(key,artist.browseId);return artist.browseId;
}
export async function resolveAlbum(title:string,artist:string,signal?:AbortSignal):Promise<string>{
 const key='catalog:album-name:'+fold(artist)+':'+fold(title),saved=await dbService.getSetting<string|null>(key,null);
 if(saved)return saved;
 const result=await searchCatalog(title+' '+artist,'albums',signal);
 const album=result.albums.find(a=>fold(a.title)===fold(title)&&(!a.artist||fold(a.artist)===fold(artist)));
 if(!album)throw Error('No album page found. Try searching for the album.');
 await dbService.setSetting(key,album.browseId);return album.browseId;
}
export async function getCatalogPage(id:string,signal?:AbortSignal,continuation?:string):Promise<CatalogPage>{
 const key='catalog:page:'+id+':'+(continuation||''),cached=await dbService.getSetting<CatalogPage|null>(key,null);
 if(!navigator.onLine){if(cached)return {...cached,offline:true};throw Error('Connect to load this page for the first time.');}
 try{
  const r=await fetch('/api/ytmusic/browse/'+encodeURIComponent(id)+(continuation?'?'+new URLSearchParams({continuation}):''),{signal});
  const data=await r.json().catch(()=>null);if(!r.ok||!data?.browseId)throw Error(data?.details||data?.error||'Couldn’t load this catalog page.');
  signal?.throwIfAborted();await dbService.setSetting(key,data);return data;
 }catch(e){if(signal?.aborted)throw e;if(cached)return {...cached,offline:true};throw e;}
}
export function pageTracks(page:CatalogPage):Track[]{return page.songs.map(ytmSongToTrack);}
export function pageAlbum(page:CatalogPage):Album{const tracks=pageTracks(page);return {id:'catalog:'+page.browseId,title:page.title,artist:page.artist,artistId:page.artistId,year:page.year,artworkUrl:page.artworkUrl,trackCount:tracks.length,duration:tracks.reduce((n,t)=>n+t.duration,0),tracks};}
