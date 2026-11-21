import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TransferSlots } from '../ytmusic/transferSlots.js';
import { prepareRangedMp3, type PreparedMp3 } from './DirectStream.js';

const MAX_FLIGHTS = 24;
const STARTUP_BYTES = 128 * 1024;
const RECENT_BYTES = 512 * 1024;
const CHUNK_SIZE = 64 * 1024;

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

class Mp3Body {
  private readonly beginning: Buffer;
  private readonly recent: Buffer;
  private readonly encoded: AsyncGenerator<Buffer>;
  private written = 0;
  private reading?: Promise<void>;

  constructor(
    readonly size: number,
    encoded: AsyncGenerator<Buffer>,
    private readonly encode: (signal: AbortSignal) => AsyncGenerator<Buffer>,
  ) {
    this.beginning = Buffer.allocUnsafe(Math.min(size, STARTUP_BYTES));
    this.recent = Buffer.allocUnsafe(Math.min(size, RECENT_BYTES));
    this.encoded = encoded;
  }

  get complete() { return this.written === this.size; }

  private pull() {
    return this.reading ??= this.readMore().finally(() => { this.reading = undefined; });
  }

  private async readMore() {
    const chunk = await this.encoded.next();
    const next = this.written + (chunk.value?.length ?? 0);
    if (chunk.done || next > this.size) throw new Error('MP3 byte length did not match the ranged file');
    if (next === this.size && !(await this.encoded.next()).done) {
      throw new Error('MP3 encoder produced extra bytes');
    }
    const bytes = chunk.value;
    if (this.written < this.beginning.length) bytes.copy(this.beginning, this.written);
    const keep = bytes.subarray(Math.max(0, bytes.length - this.recent.length));
    const slot = (next - keep.length) % this.recent.length;
    const toEnd = Math.min(keep.length, this.recent.length - slot);
    keep.copy(this.recent, slot, 0, toEnd);
    if (toEnd < keep.length) keep.copy(this.recent, 0, toEnd);
    this.written = next;
  }

  private async *replay(first: number, last: number, signal: AbortSignal) {
    let produced = 0;
    // A seek behind the retained window can reconstruct the same bytes from
    // the same source and encoder settings. No full-song spool is required.
    for await (const chunk of this.encode(signal)) {
      signal.throwIfAborted();
      const next = produced + chunk.length;
      if (next > this.size) throw new Error('MP3 byte length changed while seeking');
      if (next > first) {
        yield chunk.subarray(Math.max(0, first - produced), Math.min(chunk.length, last + 1 - produced));
      }
      if (next > last) return;
      produced = next;
    }
    throw new Error('Incomplete MP3 seek');
  }

  async *read(first: number, last: number, signal: AbortSignal): AsyncGenerator<Buffer> {
    for (let position = first; position <= last;) {
      signal.throwIfAborted();
      if (position >= this.written) {
        await untilAborted(this.pull(), signal);
        continue;
      }
      const count = Math.min(last - position + 1, this.written - position, CHUNK_SIZE);
      if (position < this.beginning.length) {
        const end = Math.min(position + count, this.beginning.length);
        yield this.beginning.subarray(position, end);
        position = end;
      } else if (position >= this.written - this.recent.length) {
        const slot = position % this.recent.length;
        const length = Math.min(count, this.recent.length - slot);
        // The encoder may overwrite this ring slot while the socket is writing.
        yield Buffer.from(this.recent.subarray(slot, slot + length));
        position += length;
      } else {
        yield* this.replay(position, last, signal);
        return;
      }
    }
  }

  close() { void this.encoded.return(undefined).catch(() => {}); }
}

function selectRange(header: string | undefined, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header || '');
  if (!match || (!match[1] && !match[2])) return { first: 0, last: size - 1, partial: false };
  const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const last = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (first > last || !Number.isSafeInteger(first)) return;
  return { first, last, partial: true };
}

type Flight = {
  controller: AbortController;
  ready: Promise<Mp3Body | undefined>;
  body?: Mp3Body;
  readers: number;
  idle?: ReturnType<typeof setTimeout>;
  committed: boolean;
};

