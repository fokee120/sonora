import type { Track } from '../../types/index.js';
import { readWebmDuration } from './webmDuration.js';

export const INCOMPLETE_AUDIO_MESSAGE = 'This offline audio file is incomplete or shorter than the song. Connect to the internet and retry the download.';

/** Catalog durations can be rounded; allow 2s or 2%, capped at 5s. */
export function assertAudioDuration(actual: number, expected: number): void {
  if (!Number.isFinite(actual) || actual <= 0) throw new Error('Audio duration could not be verified. Retry the download.');
  if (Number.isFinite(expected) && expected > 0 && actual + Math.min(5, Math.max(2, expected * 0.02)) < expected) {
    throw new Error(INCOMPLETE_AUDIO_MESSAGE);
  }
}

/** Parse bytes without creating a media element or AudioContext. Both can take
 * over iOS's native Now Playing session, even without playing any audio. */
export async function readAudioDuration(blob: Blob, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  if (!blob.size) throw new Error('The audio provider returned an empty file.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal?.throwIfAborted();
  let duration: number | undefined;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // MediaRecorder WebM often has no duration field. Measure its actual blocks,
    // including the final Opus packet, rather than trusting the catalog/header.
    duration = readWebmDuration(bytes);
  } else {
    const { parseBuffer } = await import('music-metadata');
    const metadata = await parseBuffer(bytes, undefined, { duration: true, skipCovers: true });
    duration = metadata.format.duration;
  }
  signal?.throwIfAborted();
  assertAudioDuration(duration ?? 0, 0);
  return duration!;
}

export async function validateAudioBlob(blob: Blob, track: Track, signal?: AbortSignal, response?: Response): Promise<number> {
  const actual = await readAudioDuration(blob, signal);
  assertAudioDuration(actual, track.duration);
  if (response?.headers.get('X-Audio-Complete') === 'true') {
    const serverDuration = Number(response.headers.get('X-Audio-Duration'));
    if (!Number.isFinite(serverDuration) || serverDuration <= 0) throw new Error('Audio completion metadata is invalid. Retry the download.');
    assertAudioDuration(actual, serverDuration);
  }
  return actual;
}
