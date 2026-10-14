import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface CaptureReceipt { expectedDuration: number; complete: boolean; transcodeWebm?: boolean; onRecorded?: (position: number, duration: number) => void; onFinalizing?: () => void }
export interface DownloadArtifact { path: string; duration: number; size: number; dispose: () => Promise<void> }

// Bounded diagnostics, subprocess lifetime, and disk usage. Never buffer a track in RAM.
async function ffmpeg(args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args]);
    let output = '', errors = '';
    const abort = () => process.kill('SIGKILL');
    const timeout = setTimeout(abort, 60000);
    signal.addEventListener('abort', abort, { once: true });
    process.stdout.on('data', data => { output = (output + data).slice(-16384); });
    process.stderr.on('data', data => { errors = (errors + data).slice(-4096); });
    process.once('error', reject);
    process.once('close', code => {
      clearTimeout(timeout); signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason);
      else if (code !== 0 || errors.trim()) reject(new Error(`Download finalization/validation failed (${code}): ${errors}`));
      else resolve(output);
    });
    if (signal.aborted) abort();
  });
}

// Reuse full packet decoding for disk-backed direct files without copying them.
export async function finalizeFile(raw: string, path: string, expectedDuration: number, format: 'webm' | 'mp3', signal: AbortSignal, transcodeWebm = false): Promise<{ duration: number; size: number }> {
  if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) throw new Error('Invalid source duration');
  const available = 256 * 1024 * 1024 - (await stat(raw)).size;
  if (available <= 0) throw new Error('Download exceeds 256 MiB disk limit');
  await ffmpeg(['-y', '-xerror', '-i', raw, '-map', '0:a:0', '-vn', ...(format === 'webm' ? (transcodeWebm ? ['-c:a', 'libopus', '-b:a', '128k'] : ['-c:a', 'copy']) : ['-c:a', 'libmp3lame', '-b:a', '128k']), '-fs', String(available), path], signal);
  // Decode all packets. Container duration alone does not prove completeness.
  const progress = await ffmpeg(['-xerror', '-i', path, '-map', '0:a:0', '-progress', 'pipe:1', '-f', 'null', '-'], signal);
  const times = [...progress.matchAll(/out_time_us=(\d+)/g)];
  const duration = Number(times.at(-1)?.[1]) / 1e6;
  const tolerance = Math.max(0.35, Math.min(1, expectedDuration * 0.005));
  if (!Number.isFinite(duration) || Math.abs(duration - expectedDuration) > tolerance) throw new Error(`Incomplete audio duration: decoded ${duration}s; expected ${expectedDuration}s`);
  const size = (await stat(path)).size;
  if (!size) throw new Error('Empty finalized audio download');
  if (size > available) throw new Error('Download exceeds 256 MiB disk limit');
  return { duration, size };
}

export async function finalizeDownload(chunks: AsyncGenerator<Buffer>, receipt: CaptureReceipt, format: 'webm' | 'mp3', signal: AbortSignal): Promise<DownloadArtifact> {
  const root = resolve('.sonora/downloads');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'download-'));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    const raw = join(directory, 'capture.webm'), path = join(directory, `audio.${format}`);
    let bytes = 0;
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > 256 * 1024 * 1024 ? new Error('Download capture exceeds 256 MiB limit') : null, chunk);
    } });
    await pipeline(Readable.from(chunks, { highWaterMark: 1 }), bounded, createWriteStream(raw), { signal });
    signal.throwIfAborted();
    if (!receipt.complete || !Number.isFinite(receipt.expectedDuration) || receipt.expectedDuration <= 0) throw new Error('Incomplete audio capture: source did not reach its expected duration normally');
    receipt.onFinalizing?.();
    const { duration, size } = await finalizeFile(raw, path, receipt.expectedDuration, format, signal, receipt.transcodeWebm);
    return { path, duration, size, dispose };
  } catch (error) {
    await dispose(); throw error;
  } finally {
    await chunks.return(undefined);
  }
}
