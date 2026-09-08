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
    format: 'mp3',
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

export async function fetchYoutubeTrack(videoId: string, signal?: AbortSignal): Promise<Track> {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID.');
  const res = await fetch(`/api/ytmusic/track/${encodeURIComponent(videoId)}`, { signal });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.details || data?.error || `Could not read YouTube track (${res.status})`);
  }
  return ytmSongToTrack((await res.json()) as YtmSongDto);
}

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 30;
const searchCache = new Map<string, { expiresAt: number; tracks: Track[] }>();
const inFlightSearches = new Map<string, Promise<Track[]>>();

function searchKey(query: string, filter: YtmFilter): string {
  return `${filter}:${query.trim().toLowerCase()}`;
}

export async function cachedSearchYoutubeMusic(
  query: string,
  filter: YtmFilter = 'songs',
  signal?: AbortSignal
): Promise<Track[]> {
  const key = searchKey(query, filter);
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.tracks;

  const existing = inFlightSearches.get(key);
  if (existing) return existing;

  const request = searchYoutubeMusic(query, filter, signal)
    .then((tracks) => {
      searchCache.set(key, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, tracks });
      while (searchCache.size > SEARCH_CACHE_MAX) {
        const oldest = searchCache.keys().next().value;
        if (!oldest) break;
        searchCache.delete(oldest);
      }
      return tracks;
    })
    .finally(() => {
      if (inFlightSearches.get(key) === request) inFlightSearches.delete(key);
    });

  inFlightSearches.set(key, request);
  return request;
}

export interface YtmStatus {
  searchAvailable: boolean;
  audioBackend: {
    configured: boolean;
    hasApiKey: boolean;
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

async function audioBackendRequest(path: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    throw new Error('Could not connect to Sonora. Check your connection and try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.details || data?.error;
    throw new Error(typeof detail === 'string' ? detail :
      'Sonora audio backend API returned HTTP ' + response.status + '. Check the deployment API routes and function logs.');
  }
  if (!data) throw new Error('Sonora returned a page instead of audio backend JSON. Check the deployment API routes.');
  return data;
}

export interface DownloaderTestResult {
  ok: boolean;
  message: string;
}

export async function testAudioBackend(): Promise<DownloaderTestResult> {
  const data = await audioBackendRequest('/api/ytmusic/audio-backend-test');
  if (typeof data.ok !== 'boolean' || typeof data.message !== 'string') {
    throw new Error('Sonora returned an invalid audio backend test response.');
  }
  return data;
}
