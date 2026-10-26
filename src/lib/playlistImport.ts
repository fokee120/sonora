/**
 * Playlist import by URL: Spotify, YouTube Music, and YouTube.
 *
 * Parsing is pure and fully tested. Fetching is split by source
 * because the sources genuinely differ:
 *  - YouTube Music / YouTube public playlists: fetched from
 *    Sonora's own server (POST /api/import/ytmusic), no extra keys.
 *  - Spotify: fetched from Sonora's own server
 *    (POST /api/import/spotify), which needs a Spotify app's
 *    SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET on the host.
 *    Without them the server answers 501 with a setup message
 *    instead of pretending the import worked.
 *
 * Matching to a playable Sonora track is done afterwards with
 * matchImportedTrack() (see recommendations.ts): a Spotify or
 * YTM entry is only added to a playlist when a YTM catalog
 * search finds a close title/artist match. Everything else is
 * reported as unmatched, never silently swapped for a wrong song.
 */

export type PlaylistSource = 'spotify' | 'ytmusic' | 'youtube';

export interface ParsedPlaylistUrl {
  source: PlaylistSource;
  id: string;
}

export interface ImportedTrack {
  title: string;
  artist: string;
  album?: string;
  durationSeconds?: number;
}

export interface ImportedPlaylist {
  source: PlaylistSource;
  sourceId: string;
  title: string;
  tracks: ImportedTrack[];
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
  const items: any[] = data?.tracks?.items || [];
  const tracks: ImportedTrack[] = items
    .map((item) => item?.track)
    .filter(Boolean)
    .map((track) => ({
      title: String(track?.name || '').trim(),
      artist: (track?.artists || []).map((a: any) => a?.name).filter(Boolean).join(', ') || 'Unknown Artist',
      album: track?.album?.name,
      durationSeconds: typeof track?.duration_ms === 'number' ? Math.round(track.duration_ms / 1000) : undefined,
    }))
    .filter((t) => t.title);
  return { source: 'spotify', sourceId, title: String(data?.name || 'Spotify playlist'), tracks };
}

type JsonLike = { [key: string]: any };

function runTexts(node: JsonLike | undefined | null): string[] {
  const runs = node?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (!Array.isArray(runs)) return [];
  return runs.map((run: JsonLike) => String(run?.text ?? '')).filter(Boolean);
}

/** InnerTube browse (playlist shelf) payload -> ImportedPlaylist. */
export function parseYtmPlaylistResponse(data: any, sourceId: string): ImportedPlaylist {
  const tracks: ImportedTrack[] = [];
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.musicPlaylistShelfRenderer && Array.isArray(node.musicPlaylistShelfRenderer.contents)) {
      for (const item of node.musicPlaylistShelfRenderer.contents) {
        const renderer = item?.musicResponsiveListItemRenderer;
        if (!renderer) continue;
        const columns: JsonLike[] = renderer?.flexColumns ?? [];
        const title = runTexts(columns[0])[0] || '';
        const second = runTexts(columns[1]);
        const durationText = second.find((t) => /^\d+(:\d{2})+$/.test(t));
        if (!title) continue;
        tracks.push({
          title,
          artist: second[0] || 'Unknown Artist',
          durationSeconds: durationText ? parseDurationToSeconds(durationText) : undefined,
        });
      }
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(data);
  return { source: 'ytmusic', sourceId, title: 'YouTube Music playlist', tracks };
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
  return { ...parseYtmPlaylistResponse(data?.raw, parsed.id), title: data?.title || 'YouTube Music playlist' };
}
