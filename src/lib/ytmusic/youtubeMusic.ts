/**
 * Client-side YouTube Music helpers.
 *
 * Converts server search results into app-native Track objects
 * (ids shaped `ytm:<videoId>`) so the existing player, queue,
 * favorites, playlists and OfflineManager work unchanged.
 */

import { Track } from '../../types/index.js';

export type YtmFilter = 'songs' | 'videos' | 'albums' | 'artists';

export interface YtmSongDto {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  durationSeconds: number;
  durationText?: string;
  thumbnailUrl?: string;
  isVideo?: boolean;
}

export function isYoutubeTrack(track: Track): boolean {
  return (
    track.source === 'ytmusic' ||
    track.id.startsWith('ytm:') ||
    track.cloudKey.startsWith('ytmusic://')
  );
}

export function youtubeVideoId(track: Track): string {
  if (track.sourceId) return track.sourceId;
  if (track.id.startsWith('ytm:')) return track.id.slice(4);
  if (track.cloudKey.startsWith('ytmusic://')) {
    return track.cloudKey.slice('ytmusic://'.length);
  }
  return '';
}

/** Convert a YT Music catalog entry into a first-class Track. */
export function ytmSongToTrack(song: YtmSongDto): Track {
  return {
    id: `ytm:${song.videoId}`,
    title: song.title || 'Unknown Title',
    artist: song.artist || 'Unknown Artist',
    album: song.album || (song.isVideo ? 'YouTube Video' : 'YouTube Music'),
    duration: song.durationSeconds || 0,
    artworkUrl: song.thumbnailUrl,
    cloudKey: `ytmusic://${song.videoId}`,
    format: 'm4a',
    source: 'ytmusic',
    sourceId: song.videoId,
  };
}

export async function searchYoutubeMusic(
  query: string,
  filter: YtmFilter = 'songs',
  signal?: AbortSignal
): Promise<Track[]> {
  const params = new URLSearchParams({ q: query, filter });
  const res = await fetch(`/api/ytmusic/search?${params.toString()}`, { signal });

  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.details || data?.error || '';
    } catch {
      // non-JSON error body
    }
    throw new Error(detail || `YouTube Music search failed (${res.status})`);
  }

  const data = (await res.json()) as { songs?: YtmSongDto[] };
  return (data.songs || []).map(ytmSongToTrack);
}

export interface YtmStatus {
  searchAvailable: boolean;
  downloader: {
    enabled: boolean;
    configured: boolean;
    hasApiKey: boolean;
    audioFormat: string;
    url: string | null;
  };
}

export async function fetchYoutubeMusicStatus(signal?: AbortSignal): Promise<YtmStatus | null> {
  try {
    const res = await fetch('/api/ytmusic/status', { signal });
    if (!res.ok) return null;
    return (await res.json()) as YtmStatus;
  } catch {
    return null;
  }
}

async function downloaderRequest(path: string, body?: unknown): Promise<any> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Could not connect to Sonora. Check your connection and try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.details || data?.error;
    throw new Error(typeof detail === 'string' ? detail :
      'Sonora downloader API returned HTTP ' + response.status + '. Check the deployment API routes and function logs.');
  }
  if (!data) throw new Error('Sonora returned a page instead of downloader JSON. Check the deployment API routes.');
  return data;
}

export async function saveDownloaderConfig(config: {
  enabled?: boolean;
  url?: string;
  apiKey?: string;
  audioFormat?: string;
}): Promise<YtmStatus['downloader']> {
  const data = await downloaderRequest('/api/ytmusic/downloader-config', config);
  if (!data.downloader) throw new Error('Sonora returned an invalid downloader configuration response.');
  return data.downloader;
}

export interface DownloaderTestResult {
  ok: boolean;
  message: string;
}

export async function testDownloader(): Promise<DownloaderTestResult> {
  const data = await downloaderRequest('/api/ytmusic/downloader-test');
  if (typeof data.ok !== 'boolean' || typeof data.message !== 'string') {
    throw new Error('Sonora returned an invalid downloader test response.');
  }
  return data;
}
