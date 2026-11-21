import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { TransferSlots } from '../ytmusic/transferSlots.js';
import { cachedProgressivePrefix, openAudioRange, rememberProgressivePrefix, resolveProgressiveAudio } from './ProgressiveAudio.js';

const prefixSlots = new TransferSlots(2, 8);
const MAX_PREFIX = 768 * 1024;
export const audioCacheGeneration = randomUUID();

// YouTube's progressive AAC representation has a segment index near the start.
// Interpolate within the reference containing the requested time using that reference's
// own byte/time ratio. The following response resumes at the exact byte.
export function indexedPrefixLength(data: Buffer, seconds = 15): number | undefined {
  for (let box = 0; box + 8 <= data.length;) {
    const length = data.readUInt32BE(box);
    if (length < 8 || box + length > data.length) return;
    if (data.toString('ascii', box + 4, box + 8) === 'sidx') {
      const version = data[box + 8];
      const wide = version === 1;
      const countAt = box + (wide ? 38 : 30);
      if (version > 1 || countAt + 2 > box + length) return;
      const scale = data.readUInt32BE(box + 16);
      if (!scale) return;
      const gap = wide ? Number(data.readBigUInt64BE(box + 28)) : data.readUInt32BE(box + 24);
      let offset = box + length + gap;
      let remaining = seconds * scale;
      const count = data.readUInt16BE(countAt);
      if (countAt + 2 + count * 12 > box + length) return;
      for (let i = countAt + 2; i < countAt + 2 + count * 12; i += 12) {
        const size = data.readUInt32BE(i);
        const ticks = data.readUInt32BE(i + 4);
        if (!ticks || !size || size >= 0x80000000) return;
        if (remaining <= ticks) return offset + Math.ceil(size * remaining / ticks);
        offset += size;
        remaining -= ticks;
      }
      return;
    }
    box += length;
  }
}

async function bytes(body: ReadableStream<Uint8Array>, length: number) {
  const reader = body.getReader();
  const result = Buffer.allocUnsafe(length);
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > length) throw new Error('Oversized audio range');
      result.set(value, offset);
      offset += value.length;
    }
    if (offset !== length) throw new Error('Incomplete audio range');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function sendAudioPrefix(req: Request, res: Response, video: string) {
  if (!/^[\w-]{11}$/.test(video)) return res.sendStatus(400);
  const requested = req.query.seconds;
  if (requested !== undefined && requested !== '5' && requested !== '15') return res.sendStatus(400);
  const seconds = requested === '5' ? 5 : 15;
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
  let release: (() => void) | undefined;
  try {
    release = await prefixSlots.acquire(signal);
    const source = await resolveProgressiveAudio(video, signal);
    const { url, size, duration } = source;
    if (source.format !== 'm4a' || !Number.isFinite(duration) || duration <= seconds || size < 2) return res.sendStatus(422);

    const receipt = (length: number, expires: number) => {
      res.set({
        'Cache-Control': 'no-store',
        'X-Audio-Asset': audioCacheGeneration + '.' + video,
        'X-Audio-Prefix-Bytes': String(length),
        'X-Audio-Expires': String(expires),
      }).sendStatus(204);
    };
    const cached = cachedProgressivePrefix(source);
    if (cached) {
      const length = indexedPrefixLength(cached.bytes, seconds);
      if (length && length <= cached.bytes.length) return receipt(length, cached.expires);
    }

    const probe = await openAudioRange(url, 0, Math.min(size - 2, 8191), signal, size);
    let index = await bytes(probe.body, probe.length);
    // Long recordings may have a larger index. Read only as far as that box.
    let end = 0;
    while (end + 8 <= index.length) {
      const length = index.readUInt32BE(end);
      if (length < 8) break;
      const isIndex = index.toString('ascii', end + 4, end + 8) === 'sidx';
      end += length;
      if (isIndex || end > index.length) break;
    }
    if (end > index.length && end <= 192 * 1024 && end < size) {
      const extra = await openAudioRange(url, index.length, end - 1, signal, size);
      index = Buffer.concat([index, await bytes(extra.body, extra.length)]);
    }
    const length = indexedPrefixLength(index, seconds);
    if (!length || length > MAX_PREFIX || length >= size) return res.sendStatus(422);
    let prefix = index.subarray(0, length);
    if (length > index.length) {
      const extra = await openAudioRange(url, index.length, length - 1, signal, size);
      prefix = Buffer.concat([index, await bytes(extra.body, extra.length)]);
    }
    const { expires } = rememberProgressivePrefix(source, prefix);
    receipt(length, expires);
  } catch (error) {
    if (!res.destroyed) res.sendStatus((error as { status?: number }).status === 503 ? 503 : 422);
  } finally {
    release?.();
  }
}
