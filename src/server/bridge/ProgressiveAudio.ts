import { pooledSource } from './YtDlpPool.js';

export type ProgressiveAudioSource = {
  url: URL;
  size: number;
  format: 'm4a' | 'mp3';
  duration: number;
  expires: number;
};

type PendingSource = {
  controller: AbortController;
  result: Promise<ProgressiveAudioSource>;
  readers: number;
};

const sources = new Map<string, ProgressiveAudioSource>();
const pending = new Map<string, PendingSource>();
const RANGE_CHUNK = 2 * 1024 * 1024;

const prefixes = new Map<ProgressiveAudioSource, { bytes: Buffer; expires: number }>();
const PREFIX_MEMORY_LIMIT = 8 * 1024 * 1024;
let prefixBytes = 0;

export function rememberProgressivePrefix(source: ProgressiveAudioSource, bytes: Buffer) {
  const previous = cachedProgressivePrefix(source);
  prefixes.delete(source);
  prefixBytes -= previous?.bytes.length ?? 0;
  const entry = {
    bytes: previous && previous.bytes.length > bytes.length ? previous.bytes : bytes,
    expires: Math.min(Date.now() + 15 * 60_000, source.expires),
  };
  prefixes.set(source, entry);
  prefixBytes += entry.bytes.length;
  while (prefixBytes > PREFIX_MEMORY_LIMIT) {
    const oldest = prefixes.entries().next().value;
    if (!oldest) break;
    prefixes.delete(oldest[0]);
    prefixBytes -= oldest[1].bytes.length;
  }
  return entry;
}

export function cachedProgressivePrefix(source: ProgressiveAudioSource) {
  const entry = prefixes.get(source);
  if (!entry) return;
  prefixes.delete(source);
  if (entry.expires <= Date.now()) {
    prefixBytes -= entry.bytes.length;
    return;
  }
  prefixes.set(source, entry);
  return entry;
}

export async function openAudioRange(url: URL, start: number, end: number, signal: AbortSignal, size?: number) {
  const response = await fetch(url, { redirect: 'error', signal, headers: { Range: 'bytes=' + start + '-' + end } });
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
  const total = Number(match?.[3]);
  const last = Math.min(end, total - 1);
  if (response.status !== 206 || !Number.isSafeInteger(total) || total <= start || (size !== undefined && size !== total)
    || Number(match?.[1]) !== start || Number(match?.[2]) !== last || !response.body) {
    await response.body?.cancel();
    throw new Error('Source does not support stable audio ranges');
  }
  return { body: response.body, total, length: last - start + 1 };
}

async function extractAudioSource(video: string, signal: AbortSignal): Promise<ProgressiveAudioSource> {
  const job = await pooledSource(video, 'visionos', signal, true);
  job.stderr.resume();
  let value = '';
  try {
    for await (const chunk of job.stdout) {
      signal.throwIfAborted();
      value += chunk;
      if (value.length > 8192) throw new Error('Invalid audio source');
    }
  } finally {
    if (job.exitCode === null) job.kill();
  }
  signal.throwIfAborted();
  if (job.exitCode !== 0 || !value) throw new Error('Progressive audio is unavailable');

  const { url: raw, duration, size: reportedSize, format } = JSON.parse(value);
  if (format !== 'm4a' && format !== 'mp3') throw new Error('Unsupported progressive audio');
  const url = new URL(raw);
  const expires = Math.min(Number(url.searchParams.get('expire')) * 1000 - 60_000, Date.now() + 5 * 3600_000);
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
    !/^[a-z0-9-]+\.googlevideo\.com$/i.test(url.hostname) ||
    !Number.isFinite(expires) || expires < Date.now() + 60_000) {
    throw new Error('Progressive source could not be validated');
  }
  let size = Number(url.searchParams.get('clen') || reportedSize);
  if (!Number.isSafeInteger(size) || size <= 0) {
    const probe = await openAudioRange(url, 0, 0, signal);
    await probe.body.cancel();
    size = probe.total;
  }
  return { url, size, duration: Number(duration), expires, format };
}

function readResolution(entry: PendingSource, signal: AbortSignal) {
  return new Promise<ProgressiveAudioSource>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    entry.result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** Reuse extraction across a browser's range probes and a simultaneous prefix request. */
export async function resolveProgressiveAudio(video: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!/^[\w-]{11}$/.test(video)) throw new Error('Invalid video ID');
  const saved = sources.get(video);
  if (saved && saved.expires > Date.now()) return saved;

  let entry = pending.get(video);
  if (!entry) {
    if (pending.size >= 12) throw new Error('Audio source lookup is busy');
    const controller = new AbortController();
    const result = extractAudioSource(video, controller.signal).then(source => {
      controller.signal.throwIfAborted();
      sources.delete(video);
      sources.set(video, source);
      if (sources.size > 256) sources.delete(sources.keys().next().value!);
      return source;
    }).finally(() => {
      if (pending.get(video)?.controller === controller) pending.delete(video);
    });
    entry = { controller, result, readers: 0 };
    pending.set(video, entry);
  }

  entry.readers++;
  try {
    return await readResolution(entry, signal);
  } finally {
    entry.readers--;
    if (!entry.readers && pending.get(video) === entry) {
      pending.delete(video);
      entry.controller.abort();
    }
  }
}

export function discardProgressiveAudio(video: string, source: ProgressiveAudioSource) {
  if (sources.get(video) === source) sources.delete(video);
  const entry = prefixes.get(source);
  if (entry) {
    prefixes.delete(source);
    prefixBytes -= entry.bytes.length;
  }
}

/** Read the cached beginning and the exact remainder of the same source file. */
export async function* readProgressiveAudio(source: ProgressiveAudioSource, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  signal.throwIfAborted();
  const cached = cachedProgressivePrefix(source)?.bytes;
  let offset = cached?.length ?? 0;
  if (cached) yield cached;

  while (offset < source.size) {
    const last = Math.min(source.size - 1, offset + RANGE_CHUNK - 1);
    const part = await openAudioRange(source.url, offset, last, signal, source.size);
    const reader = part.body.getReader();
    try {
      let received = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value.length) continue;
        received += value.length;
        if (received > part.length) throw new Error('Oversized audio range');
        yield value;
      }
      if (received !== part.length) throw new Error('Incomplete audio range');
    } finally {
      await reader.cancel().catch(() => {});
    }
    offset = last + 1;
  }
}
