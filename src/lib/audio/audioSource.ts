import type { Track } from '../../types/index.js';
import { getDriveAccessToken } from '../googleAuth.js';
import { isYoutubeTrack, youtubeVideoId } from '../ytmusic/youtubeMusic.js';

export function isDriveTrack(track: Track): boolean {
  return track.id.startsWith('gdrive:') || track.cloudKey.startsWith('gdrive://');
}

export function youtubeStreamUrl(track: Track): string {
  const videoId = youtubeVideoId(track);
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube track. Search for it again.');
  return `/api/ytmusic/stream/${encodeURIComponent(videoId)}`;
}

export function youtubeDownloadUrl(track: Track): string {
  const videoId = youtubeVideoId(track);
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube track. Search for it again.');
  return `/api/ytmusic/download/${encodeURIComponent(videoId)}`;
}

export function driveMediaUrl(track: Track): string {
  const fileId = track.id.startsWith('gdrive:')
    ? track.id.slice(7)
    : track.cloudKey.slice(9).split('/')[0];
  if (!/^[\w-]+$/.test(fileId)) throw new Error('Invalid Google Drive file ID. Rescan your library.');
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
}

export async function responseError(response: Response, fallback: string): Promise<Error> {
  if (response.status === 401) return new Error('Google Drive authorization expired. Disconnect and sign in with Google again.');
  let detail = '';
  try {
    const data = await response.json();
    detail = typeof data.error === 'string' ? data.error : data.error?.message || '';
  } catch {
    // Vercel errors can be plain text rather than JSON.
  }
  return new Error(`${fallback} (${response.status})${detail ? `: ${detail}` : ''}`);
}

export async function fetchDriveAudio(track: Track, options: RequestInit = {}): Promise<Response> {
  const token = getDriveAccessToken();
  if (!token || token === 'server-active-token') {
    throw new Error('Connect Google Drive on this device before playing or downloading.');
  }
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(driveMediaUrl(track), {
    ...options, headers, credentials: 'omit', cache: 'no-store',
  });
  if (!response.ok) throw await responseError(response, 'Google Drive could not read this audio file');
  return response;
}

export async function cloudStreamUrl(track: Track, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`/api/tracks/${encodeURIComponent(track.id)}/stream-url`, { signal });
  if (!response.ok) throw await responseError(response, 'Could not obtain audio');
  const data = await response.json();
  if (!data.streamUrl) throw new Error('No audio URL returned.');
  return data.streamUrl;
}

export async function fetchTrackAudio(track: Track, signal?: AbortSignal): Promise<Response> {
  if (isYoutubeTrack(track)) {
    return fetchYoutubeAudio(track, signal, true);
  }
  if (isDriveTrack(track)) return fetchDriveAudio(track, { signal });
  const response = await fetch(await cloudStreamUrl(track, signal), { signal });
  if (!response.ok) throw await responseError(response, 'Could not download audio');
  return response;
}

/** A single full GET avoids unsupported Range requests while the audio backend transcodes MP3. */
export async function fetchYoutubeAudio(track: Track, signal?: AbortSignal, download = false): Promise<Response> {
  const metadata = new URLSearchParams({ title: track.title, artist: track.artist, duration: String(track.duration || 0) });
  const response = await fetch(`${download ? youtubeDownloadUrl(track) : youtubeStreamUrl(track)}?${metadata}`, {
    signal, cache: 'no-store',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = data?.details || data?.error;
    throw new Error(typeof detail === 'string' ? detail : 'Sonora audio request failed (HTTP ' + response.status + '). Please retry.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (/text\/|application\/(json|xml)/i.test(contentType)) {
    await response.body?.cancel();
    throw new Error('Sonora audio backend returned a page instead of MP3 audio.');
  }
  return response;
}
