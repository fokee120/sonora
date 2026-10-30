// Own the server and collect both streams without relying on PowerShell event threads.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const logPath = path.join(root, '.sonora', 'logs', 'server-control.log');
fs.mkdirSync(path.dirname(logPath), { recursive: true });
const log = fs.createWriteStream(logPath, { flags: 'a' });
log.on('error', error => { console.error(`Cannot write server log: ${error.message}`); process.exit(1); });
const server = spawn(process.execPath, [path.join(root, 'scripts', 'start-server.mjs')], {
  cwd: root, env: { ...process.env, NODE_ENV: 'production' }, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
server.on('error', error => { log.end(`\nServer could not start: ${error.message}\n`); process.exitCode = 1; });
server.on('exit', (code, signal) => {
  log.end(`\nServer stopped (code ${code ?? 'unknown'}${signal ? `, ${signal}` : ''}).\n`);
  process.exitCode = code || 0;
});
