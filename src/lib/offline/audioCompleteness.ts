import type { Track } from '../../types/index.js';

export const INCOMPLETE_AUDIO_MESSAGE = 'This offline audio file is incomplete or shorter than the song. Connect to the internet and retry the download.';

/** Catalog durations can be rounded; allow 2s or 2%, capped at 5s.
 * Only a meaningful shortfall is rejected, not genuinely short songs. */
export function assertAudioDuration(actual: number, expected: number): void {
  if (!Number.isFinite(actual) || actual <= 0) throw new Error('Audio duration could not be verified. Retry the download.');
  if (Number.isFinite(expected) && expected > 0 && actual + Math.min(5, Math.max(2, expected * 0.02)) < expected) {
    throw new Error(INCOMPLETE_AUDIO_MESSAGE);
  }
}

/** Inspect the downloaded bytes, never a client-supplied duration/header alone.
 * Finalized formats use cheap native metadata. MediaRecorder WebM can report
 * Infinity; decode the full blob only in that case (temporary PCM memory). */
export async function readAudioDuration(blob: Blob, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  if (!blob.size) throw new Error('The audio provider returned an empty file.');
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        audio.onloadedmetadata = null;
        audio.onerror = null;
        if (error) reject(error); else resolve(audio.duration);
      };
      const abort = () => finish(new DOMException('Download cancelled', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('Audio verification timed out. Retry the download.')), 15_000);
      audio.onloadedmetadata = () => finish();
      audio.onerror = () => finish(new Error('Downloaded audio could not be decoded. Retry the download.'));
      signal?.addEventListener('abort', abort, { once: true });
      audio.preload = 'metadata';
      audio.src = url;
    });
    signal?.throwIfAborted();
    if (Number.isFinite(duration) && duration > 0) return duration;
  } finally {
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    signal?.throwIfAborted();
    return decoded.duration;
  } finally {
    await context.close();
  }
}

export async function validateAudioBlob(blob: Blob, track: Track, signal?: AbortSignal, response?: Response): Promise<number> {
  const actual = await readAudioDuration(blob, signal);
  assertAudioDuration(actual, track.duration);
  // The backend sets these only on a finalized, independently validated artifact.
  // Cross-check against actual bytes; a success marker cannot bless a 5s prefix.
  if (response?.headers.get('X-Audio-Complete') === 'true') {
    const serverDuration = Number(response.headers.get('X-Audio-Duration'));
    if (!Number.isFinite(serverDuration) || serverDuration <= 0) throw new Error('Audio completion metadata is invalid. Retry the download.');
    assertAudioDuration(actual, serverDuration);
  }
  return actual;
}
