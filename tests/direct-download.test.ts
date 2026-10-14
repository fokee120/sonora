
for (const mode of ['incomplete', 'malformed']) test(`direct ${mode} source fails validation and cleans disk`, async () => {
  const f = await fixture(mode);
  const before = (await readdir('.sonora/downloads')).filter(name => name.startsWith('direct-'));
  try {
    await assert.rejects(f.downloader.download(id(), new AbortController().signal), /Incomplete audio duration|validation failed/);
    assert.deepEqual((await readdir('.sonora/downloads')).filter(name => name.startsWith('direct-')), before);
  } finally { await f.dispose(); }
});
test('cancellation terminates finite CLI process and cleans partial files', async () => {
  const f = await fixture('hang'), controller = new AbortController();
  const before = (await readdir('.sonora/downloads')).filter(name => name.startsWith('direct-'));
  try {
    const result = f.downloader.download(id(), controller.signal, 'webm', state => { if (state.phase === 'fetching') controller.abort(); });
    await assert.rejects(result, /abort|cancel/i);
    assert.deepEqual((await readdir('.sonora/downloads')).filter(name => name.startsWith('direct-')), before);
  } finally { await f.dispose(); }
});
test('missing executable is explicitly unavailable, never invokes capture fallback', async () => {
  const previous = process.env.SONORA_YTDLP_PYTHON;
  process.env.SONORA_YTDLP_PYTHON = resolve('.sonora/absent-python');
  try { await assert.rejects(new DirectDownloader().download(id(), new AbortController().signal), (error: any) => error.code === 'fast_download_unavailable' && error.status === 503); }
  finally { if (previous === undefined) delete process.env.SONORA_YTDLP_PYTHON; else process.env.SONORA_YTDLP_PYTHON = previous; }
});
test('direct provider rejects URL input instead of allowing arbitrary sources', async () => {
  await assert.rejects(new DirectDownloader().download('https://example.org', new AbortController().signal), /Invalid YouTube video ID/);
});


test('download route uses direct provider with full headers, scoped progress, and no browser session mutation', async () => {
  const { default: app } = await import('../src/server/ytmusic/api.js');
  const { directDownloader } = await import('../src/server/bridge/DirectDownloader.js');
  const { chromiumBridge } = await import('../src/server/bridge/ChromiumBridge.js');
  const original = directDownloader.download, capture = chromiumBridge.download;
  const f = await fixture();
  directDownloader.download = f.downloader.download.bind(f.downloader);
  chromiumBridge.download = async () => { throw new Error('Capture must not be invoked'); };
  const count = chromiumBridge.sessionCount;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const requestId = '99999999-9999-4999-8999-999999999999';
    const response = await fetch(`${base}/api/ytmusic/download/${id()}?session=direct-test&requestId=${requestId}&title=Fixture`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-audio-via'), 'sonora-direct-download');
    assert.equal(response.headers.get('x-audio-complete'), 'true');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="Fixture.webm"');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(Number(response.headers.get('content-length')), (await response.arrayBuffer()).byteLength);
    const state = await (await fetch(`${base}/api/ytmusic/download-status/${requestId}?session=direct-test`)).json();
    assert.ok(state.downloadedBytes > 0 && state.totalBytes > 0);
    assert.equal(state.recordedSeconds, 0);
    assert.equal((await fetch(`${base}/api/ytmusic/download-status/${requestId}?session=other`)).status, 404);
    assert.equal(chromiumBridge.sessionCount, count);
    assert.equal((await fetch(`${base}/api/ytmusic/download/${id()}?start=1`)).status, 400);
  } finally {
    directDownloader.download = original; chromiumBridge.download = capture;
    await new Promise<void>(resolve => server.close(() => resolve())); await f.dispose();
  }
});

test('AAC m4a fallback is converted into independently decoded full WebM', async () => {
  const f = await fixture('m4a');
  try {
    const file = await f.downloader.download(id(), new AbortController().signal);
    try {
      const metadata = await parseBuffer(await readFile(file.path), { mimeType: 'audio/webm' }, { duration: true });
      assert.ok(Math.abs(metadata.format.duration! - 2) < 0.15);
      assert.match(metadata.format.codec!, /opus/i);
    } finally { await file.dispose(); }
  } finally { await f.dispose(); }
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import { DirectDownloader } from '../src/server/bridge/DirectDownloader.js';

const id = () => randomBytes(8).toString('base64url').slice(0, 11);
async function fixture(mode = 'complete') {
  const root = await mkdtemp(resolve('.sonora/downloads-fixture-'));
  const extension = mode === 'm4a' ? 'm4a' : 'webm';
  const media = join(root, `tone.${extension}`);
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', mode === 'm4a' ? 'aac' : 'libopus', media]);
  assert.equal(generated.status, 0, generated.stderr.toString());
  const script = join(root, 'cli.cjs');
  await writeFile(script, `const fs=require('node:fs'),path=require('node:path'); const args=process.argv.slice(2); const target=args[args.indexOf('-o')+1].replace('%(ext)s',${JSON.stringify(extension)}); const id=new URL(args.at(-1)).searchParams.get('v');
  fs.copyFileSync(${JSON.stringify(media)},target); const size=fs.statSync(target).size;
  console.log('SONORA_PROGRESS:'+JSON.stringify({downloaded_bytes:Math.floor(size/2),total_bytes:size}));
  setTimeout(()=>{fs.writeFileSync(target.replace(/\\.(webm|m4a)$/,'.info.json'),JSON.stringify({id,duration:${mode === 'incomplete' ? 20 : 2}})); console.log('SONORA_PROGRESS:'+JSON.stringify({downloaded_bytes:size,total_bytes:size})); ${mode === 'malformed' ? "fs.writeFileSync(target,'invalid media');" : ''}},150);
  ${mode === 'hang' ? "setInterval(()=>{},1000);" : ''}`);
  return { downloader: new DirectDownloader({ executable: process.execPath, args: [script] }), dispose: () => rm(root, { recursive: true, force: true }) };
}

test('direct subprocess reports source bytes and produces independently decoded seekable full audio', async () => {
  const f = await fixture(); const progress: any[] = [];
  try {
    const file = await f.downloader.download(id(), new AbortController().signal, 'webm', state => progress.push(state));
    try {
      const metadata = await parseBuffer(await readFile(file.path), { mimeType: 'audio/webm' }, { duration: true });
      assert.ok(Math.abs(metadata.format.duration! - 2) < 0.1);
      assert.ok(Math.abs(file.duration - 2) < 0.1);
      const fetching = progress.filter(p => p.phase === 'fetching');
      assert.ok(fetching.some(p => p.downloadedBytes > 0 && p.progress > 0 && p.progress < 95));
      assert.ok(fetching.every(p => p.progress <= 95 && p.totalBytes > 0 && p.recordedSeconds === 0));
      assert.equal(progress.at(-1).phase, 'finalizing');
    } finally { await file.dispose(); }
  } finally { await f.dispose(); }
});