/** A media probe and its follow-up reads share one demand-driven MP3 encoder. */
export class Mp3Ranges {
  private readonly flights = new Map<string, Flight>();
  // A backward seek can reread evicted bytes while active streams hold their slots.
  private readonly seekSlots = new TransferSlots(1, MAX_FLIGHTS);

  constructor(
    private readonly slots: TransferSlots,
    private readonly prepare = prepareRangedMp3,
    private readonly idleMs = 12_000,
  ) {}

  private drop(key: string, flight: Flight) {
    if (this.flights.get(key) !== flight) return;
    this.flights.delete(key);
    clearTimeout(flight.idle);
    flight.controller.abort();
    flight.body?.close();
  }

  private async *transcode(plan: PreparedMp3, signal: AbortSignal, slots = this.slots) {
    const release = await slots.acquire(signal);
    try { yield* plan.stream(signal); }
    finally { release(); }
  }

  private async open(videoId: string, start: number, flight: Flight) {
    const signal = flight.controller.signal;
    const plan = await this.prepare(videoId, start, signal);
    signal.throwIfAborted();
    if (!plan || !Number.isSafeInteger(plan.size) || plan.size <= 0) return;
    const body = new Mp3Body(plan.size, this.transcode(plan, signal),
      reader => this.transcode(plan, AbortSignal.any([signal, reader]), this.seekSlots));
    flight.body = body;
    return body;
  }

  async serve(
    key: string, videoId: string, start: number, req: Request, res: Response, signal: AbortSignal,
    firstByte: () => void,
  ): Promise<boolean> {
    let flight = this.flights.get(key);
    if (!flight) {
      if (this.flights.size >= MAX_FLIGHTS) {
        const idle = [...this.flights].find(([, existing]) => !existing.readers);
        if (!idle) return false;
        this.drop(...idle);
      }
      const created: Flight = {
        controller: new AbortController(), readers: 0, committed: false, ready: Promise.resolve(undefined),
      };
      this.flights.set(key, created);
      created.ready = this.open(videoId, start, created).catch(() => undefined);
      flight = created;
    }
    clearTimeout(flight.idle);
    flight.readers++;

    try {
      const body = await untilAborted(flight.ready, signal);
      if (!body) return false;
      const selection = selectRange(req.method === 'GET' && !req.headers['if-range'] ? req.headers.range : undefined, body.size);
      if (!selection) {
        res.status(416).set('Content-Range', 'bytes */' + body.size).end();
        return true;
      }
      const { first, last, partial } = selection;
      const headers = () => {
        flight.committed = true;
        res.status(partial ? 206 : 200).set({
          'Accept-Ranges': 'bytes',
          'Content-Length': String(last - first + 1),
          'Cache-Control': 'no-store, no-transform',
          'X-Accel-Buffering': 'no',
        });
        if (partial) res.set('Content-Range', 'bytes ' + first + '-' + last + '/' + body.size);
        res.socket?.setNoDelay(true);
      };
      if (req.method === 'HEAD') {
        headers();
        res.end();
        return true;
      }

      const read = body.read(first, last, signal);
      try {
        // Keep the regular MP3 route available if the source fails before any
        // range or length has been published for this playback URL.
        const initial = await read.next();
        if (initial.done) throw new Error('Empty MP3 range');
        headers();
        firstByte();
        if (initial.value.length === last - first + 1) {
          res.end(initial.value);
        } else {
          async function* chunks() {
            yield initial.value;
            yield* read;
          }
          await pipeline(Readable.from(chunks(), { objectMode: false }), res, { signal });
        }
        return true;
      } finally {
        await read.return(undefined);
      }
    } catch (error) {
      signal.throwIfAborted();
      const committed = flight.committed || res.headersSent;
      this.drop(key, flight);
      if (committed) throw error;
      return false;
    } finally {
      flight.readers--;
      if (!flight.readers && this.flights.get(key) === flight) {
        const entry = flight;
        // Release a blocked encoder promptly when the listener skips a song.
        const idle = entry.body?.complete ? this.idleMs * 5
          : signal.aborted ? Math.min(1_500, this.idleMs) : this.idleMs;
        flight.idle = setTimeout(() => this.drop(key, entry), idle).unref();
      }
    }
  }
}
