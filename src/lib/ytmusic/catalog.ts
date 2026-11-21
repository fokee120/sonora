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
const CATALOG_FRESH_MS = 5 * 60_000;
const MAX_RECENT_ENTRIES = 64;
type StoredCatalogPage = CatalogPage & { cachedAt?: number };
const recentPages = new Map<string, StoredCatalogPage>();
const resolvedIds = new Map<string, string>();

const artistKey = (name: string) => 'catalog:artist-name:' + fold(name);
const albumKey = (title: string, artist: string) => 'catalog:album-name:' + fold(artist) + ':' + fold(title);
const pageKey = (id: string, continuation?: string) => 'catalog:page:' + id + ':' + (continuation || '');
const isFresh = (page: StoredCatalogPage) => Date.now() - (page.cachedAt ?? 0) < CATALOG_FRESH_MS;

function remember<K, V>(cache: Map<K, V>, key: K, value: V) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_RECENT_ENTRIES) cache.delete(cache.keys().next().value!);
}

async function findCatalogId(key: string, lookup: () => Promise<string>) {
  const id = resolvedIds.get(key) ?? await dbService.getSetting<string | null>(key, null);
  if (id) {
    remember(resolvedIds, key, id);
    return id;
  }
  const found = await lookup();
  await dbService.setSetting(key, found);
  remember(resolvedIds, key, found);
  return found;
}

export function resolveArtist(name: string, signal?: AbortSignal): Promise<string> {
  return findCatalogId(artistKey(name), async () => {
    const result = await searchCatalog(name, 'artists', signal);
    const artist = result.artists.find(item => fold(item.name) === fold(name));
    if (!artist) throw Error('No artist page found. Search for the artist by name.');
    return artist.browseId;
  });
}

export function resolveAlbum(title: string, artist: string, signal?: AbortSignal): Promise<string> {
  return findCatalogId(albumKey(title, artist), async () => {
    const result = await searchCatalog(title + ' ' + artist, 'albums', signal);
    const album = result.albums.find(item => fold(item.title) === fold(title) && (!item.artist || fold(item.artist) === fold(artist)));
    if (!album) throw Error('No album page found. Try searching for the album.');
    return album.browseId;
  });
}

function recentPage(key: string) {
  const page = recentPages.get(key);
  return page && isFresh(page) ? page : undefined;
}

export function mergeCatalogPages(current: CatalogPage, next: CatalogPage): CatalogPage {
  return {
    ...current,
    songs: [...new Map([...current.songs, ...next.songs].map(song => [song.videoId, song])).values()],
    albums: [...new Map([...current.albums, ...next.albums].map(album => [album.browseId, album])).values()],
    continuation: next.continuation,
  };
}

function readRecentDetail(routeId: string, lookupKey: string): CatalogPage | null {
  const id = routeId.startsWith('catalog:') ? routeId.slice(8) : resolvedIds.get(lookupKey);
  if (!id) return null;
  let page: CatalogPage | undefined = recentPage(pageKey(id));
  if (!page) return null;

  // Restore the continuation pages the listener already loaded during this visit.
  const seen = new Set<string>();
  while (page.continuation && !seen.has(page.continuation)) {
    const next = recentPage(pageKey(id, page.continuation));
    if (!next) break;
    seen.add(page.continuation);
    page = mergeCatalogPages(page, next);
  }
  return page;
}

export const getRecentArtistPage = (id: string, name: string) => readRecentDetail(id, artistKey(name));
export const getRecentAlbumPage = (id: string, title: string, artist: string) => readRecentDetail(id, albumKey(title, artist));

export async function getCatalogPage(id: string, signal?: AbortSignal, continuation?: string): Promise<CatalogPage> {
  signal?.throwIfAborted();
  const key = pageKey(id, continuation);
  const cached = recentPages.get(key) ?? await dbService.getSetting<StoredCatalogPage | null>(key, null);
  signal?.throwIfAborted();
  if (cached && isFresh(cached)) {
    remember(recentPages, key, cached);
    return navigator.onLine ? cached : { ...cached, offline: true };
  }
  if (!navigator.onLine) {
    if (cached) return { ...cached, offline: true };
    throw Error('Connect to load this page for the first time.');
  }
  try {
    const suffix = continuation ? '?' + new URLSearchParams({ continuation }) : '';
    const response = await fetch('/api/ytmusic/browse/' + encodeURIComponent(id) + suffix, { signal });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.browseId || !Array.isArray(data.songs) || !Array.isArray(data.albums)) {
      throw Error(data?.details || data?.error || 'Couldn’t load this catalog page.');
    }
    signal?.throwIfAborted();
    const entry = { ...data, cachedAt: Date.now() };
    remember(recentPages, key, entry);
    await dbService.setSetting(key, entry).catch(() => {});
    signal?.throwIfAborted();
    return entry;
  } catch (error) {
    if (signal?.aborted || !cached) throw error;
    return { ...cached, offline: true };
  }
}
export function pageTracks(page:CatalogPage):Track[]{return page.songs.map(ytmSongToTrack);}
export function pageAlbum(page:CatalogPage):Album{const tracks=pageTracks(page);return {id:'catalog:'+page.browseId,title:page.title,artist:page.artist,artistId:page.artistId,year:page.year,artworkUrl:page.artworkUrl,trackCount:tracks.length,duration:tracks.reduce((n,t)=>n+t.duration,0),tracks};}
