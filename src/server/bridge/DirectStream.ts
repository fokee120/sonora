import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  discardProgressiveAudio, readProgressiveAudio, resolveProgressiveAudio, type ProgressiveAudioSource,
} from './ProgressiveAudio.js';
import { pooledSource } from './YtDlpPool.js';

const MP3_SAMPLE_RATE = 48_000;
const MP3_FRAME_SAMPLES = 1_152;
// MPEG-1 Layer III at 128 kbit/s and 48 kHz uses 384 bytes per frame.
const MP3_FRAME_BYTES = 384;

type FixedLength = { samples: number; startSample: number };
export type PreparedMp3 = { size: number; stream: (signal: AbortSignal) => AsyncGenerator<Buffer> };

async function* encodeMp3(
  input: Readable, controller: AbortController, signal: AbortSignal, start: number,
  original?: ProgressiveAudioSource['format'], fixed?: FixedLength,
): AsyncGenerator<Buffer> {
  const filter = fixed ? [
    'aresample=' + MP3_SAMPLE_RATE,
    'atrim=start_sample=' + fixed.startSample,
    'apad=whole_len=' + fixed.samples,
    'atrim=end_sample=' + fixed.samples,
    'asetpts=PTS-STARTPTS',
  ].join(',') : undefined;
  const encoder = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-probesize', '32768', '-analyzeduration', '500000',
    ...(original ? ['-f', original === 'm4a' ? 'mov' : 'mp3'] : []),
    '-i', 'pipe:0', ...(start && !fixed ? ['-ss', String(start)] : []), '-map', '0:a:0', '-vn',
    ...(filter ? ['-af', filter, '-ar', String(MP3_SAMPLE_RATE), '-ac', '2'] : []),
    '-c:a', original === 'mp3' ? 'copy' : 'libmp3lame',
    ...(original === 'mp3' ? [] : ['-b:a', '128k']),
    '-f', 'mp3', '-write_xing', '0', '-id3v2_version', '0', '-flush_packets', '1', 'pipe:1',
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let diagnostics = '';
  encoder.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4096); });
  encoder.on('error', error => encoder.stdout.destroy(error));
  const exited = new Promise<number | null>(resolve => { encoder.once('close', resolve); });
  let inputFailure: unknown;
  const transfer = pipeline(input, encoder.stdin, { signal }).catch(error => {
    // A trimmed encoder may finish before the last input packet. Its exact
    // output length and exit code are still verified for the range response.
    if (fixed && !signal.aborted && ['EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error?.code)) return;
    inputFailure = error;
    encoder.stdout.destroy(error);
  });
  const abort = () => encoder.stdout.destroy(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) abort();
    let received = false;
    for await (const chunk of encoder.stdout) {
      received = true;
      yield chunk;
    }
    await transfer;
    if (inputFailure) throw inputFailure;
    if ((await exited) !== 0 || !received) throw new Error('MP3 encoding failed: ' + diagnostics.trim());
  } finally {
    signal.removeEventListener('abort', abort);
    controller.abort();
    if (encoder.exitCode === null && encoder.signalCode === null) encoder.kill();
    await transfer;
    await exited;
  }
}

function mp3InformationFrame(first: Buffer, frames: number, size: number) {
  if (first.length < 4 || first.readUIntBE(0, 3) !== 0xfffb94 || (first[3] & 0xc0) === 0xc0) {
    throw new Error('Unexpected MP3 frame format');
  }
  const info = Buffer.alloc(MP3_FRAME_BYTES);
  first.copy(info, 0, 0, 4);
  // The 32-byte MPEG-1 stereo side information is followed by the Info tag.
  info.write('Info', 36, 'ascii');
  info.writeUInt32BE(3, 40); // Frame count and total bytes are present.
  info.writeUInt32BE(frames, 44);
  info.writeUInt32BE(size, 48);
  return info;
}

