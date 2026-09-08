import express from 'express';
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const VALID_YT_VIDEO_ID = /^[\w-]{11}$/;
const MAX_CONCURRENT = Math.max(1, Number(process.env.AUDIO_MAX_CONCURRENT || 2));
const REQUEST_TIMEOUT_MS = Math.max(30000, Number(process.env.AUDIO_REQUEST_TIMEOUT_MS || 300000));
const AUDIO_BITRATE = process.env.AUDIO_BITRATE || '128K';
const API_KEY = process.env.SONORA_AUDIO_API_KEY || process.env.AUDIO_SERVICE_API_KEY || '';
const COOKIES_FILE = process.env.YOUTUBE_COOKIES_FILE || '';
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG_LOCATION = process.env.FFMPEG_LOCATION || '';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const BGUTIL_SERVER_HOME = process.env.BGUTIL_SERVER_HOME || '';

let activeRequests = 0;

function redact(text) {
  if (!text) return '';
  let safe = text.replaceAll(COOKIES_FILE, '[cookies-file]');
  if (API_KEY) safe = safe.replaceAll(API_KEY, '[api-key]');
  return safe.slice(-4000);
}

function classifyYtdlpError(stderr) {
  const text = stderr.toLowerCase();
  if (text.includes('sign in to confirm') || text.includes('not a bot') || text.includes('login required')) {
    return ['youtube_login_required', 'YouTube requested authentication for this video.'];
  }
  if (text.includes('video unavailable') || text.includes('private video') || text.includes('removed')) {
    return ['video_unavailable', 'This YouTube video is unavailable.'];
  }
  if (text.includes('too many requests') || text.includes('rate-limit') || text.includes('rate limited') || text.includes('429')) {
    return ['rate_limited', 'YouTube rate limited the audio service.'];
  }
  if (text.includes('ffmpeg') || text.includes('conversion')) {
    return ['conversion_failed', 'Audio conversion to MP3 failed.'];
  }
  return ['extractor_failed', 'yt-dlp could not extract audio for this video.'];
}

function classifyConversionError(stderr) {
  const text = stderr.toLowerCase();
  if (text.includes('audio_timeout')) return ['audio_timeout', 'Audio extraction timed out.'];
  return ['conversion_failed', 'Audio conversion to MP3 failed.'];
}

function killProcess(child, signal = 'SIGTERM') {
  if (child && !child.killed) child.kill(signal);
}

function forceKillProcess(child) {
  killProcess(child, 'SIGTERM');
  setTimeout(() => killProcess(child, 'SIGKILL'), 5000).unref?.();
}

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expected = Buffer.from(createHash('sha256').update(API_KEY).digest('hex'));
  const actual = Buffer.from(createHash('sha256').update(token).digest('hex'));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Audio service API key is required.' });
  }
  next();
}

function spawnLogged(command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, output: error?.message || String(error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ ok: false, output: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, output: (stdout || stderr).trim() }));
  });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/diagnostics', requireApiKey, async (req, res) => {
  const [ytdlp, ffmpeg] = await Promise.all([
    spawnLogged(YTDLP_BIN, ['--version']),
    spawnLogged(FFMPEG_LOCATION || FFMPEG_BIN, ['-version']),
  ]);
  res.json({
    status: 'ok',
    activeRequests,
    maxConcurrent: MAX_CONCURRENT,
    ytdlp: ytdlp.ok ? ytdlp.output.split(/\r?\n/)[0] : null,
    ffmpeg: ffmpeg.ok ? ffmpeg.output.split(/\r?\n/)[0] : null,
    cookiesConfigured: Boolean(COOKIES_FILE && existsSync(COOKIES_FILE)),
  });
});

