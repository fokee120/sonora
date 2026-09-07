import type { Track } from '../../types/index.js';
import { fetchDriveAudio } from './audioSource.js';

export async function readDriveDuration(track: Track, signal?: AbortSignal): Promise<number> {
  const [{ tokenizer, parseContentRange }, { parseFromTokenizer }] = await Promise.all([
    import('@tokenizer/range'), import('music-metadata'),
  ]);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let reader: Awaited<ReturnType<typeof tokenizer>> | undefined;
  try {
    reader = await tokenizer({
      // Drive's listing already supplies file size, so no HEAD request is needed.
      getHeadInfo: async () => ({ size: track.sizeBytes, acceptPartialRequests: true }),
      async getResponse(method, range) {
        const response = await fetchDriveAudio(track, {
          method, signal: controller.signal,
          headers: range ? { Range: `bytes=${range[0]}-${range[1]}` } : {},
        });
        const contentRange = response.headers.get('content-range');
        if (range && response.status !== 206) {
          await response.body?.cancel();
          throw new Error('Google Drive did not provide a partial audio response.');
        }
        return {
          size: track.sizeBytes,
          mimeType: response.headers.get('content-type') || undefined,
          acceptPartialRequests: response.status === 206,
          contentRange: contentRange ? parseContentRange(contentRange) : range ? {
            firstBytePosition: range[0],
            lastBytePosition: range[0] + Number(response.headers.get('content-length')) - 1,
            instanceLength: track.sizeBytes,
          } : undefined,
          arrayBuffer: async () => new Uint8Array(await response.arrayBuffer()),
        };
      },
      abort,
    }, { abortSignal: controller.signal, timeoutInSec: 30, minimumChunkSize: 64 * 1024 });
    const metadata = await parseFromTokenizer(reader, { duration: true, skipCovers: true });
    const duration = metadata.format.duration;
    if (!duration || !Number.isFinite(duration)) throw new Error('Duration is not available for this file.');
    return duration;
  } finally {
    await reader?.close();
    clearTimeout(timeout);
    controller.abort();
    signal?.removeEventListener('abort', abort);
  }
}
