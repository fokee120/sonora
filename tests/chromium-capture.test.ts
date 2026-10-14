import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ChromiumBridge } from '../src/server/bridge/ChromiumBridge.js';

// Exercise the actual injected recorder with Chromium, not a mocked capture flag.
const source = await readFile(new URL('../src/server/bridge/ChromiumBridge.ts', import.meta.url), 'utf8');
const script = source.match(/const CAPTURE_SCRIPT = `([\s\S]*?)`;/)![1];

test('captures bytes from a playing audio-only video that is not visible', async () => {
  const browser = await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage();
  const bridge = new ChromiumBridge();
  let bytes = 0;
  await page.exposeFunction('__sonoraSendChunk', (data: number[]) => { bytes += data.length; });
  await page.setContent('<video style="display:none" autoplay></video>');
  await page.evaluate(script);
  await page.evaluate(async () => {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const output = audio.createMediaStreamDestination();
    oscillator.connect(output); oscillator.start();
    const video = document.querySelector('video')!;
    video.srcObject = output.stream;
    await video.play();
    (window as any).__testAudio = audio;
  });
  let timer: ReturnType<typeof setTimeout>;
  const started = performance.now();
  const capture = (bridge as any).ensureCapture(page);
  try {
    await Promise.race([capture, new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Hidden playing video never became capturable')),6000);})]);
    assert.ok(bytes > 0, 'capture readiness must mean actual bytes reached Node');
    const elapsed = performance.now() - started;
    console.log(`synthetic capture first byte: ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 1500, 'capture must be byte-driven, not a fixed two-second wait');
    await page.evaluate(() => {
      const w = window as any;
      const previous = w.__sonoraRecorder;
      w.__sonoraStartCapture(2);
      previous.onstop?.();
      if (!w.__sonoraRecording) throw new Error('stale stop cleared replacement recorder');
      const media = document.querySelector('video')!;
      media.pause();
      const play = media.play.bind(media);
      // Some remote players never settle play() even while media starts flowing.
      media.play = () => { void play(); return new Promise<void>(() => {}); };
    });
    let blockedTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([(bridge as any).ensureCapture(page), new Promise((_, reject) => { blockedTimer = setTimeout(() => reject(new Error('capture blocked on unbounded media.play promise')), 1500); })]);
    } finally { clearTimeout(blockedTimer); }
  } finally {
    clearTimeout(timer!);
    await browser.close();
    await capture.catch(()=>{});
  }
});
