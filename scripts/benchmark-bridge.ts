import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { ChromiumBridge } from '../src/server/bridge/ChromiumBridge.js';
import { installMediaFixture } from '../tests/fixtures/bridge-media.js';

const live = process.argv.includes('--live');
const trackArg = process.argv.find(arg => arg.startsWith('--track='))?.slice(8) || process.env.SONORA_BENCH_TRACK;
const iterations = Number(process.argv.find(arg => arg.startsWith('--iterations='))?.slice(13) || 3);
if (live && (!trackArg || !/^[\w-]{11}$/.test(trackArg))) throw new Error('--live requires --track=<11-character video ID> or SONORA_BENCH_TRACK');
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) throw new Error('iterations must be 1..20');
const fixture = live ? undefined : installMediaFixture();
const bridge = new ChromiumBridge();
const records: Record<string, unknown>[] = [];
bridge.on('timing', event => records.push({ diagnostic: event }));
const track = () => trackArg || randomBytes(8).toString('base64url').slice(0, 11);
const nextTrack = process.argv.find(arg => arg.startsWith('--next-track='))?.slice(13);
if (nextTrack && !/^[\w-]{11}$/.test(nextTrack)) throw new Error('Invalid --next-track');

async function measure(label: string, session: string, id: string, start = 0, format: 'webm' | 'mp3' = 'webm') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const began = performance.now();
  const chunks: Buffer[] = [];
  let firstByteMs: number | undefined;
  try {
    for await (const chunk of bridge.play(session, id, controller.signal, format, start)) {
      if (firstByteMs === undefined) firstByteMs = performance.now() - began;
      chunks.push(chunk);
      if (live && performance.now() - began - firstByteMs >= 2500) break;
    }
    if (!chunks.length) throw new Error('No captured bytes');
    const data = Buffer.concat(chunks);
    const decoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', '8000', 'pipe:1'], { input: data, maxBuffer: 16 * 1024 * 1024 });
    if (decoded.error || decoded.status !== 0 || decoded.stdout.length < 4000) throw new Error(`Captured audio did not decode: ${decoded.error || decoded.stderr}`);
    let squares = 0;
    for (let n = 0; n + 4 <= decoded.stdout.length; n += 4) squares += decoded.stdout.readFloatLE(n) ** 2;
    const rms = Math.sqrt(squares / (decoded.stdout.length / 4));
    if (!live && rms < 0.01) throw new Error(`Synthetic capture was silent (RMS ${rms})`);
    const record = { label, firstByteMs: Number(firstByteMs!.toFixed(1)), elapsedMs: Number((performance.now() - began).toFixed(1)), bytes: data.length, decodedSamples: decoded.stdout.length / 4, rms, start, format };
    records.push(record); console.log(JSON.stringify(record));
  } finally { clearTimeout(timeout); controller.abort(); }
}

try {
  // A direct cold request must navigate straight to watch, not home then watch.
  await measure('cold-direct', 'cold', track());
  const began = performance.now();
  await Promise.all([bridge.prepare('warm'), bridge.prepare('warm')]);
  console.log(JSON.stringify({ label: 'prepare-single-flight', elapsedMs: Number((performance.now() - began).toFixed(1)) }));
  for (let i = 0; i < iterations; i++) await measure(`warm-${i + 1}`, 'warm', i > 0 && nextTrack ? nextTrack : track());
  await measure('seek-fresh-container', 'warm', nextTrack || track(), 0.7);
  await measure('mp3', 'warm', nextTrack || track(), 0, 'mp3');
  console.log(JSON.stringify({ mode: live ? 'live' : 'synthetic', fixtureCounts: fixture?.counts, diagnostics: records.filter(item => 'diagnostic' in item) }));
} finally { await bridge.close(); fixture?.restore(); }
