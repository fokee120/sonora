import { spawn } from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';

import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { finalizeFile, type DownloadArtifact } from './DownloadArtifact.js';
import type { CaptureProgress } from './DownloadJobs.js';

const LIMIT = 256 * 1024 * 1024;
export function canRefreshDirectSource(error:unknown){const message=error instanceof Error?error.message:'';return !/sign in|private video|members.only|not available in your country|age.restricted|confirm.+bot/i.test(message)&&/unable to download video data:[^\r\n]*HTTP Error (?:403|410)/i.test(message);}
interface Command { executable: string; args: string[] }
export class DirectDownloader {
  constructor(private readonly command?: Command) {}

  async download(videoId: string, signal: AbortSignal, format: 'webm' | 'mp3' = 'webm', onProgress?: (state: CaptureProgress) => void): Promise<DownloadArtifact> {
    if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID');
    signal.throwIfAborted();
    let command = this.command;
    if (!command) {
      const configured = process.env.SONORA_YTDLP_PYTHON;
      const candidates = configured ? [resolve(configured)] : [resolve('.sonora/tools/yt-dlp-env/Scripts/python.exe'), resolve('.sonora/tools/yt-dlp-env/bin/python')];
      for (const executable of candidates) {
        try { await access(executable); command = { executable, args: ['-m', 'yt_dlp'] }; break; } catch { /* try cross-platform environment */ }
      }
      if (!command) throw Object.assign(new Error('Fast download unavailable: install yt-dlp[default] in .sonora/tools/yt-dlp-env or configure SONORA_YTDLP_PYTHON'), { code: 'fast_download_unavailable', status: 503 });
    }
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const timeout = setTimeout(() => controller.abort(new Error('Download exceeded the 10 minute timeout')), 600_000);
    const root = resolve('.sonora/downloads');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'direct-'));
    const report = (phase: CaptureProgress['phase'], downloadedBytes = 0, totalBytes = 0, sourceDuration = 0) => onProgress?.({ phase, progress: totalBytes > 0 ? Math.min(95, Math.floor(downloadedBytes / totalBytes * 95)) : 0, downloadedBytes, totalBytes, recordedSeconds: 0, sourceDuration });
    let downloadedBytes = 0, totalBytes = 0, retained = false;
    try {
      report('preparing');
      const extract = (attempt:number) => new Promise<void>((resolveProcess, reject) => {
        combined.throwIfAborted();
        const child = spawn(command!.executable, [...command!.args, ...(attempt>0?['--no-cache-dir','--no-continue']:[]), '--ignore-config', '--no-playlist', '--js-runtimes', `node:${process.execPath}`, '--socket-timeout', '12', '--retries', '1', '--extractor-retries', '1', '--newline', '--progress', '--progress-template', 'download:SONORA_PROGRESS:%(progress)j', '--write-info-json', '--no-clean-info-json', '--max-filesize', String(LIMIT), '-f', 'bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio', '-o', join(directory, 'source.%(ext)s'), `https://www.youtube.com/watch?v=${videoId}`], { windowsHide: true, shell: false });
        let pending = '', diagnostics = '', failure: Error | undefined, checking = false;
        const kill = () => {
          if (!child.pid) return;
          if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
            killer.on('error', () => child.kill('SIGKILL'));
          } else child.kill('SIGKILL');
        };
        const abort = () => { failure = combined.reason instanceof Error ? combined.reason : new Error('Download cancelled'); kill(); };
        combined.addEventListener('abort', abort, { once: true });
        // Enforce the cap even when the remote server reports an unknown/inaccurate size.
        const diskCheck = setInterval(async () => {
          if (checking) return; checking = true;
          try {
            const entries = await readdir(directory);
            let size = 0;
            for (const name of entries) { try { size += (await stat(join(directory, name))).size; } catch { /* renames during transfer */ } }
            if (size > LIMIT) { failure = new Error('Download exceeds 256 MiB disk limit'); kill(); }
          } catch { /* process cleanup */ } finally { checking = false; }
        }, 100);
        child.stdout.on('data', data => {
          pending += data.toString();
          const lines = pending.split(/\r?\n/); pending = lines.pop()!.slice(-65536);
          for (const line of lines) {
            if (!line.startsWith('SONORA_PROGRESS:')) continue;
            try {
              const progress = JSON.parse(line.slice('SONORA_PROGRESS:'.length));
              const bytes = Number(progress.downloaded_bytes), total = Number(progress.total_bytes ?? progress.total_bytes_estimate);
              if (!Number.isFinite(bytes) || bytes < 0) continue;
              downloadedBytes = bytes; totalBytes = Number.isFinite(total) && total > 0 ? total : 0;
              if (bytes > LIMIT || totalBytes > LIMIT) { failure = new Error('Download exceeds 256 MiB disk limit'); kill(); continue; }
              report('fetching', downloadedBytes, totalBytes);
            } catch { /* non-machine diagnostics are not progress */ }
          }
        });
        child.stderr.on('data', data => { diagnostics = (diagnostics + data.toString()).slice(-4096); });
        const cleanup = () => { clearInterval(diskCheck); combined.removeEventListener('abort', abort); };
        child.once('error', error => { cleanup(); reject(Object.assign(new Error(`Fast download unavailable: ${error.message}`), { code: 'fast_download_unavailable', status: 503 })); });
        child.once('close', code => { cleanup(); if (failure || combined.aborted) reject(failure ?? combined.reason); else if (code !== 0) reject(new Error(`Direct download failed (${code}): ${diagnostics}`)); else resolveProcess(); });
        if (combined.aborted) abort();
      });
      for(let attempt=0;attempt<3;attempt++){
        try{await extract(attempt);break;}
        catch(error){
          combined.throwIfAborted();
          if(attempt===2||!canRefreshDirectSource(error))throw error;
          // Re-extract the same public source instead of retrying its rejected
          // media URL. Never reuse partial bytes or metadata from that attempt.
          for(const name of await readdir(directory))await rm(join(directory,name),{force:true});
          downloadedBytes=0;totalBytes=0;report('preparing');
          await wait(750*(attempt+1),undefined,{signal:combined});
        }
      }
      combined.throwIfAborted();
      const metadataPath = join(directory, 'source.info.json');
      if ((await stat(metadataPath)).size > 8 * 1024 * 1024) throw new Error('Download metadata exceeds limit');
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
      if (metadata.id !== videoId || !Number.isFinite(metadata.duration) || metadata.duration <= 0) throw new Error('Download metadata does not match exact source ID/full duration');
      const files = (await readdir(directory)).filter(name => /^source\.[a-z0-9]+$/i.test(name) && !name.endsWith('.json') && !name.endsWith('.part') && !name.endsWith('.ytdl'));
      if (files.length !== 1) throw new Error('Incomplete direct download: expected one complete source file');
      const path = join(directory, files[0]);
      const size = (await stat(path)).size;
      if (!size || size > LIMIT) throw new Error('Direct source is empty or exceeds 256 MiB');
      report('finalizing', downloadedBytes, totalBytes, metadata.duration);
      const output = join(directory, `audio.${format}`);
      const validated = await finalizeFile(path, output, metadata.duration, format, combined, !files[0].endsWith('.webm'));
      combined.throwIfAborted();
      await rm(path, { force: true });
      await rm(metadataPath, { force: true });
      retained = true;
      return { path: output, ...validated, dispose: () => rm(directory, { recursive: true, force: true }) };
    } finally { clearTimeout(timeout); if (!retained) await rm(directory, { recursive: true, force: true }); }
  }
}
export const directDownloader = new DirectDownloader();
