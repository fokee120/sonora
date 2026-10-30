/**
 * Playlist import by URL: Spotify, YouTube Music, and YouTube.
 *
 * Parsing is pure and fully tested. Fetching is split by source
 * because the sources genuinely differ:
 *  - YouTube Music / YouTube public playlists: fetched from
 *    Sonora's own server (POST /api/import/ytmusic), no extra keys.
 *  - Spotify: fetched from Sonora's own server
 *    (POST /api/import/spotify), after connecting the user's Spotify
 *    account through PKCE. The host needs a client ID and redirect URI.
 *    Without a connection the server answers with a setup message
 *    instead of pretending the import worked.
 *
 * Matching to a playable Sonora track is done afterwards with
 * matchImportedTrack() (see recommendations.ts): a Spotify or
 * YTM entry is only added to a playlist when a YTM catalog
 * search finds a close title/artist match. Everything else is
 * reported as unmatched, never silently swapped for a wrong song.
 */

export type PlaylistSource = 'spotify' | 'ytmusic' | 'youtube' | 'file';

export interface ParsedPlaylistUrl {
  source: PlaylistSource;
  id: string;
}

export interface ImportedTrack {
  videoId?: string;
  artworkUrl?: string;
  title: string;
  artist: string;
  album?: string;
  durationSeconds?: number;
}

export interface ImportedPlaylist {
  source: PlaylistSource;
  sourceId: string;
  title: string;
  description?: string;
  tracks: ImportedTrack[];
  warning?: string;
}

function importedTrackFromRecord(value: any): ImportedTrack | null {
  const title = String(value?.title ?? value?.name ?? value?.track ?? '').trim();
  if (!title) return null;
  const artist = String(value?.artist ?? value?.artistName ?? value?.artists ?? 'Unknown Artist').trim() || 'Unknown Artist';
  const duration = Number(value?.durationSeconds ?? value?.duration ?? 0);
  return { title, artist, album: value?.album ? String(value.album) : undefined, videoId: value?.videoId || value?.youtubeId || undefined, artworkUrl: value?.artworkUrl || value?.thumbnailUrl || value?.thumbnail || undefined, durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined };
}

function parseCsv(text: string): ImportedTrack[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; } else if (ch === ',' && !quoted) { row.push(cell.trim()); cell = ''; } else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const index = (...names: string[]) => names.map(n => headers.indexOf(n)).find(i => i >= 0) ?? -1;
  const title = index('title', 'name', 'track'); const artist = index('artist', 'artistname', 'artists'); const album = index('album'); const videoId = index('videoid', 'youtubeid');
  return rows.slice(1).map(values => importedTrackFromRecord({ title: title >= 0 ? values[title] : values[0], artist: artist >= 0 ? values[artist] : values[1], album: album >= 0 ? values[album] : undefined, videoId: videoId >= 0 ? values[videoId] : undefined })).filter(Boolean) as ImportedTrack[];
}

/** Parse a local JSON/CSV playlist without uploading the file anywhere. */
export async function parsePlaylistFile(file: File): Promise<ImportedPlaylist> {
  const text = await file.text(); const ext = file.name.toLowerCase().split('.').pop();
  let title = file.name.replace(/\.[^.]+$/, '') || 'Imported playlist'; let tracks: ImportedTrack[] = [];
  if (ext === 'csv' || ext === 'tsv') tracks = parseCsv(ext === 'tsv' ? text.replace(/\t/g, ',') : text);
  else {
    const data = JSON.parse(text); const list = Array.isArray(data) ? data : (data.tracks || data.songs || data.items || data.playlist?.tracks || []);
    title = String(data?.title || data?.name || data?.playlist?.title || title);
    tracks = list.map(importedTrackFromRecord).filter(Boolean) as ImportedTrack[];
  }
  if (!tracks.length) throw new Error('No songs were found in that file.');
  const data = ext === 'csv' || ext === 'tsv' ? null : JSON.parse(text);
  return { source: 'file', sourceId: `file:${file.name}:${file.lastModified}`, title, description: data?.description ? String(data.description) : undefined, tracks };
}

export function parsePlaylistUrl(raw: string): ParsedPlaylistUrl | null {
  const value = raw.trim();
  if (!value) return null;

  const spotifyUri = value.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (spotifyUri) return { source: 'spotify', id: spotifyUri[1] };
  const spotifyUrl = value.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/);
  if (spotifyUrl) return { source: 'spotify', id: spotifyUrl[1] };

  try {
    const url = new URL(value);
    const list = url.searchParams.get('list');
    if (list) {
      if (url.hostname.includes('music.youtube.com')) return { source: 'ytmusic', id: list };
      if (url.hostname.includes('youtube.com') || url.hostname === 'youtu.be') {
        return { source: 'youtube', id: list };
      }
    }
  } catch {
    // Not a URL: fall through to the bare-id fallback below.
  }

  // A bare playlist id is treated as a YouTube Music playlist id.
  if (/^[A-Za-z0-9_-]{10,}$/.test(value) && !/\s/.test(value)) {
    return { source: 'ytmusic', id: value };
  }
  return null;
}

