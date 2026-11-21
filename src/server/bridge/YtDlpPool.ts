import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { TransferSlots } from '../ytmusic/transferSlots.js';

const WORKER_LIMIT = 3;
const IDLE_TIMEOUT_MS = 30_000;
const slots = new TransferSlots(WORKER_LIMIT, 24);

class Job extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  pid: undefined = undefined;

  constructor(readonly cancel: () => void) { super(); }

  kill(_signal?: string) {
    this.cancel();
    return true;
  }
}

type Worker = {
  process: ChildProcessWithoutNullStreams;
  stop: () => void;
  job?: Job;
  idle?: NodeJS.Timeout;
  stopping: boolean;
  busy: boolean;
};

const workers = new Set<Worker>();
let pythonPromise: Promise<string> | undefined;
let keepPlaybackWarm = false;

function python() {
  return pythonPromise ??= (async () => {
    const paths = process.env.SONORA_YTDLP_PYTHON
      ? [process.env.SONORA_YTDLP_PYTHON]
      : ['.sonora/tools/yt-dlp-env/Scripts/python.exe', '.sonora/tools/yt-dlp-env/bin/python'];
    for (const path of paths) {
      const file = resolve(path);
      try { await access(file); return file; } catch {}
    }
    throw new Error('yt-dlp unavailable');
  })().catch(error => {
    pythonPromise = undefined;
    throw error;
  });
}

function idle(worker: Worker) {
  worker.busy = false;
  if (worker.stopping) return;
  worker.idle = setTimeout(() => {
    if (keepPlaybackWarm && ![...workers].some(other => other !== worker && !other.stopping)) return;
    worker.stopping = true;
    // EOF shuts down both Python and its Windows virtual-environment launcher.
    worker.process.stdin.end();
  }, IDLE_TIMEOUT_MS).unref();
}

async function createWorker(signal: AbortSignal): Promise<Worker> {
  const executable = await python();
  signal.throwIfAborted();
  const child = spawn(executable, ['-u', resolve('src/server/bridge/ytDlpWorker.py'), process.execPath], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let terminating = false;
  const stop = () => {
    if (terminating) return;
    terminating = true;
    worker.stopping = true;
    child.stdout.resume();
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore',
      });
      killer.on('error', () => child.kill('SIGKILL'));
    } else {
      child.kill('SIGKILL');
    }
  };
  const worker: Worker = { process: child, stop, stopping: false, busy: true };
  workers.add(worker);

  let readyResolve!: () => void;
  let readyReject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let pending = Buffer.alloc(0);
  let blocked = false;

  const finish = (code: number) => {
    const job = worker.job;
    if (!job) return;
    worker.job = undefined;
    idle(worker);
    job.exitCode = code;
    job.stdout.end();
    job.stderr.end();
    job.emit('close', code);
  };
  const fail = (error: Error) => {
    readyReject(error);
    worker.job?.stderr.write(error.message);
    stop();
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('close', () => {
    worker.stopping = true;
    clearTimeout(worker.idle);
    workers.delete(worker);
    readyReject(new Error('yt-dlp worker exited'));
    const interrupted = !!worker.job;
    finish(1);
    if (keepPlaybackWarm && interrupted) void warmPlaybackWorker();
  });
  child.stderr.on('data', data => worker.job?.stderr.write(data));

  const parse = () => {
    while (!blocked && !worker.stopping && pending.length >= 5) {
      const length = pending.readUInt32BE(1);
      if (length > 1024 * 1024) return fail(new Error('Invalid worker frame'));
      if (pending.length < 5 + length) return;
      const type = pending[0];
      const payload = pending.subarray(5, 5 + length);
      pending = pending.subarray(5 + length);
      if (type === 82) readyResolve(); // R: ready
      if (type === 76) worker.job?.stderr.write(payload); // L: log
      if (type === 69) { // E: exit
        let code: number;
        try { code = JSON.parse(payload.toString()).code; } catch { code = 1; }
        finish(code);
      }
      if (type === 68 && worker.job && !worker.job.stdout.write(payload)) { // D: data
        blocked = true;
        child.stdout.pause();
        worker.job.stdout.once('drain', () => {
          blocked = false;
          parse();
          if (!blocked) child.stdout.resume();
        });
      }
    }
  };
  child.stdout.on('data', data => {
    if (worker.stopping) return;
    pending = pending.length ? Buffer.concat([pending, data]) : data;
    parse();
  });

  const abort = () => { readyReject(signal.reason); stop(); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => fail(new Error('Worker initialization timed out')), 15_000).unref();
  try {
    await ready;
    return worker;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

let warmup: Promise<void> | undefined;

/** Keep one resolver ready for the next play request without opening a media connection. */
export function warmPlaybackWorker() {
  keepPlaybackWarm = true;
  if (warmup) return warmup;
  if ([...workers].some(worker => !worker.stopping)) return Promise.resolve();
  const signal = AbortSignal.timeout(15_000);
  warmup = (async () => {
    const release = await slots.acquire(signal);
    try {
      if (![...workers].some(worker => !worker.stopping)) idle(await createWorker(signal));
    } finally {
      release();
    }
  })().catch(() => {
    // A missing worker dependency is handled when playback is requested.
  }).finally(() => { warmup = undefined; });
  return warmup;
}

export async function pooledSource(videoId: string, client: string | undefined, signal: AbortSignal, resolveAudio = false) {
  const release = await slots.acquire(signal);
  let worker: Worker | undefined;
  try {
    signal.throwIfAborted();
    for (const candidate of workers) {
      if (candidate.busy || candidate.stopping) continue;
      worker = candidate;
      worker.busy = true;
      clearTimeout(worker.idle);
      break;
    }
    worker ??= await createWorker(signal);
    signal.throwIfAborted();
  } catch (error) {
    if (worker) idle(worker);
    release();
    throw error;
  }

  const assigned = worker;
  const job = new Job(() => { if (job.exitCode === null) assigned.stop(); });
  assigned.job = job;
  const abort = () => job.kill();
  signal.addEventListener('abort', abort, { once: true });
  job.once('close', () => {
    signal.removeEventListener('abort', abort);
    release();
  });
  setImmediate(() => {
    if (job.exitCode !== null) return;
    if (signal.aborted) return job.kill();
    job.emit('spawn');
    assigned.process.stdin.write(JSON.stringify({ videoId, client, node: process.execPath, resolveAudio }) + '\n');
  });
  if (process.env.SONORA_DEBUG_PLAYBACK === 'true') {
    console.log('[yt-dlp pool] job assigned', { pid: assigned.process.pid, client: client || 'default' });
  }
  return job;
}