app.get('/audio/:videoId', requireApiKey, async (req, res) => {
  const { videoId } = req.params;
  if (!VALID_YT_VIDEO_ID.test(videoId)) {
    return res.status(400).json({ error: 'invalid_video_id', message: 'Invalid YouTube video ID.' });
  }
  if (activeRequests >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'audio_service_busy', message: 'Audio service is at capacity. Try again shortly.' });
  }

  activeRequests += 1;
  let bytesSent = 0;
  let ytdlpStderr = '';
  let ffmpegStderr = '';
  let closed = false;
  const ytdlpArgs = [
    '--no-playlist',
    '--no-progress',
    '--newline',
    '-f', 'bestaudio',
    '-o', '-',
  ];
  if (BGUTIL_SERVER_HOME && existsSync(BGUTIL_SERVER_HOME)) {
    ytdlpArgs.push('--extractor-args', `youtubepot-bgutilscript:server_home=${BGUTIL_SERVER_HOME}`);
  }
  if (COOKIES_FILE && existsSync(COOKIES_FILE)) ytdlpArgs.push('--cookies', COOKIES_FILE);
  ytdlpArgs.push(`https://www.youtube.com/watch?v=${videoId}`);

  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-i', 'pipe:0',
    '-vn',
    '-codec:a', 'libmp3lame',
    '-b:a', AUDIO_BITRATE,
    '-f', 'mp3',
    'pipe:1',
  ];

  let ytdlp;
  let ffmpeg;
  try {
    ytdlp = spawn(YTDLP_BIN, ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    ffmpeg = spawn(FFMPEG_LOCATION || FFMPEG_BIN, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    activeRequests -= 1;
    forceKillProcess(ytdlp);
    forceKillProcess(ffmpeg);
    return res.status(502).json({ error: 'extractor_failed', message: 'yt-dlp or ffmpeg could not be started.' });
  }
  const timeout = setTimeout(() => {
    ytdlpStderr += '\naudio_timeout';
    ffmpegStderr += '\naudio_timeout';
    forceKillProcess(ytdlp);
    forceKillProcess(ffmpeg);
  }, REQUEST_TIMEOUT_MS);

  const abort = () => {
    closed = true;
    forceKillProcess(ytdlp);
    forceKillProcess(ffmpeg);
  };
  req.on('close', abort);
  res.on('close', abort);
  ytdlp.stderr.on('data', (chunk) => { ytdlpStderr += chunk.toString(); });
  ffmpeg.stderr.on('data', (chunk) => { ffmpegStderr += chunk.toString(); });
  ytdlp.on('error', (error) => {
    ytdlpStderr += `\n${error?.message || String(error)}`;
  });
  ffmpeg.on('error', (error) => {
    ffmpegStderr += `\n${error?.message || String(error)}`;
  });
  const ytdlpClosed = new Promise((resolve) => {
    ytdlp.once('error', () => resolve(1));
    ytdlp.once('close', (code) => resolve(code));
  });
  const ffmpegClosed = new Promise((resolve) => {
    ffmpeg.once('error', () => resolve(1));
    ffmpeg.once('close', (code) => resolve(code));
  });

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdin.on('error', () => {});
  ytdlpClosed.then((code) => {
    if (code !== 0) forceKillProcess(ffmpeg);
  });
  ffmpegClosed.then((code) => {
    if (code !== 0) forceKillProcess(ytdlp);
  });

  try {
    const iterator = ffmpeg.stdout[Symbol.asyncIterator]();
    const first = await Promise.race([
      iterator.next(),
      ffmpegClosed.then((code) => ({ done: true, code, process: 'ffmpeg' })),
    ]);
    if (first.done || !first.value?.length) {
      const timeoutHit = ytdlpStderr.includes('audio_timeout') || ffmpegStderr.includes('audio_timeout');
      const [error, message] = timeoutHit
        ? ['audio_timeout', 'Audio extraction timed out.']
        : first.process === 'ffmpeg'
          ? classifyConversionError(ffmpegStderr)
          : classifyYtdlpError(ytdlpStderr);
      return res.status(error === 'audio_timeout' ? 504 : 502).json({ error, message });
    }

    async function* audioChunks() {
      bytesSent += first.value.length;
      yield first.value;
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        const chunk = next.value;
        bytesSent += chunk.length;
        yield chunk;
      }
    }

    res.status(200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(audioChunks(), res);
    const [ytdlpCode, ffmpegCode] = await Promise.all([ytdlpClosed, ffmpegClosed]);
    if (ytdlpCode !== 0) {
      console.warn(`yt-dlp exited with ${ytdlpCode} after streaming started:`, redact(ytdlpStderr));
    }
    if (ffmpegCode !== 0) {
      console.warn(`ffmpeg exited with ${ffmpegCode} after streaming started:`, redact(ffmpegStderr));
    }
  } catch (error) {
    if (!closed && bytesSent === 0 && !res.headersSent) {
      const combined = `${ytdlpStderr}\n${ffmpegStderr}\n${error?.message || String(error)}`;
      const [code, message] = ffmpegStderr ? classifyConversionError(combined) : classifyYtdlpError(combined);
      return res.status(502).json({ error: code, message });
    }
    if (!closed) console.warn('Audio pipeline failed:', redact(error?.message || String(error)));
  } finally {
    clearTimeout(timeout);
    req.off('close', abort);
    res.off('close', abort);
    activeRequests -= 1;
    forceKillProcess(ytdlp);
    forceKillProcess(ffmpeg);
  }
});

Promise.all([
  spawnLogged(YTDLP_BIN, ['--version']),
  spawnLogged(FFMPEG_LOCATION || FFMPEG_BIN, ['-version']),
]).then(([ytdlp, ffmpeg]) => {
  console.log(`Sonora Audio Service listening on :${PORT}`);
  console.log(`yt-dlp: ${ytdlp.ok ? ytdlp.output.split(/\r?\n/)[0] : 'unavailable'}`);
  console.log(`ffmpeg: ${ffmpeg.ok ? ffmpeg.output.split(/\r?\n/)[0] : 'unavailable'}`);
  console.log(`cookies: ${COOKIES_FILE && existsSync(COOKIES_FILE) ? 'configured' : 'not configured'}`);
});

app.listen(PORT, '0.0.0.0');
