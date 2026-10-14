import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const environment = join(root, '.sonora', 'tools', 'yt-dlp-env');
const python = join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
if (!existsSync(python)) run('uv', ['venv', environment]);
run('uv', ['pip', 'install', '--python', python, '--upgrade', 'yt-dlp[default]']);
run(python, ['-m', 'yt_dlp', '--version']);
console.log('Direct downloader ready. Keep ffmpeg and Node on PATH.');