function parseDurationToSeconds(text: string): number {
  if (!text) return 0;
  const parts = text.split(':').map((part) => parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

/** Spotify Web API playlist payload -> ImportedPlaylist. */
export function parseSpotifyPlaylistResponse(data: any, sourceId: string): ImportedPlaylist {
  if(Array.isArray(data?.tracks))return {source:'spotify',sourceId,title:String(data.title||data.name||'Spotify playlist'),tracks:data.tracks.filter((t:any)=>typeof t.title==='string'&&t.title.trim()).map((t:any)=>({title:t.title.trim(),artist:String(t.artist||''),...(t.album?{album:String(t.album)}:{})})),...(data.warning?{warning:String(data.warning)}:{})};
  const items: any[] = data?.items?.items || data?.tracks?.items || [];
  const tracks: ImportedTrack[] = items
    .map((item) => item?.item || item?.track)
    .filter(Boolean)
    .map((track) => ({
      title: String(track?.name || '').trim(),
      artist: (track?.artists || []).map((a: any) => a?.name).filter(Boolean).join(', ') || 'Unknown Artist',
      album: track?.album?.name,
      durationSeconds: typeof track?.duration_ms === 'number' ? Math.round(track.duration_ms / 1000) : undefined,
    }))
    .filter((t) => t.title);
  return { source: 'spotify', sourceId, title: String(data?.name || 'Spotify playlist'), tracks, ...(data?.warning ? { warning: String(data.warning) } : {}) };
}

type JsonLike = { [key: string]: any };

function runTexts(node: JsonLike | undefined | null): string[] {
  const runs = node?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (!Array.isArray(runs)) return [];
  return runs.map((run: JsonLike) => String(run?.text ?? '')).filter(Boolean);
}

/** InnerTube browse (playlist shelf) payload -> ImportedPlaylist. */
export function parseYtmPlaylistResponse(data: any, sourceId: string): ImportedPlaylist {
  const tracks: ImportedTrack[] = []; const seen=new Set<string>();
  const watchId=(node:any):string|undefined=>{if(!node||typeof node!=='object')return; if(node.watchEndpoint?.videoId)return node.watchEndpoint.videoId;for(const value of Object.values(node)){const found=watchId(value);if(found)return found;}};
  const visit=(node:any):void=>{if(!node||typeof node!=='object')return;
    const r=node.musicResponsiveListItemRenderer;
    if(r){const columns=r.flexColumns||[];const title=runTexts(columns[0])[0]||'';const secondary=runTexts(columns[1]);const duration=[...secondary,...(r.fixedColumns||[]).flatMap((c:any)=>(c.musicResponsiveListItemFixedColumnRenderer?.text?.runs||[]).map((r:any)=>r.text))].find((v:string)=>/^\d+(:\d{2})+$/.test(v));const videoId=r.playlistItemData?.videoId||watchId(r.overlay)||watchId(r);const key=videoId||title+secondary[0];if(title&&!seen.has(key)){seen.add(key);tracks.push({title,artist:secondary[0]||'Unknown Artist',videoId,artworkUrl:r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url,durationSeconds:duration?parseDurationToSeconds(duration):undefined});}return;}
    const v=node.playlistVideoRenderer;if(v){const title=v.title?.runs?.map((r:any)=>r.text).join('')||v.title?.simpleText; if(title&&v.videoId&&!seen.has(v.videoId)){seen.add(v.videoId);tracks.push({title,artist:v.shortBylineText?.runs?.[0]?.text||'Unknown Artist',videoId:v.videoId,durationSeconds:parseDurationToSeconds(v.lengthText?.simpleText||''),artworkUrl:v.thumbnail?.thumbnails?.slice(-1)[0]?.url});}return;}
    for(const value of Object.values(node))visit(value);
  };visit(data);return {source:'ytmusic',sourceId,title:'YouTube Music playlist',tracks};
}

export async function fetchImportedPlaylist(
  parsed: ParsedPlaylistUrl
): Promise<ImportedPlaylist> {
  const endpoint = parsed.source === 'spotify' ? '/api/import/spotify' : '/api/import/ytmusic';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: parsed.id }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.details || data?.error || `Playlist import failed (${res.status})`);
  }
  if (parsed.source === 'spotify') return parseSpotifyPlaylistResponse(data, parsed.id);
  return { ...(Array.isArray(data?.tracks) ? {source:parsed.source,sourceId:parsed.id,tracks:data.tracks} : parseYtmPlaylistResponse(data?.raw, parsed.id)), title: data?.title || 'YouTube Music playlist' };
}

/** Spotify URL imports expose only title and artist in each JSON song record. */
export function spotifyImportJson(data:any,id:string){const playlist=parseSpotifyPlaylistResponse(data,id);const missing=playlist.tracks.some(t=>!t.artist||t.artist==='Unknown Artist');return {source:'spotify',sourceId:id,title:playlist.title,tracks:playlist.tracks.map(t=>({title:t.title,artist:t.artist==='Unknown Artist'?'':t.artist})),...((playlist.warning||missing)?{warning:[playlist.warning,missing?'Spotify did not provide artist names for some songs; those entries will be matched by title.':''].filter(Boolean).join(' ')}:{})};}
export function importedTrackQuery(entry:ImportedTrack){return [entry.title,entry.artist?.trim()&&entry.artist!=='Unknown Artist'?entry.artist:entry.album].filter(Boolean).join(' ').trim();}