export async function prepareRangedMp3(videoId: string, start: number, signal: AbortSignal): Promise<PreparedMp3 | undefined> {
  const source = await resolveProgressiveAudio(videoId, AbortSignal.any([signal, AbortSignal.timeout(5_000)]));
  if (source.format === 'mp3') {
    if (start !== 0) return;
    return { size: source.size, async *stream(signal) {
      for await (const chunk of readProgressiveAudio(source, signal)) yield Buffer.from(chunk);
    } };
  }

  // Use the duration of this specific audio representation. The rounded song
  // duration from search results is unsuitable for an exact byte range.
  const duration = Number(source.url.searchParams.get('dur'));
  if (!Number.isFinite(duration) || duration <= start) return;
  const startSample = Math.round(start * MP3_SAMPLE_RATE);
  const samples = Math.round(duration * MP3_SAMPLE_RATE) - startSample;
  if (!Number.isSafeInteger(samples) || samples <= 0) return;
  // LAME emits a delay frame in addition to the frames needed for these samples.
  const frames = Math.ceil(samples / MP3_FRAME_SAMPLES) + 1;
  const size = (frames + 1) * MP3_FRAME_BYTES;
  if (size > 0xffffffff) return;

  return { size, async *stream(signal) {
    const controller = new AbortController();
    const active = AbortSignal.any([signal, controller.signal]);
    const deadline = setTimeout(() => controller.abort(new Error('MP3 encoder startup timed out')), 4_500);
    let first = true;
    const input = Readable.from(readProgressiveAudio(source, active), { objectMode: false });
    try {
      for await (const chunk of encodeMp3(input, controller, active, 0, 'm4a', { samples, startSample })) {
        if (first) {
          const info = mp3InformationFrame(chunk, frames, size);
          first = false;
          clearTimeout(deadline);
          yield info;
        }
        yield chunk;
      }
    } catch (error) {
      if (!signal.aborted && first) discardProgressiveAudio(videoId, source);
      throw error;
    } finally {
      clearTimeout(deadline);
      controller.abort();
    }
  } };
}

export async function* directStream(videoId: string, signal: AbortSignal, start = 0, trace = 'untraced'): AsyncGenerator<Buffer> {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid video ID');
  const started = Date.now();
  const timing = (event: string, source: string) => {
    if (process.env.SONORA_DEBUG_PLAYBACK !== 'true') return;
    console.log('[playback timing]', JSON.stringify({ side: 'extractor', trace, event, source, elapsedMs: Date.now() - started }));
  };

  for (const mode of ['progressive', 'visionos', 'default'] as const) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const attempt = AbortSignal.any([signal, controller.signal]);
    const deadline = setTimeout(() => controller.abort(new Error('MP3 stream startup timed out')), mode === 'progressive' ? 5_000 : 12_000);
    let emitted = false;
    let resolved: ProgressiveAudioSource | undefined;
    try {
      let output: AsyncIterable<Uint8Array>;
      let verifySource: (() => void) | undefined;
      if (mode === 'progressive') {
        resolved = await resolveProgressiveAudio(videoId, attempt);
        timing('source_resolved', resolved.format);
        const bytes = readProgressiveAudio(resolved, attempt);
        output = resolved.format === 'mp3' && start === 0 ? bytes
          : encodeMp3(Readable.from(bytes, { objectMode: false }), controller, attempt, start, resolved.format);
      } else {
        const job = await pooledSource(videoId, mode === 'default' ? undefined : mode, attempt);
        job.stderr.resume();
        output = encodeMp3(job.stdout, controller, attempt, start);
        verifySource = () => { if (job.exitCode !== 0) throw new Error('YouTube audio transfer failed'); };
      }

      for await (const chunk of output) {
        attempt.throwIfAborted();
        if (!chunk.length) continue;
        if (!emitted) {
          clearTimeout(deadline);
          timing('mp3_first_byte', mode);
          emitted = true;
        }
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
      verifySource?.();
      if (!emitted) throw new Error('Empty MP3 stream');
      return;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (resolved && !emitted) discardProgressiveAudio(videoId, resolved);
      if (emitted || mode === 'default') throw error;
      timing('source_fallback', mode);
    } finally {
      clearTimeout(deadline);
      controller.abort();
    }
  }
}
