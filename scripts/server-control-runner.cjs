// Run the server in the same process as the tray launcher entry point.
const { Console } = require('node:console');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const logPath = path.join(root, '.sonora', 'logs', 'server-control.log');
fs.mkdirSync(path.dirname(logPath), { recursive: true });
const log = fs.createWriteStream(logPath, { flags: 'a' });
log.on('error', error => {
  process.stderr.write(`Cannot write server log: ${error.message}\n`);
  process.exit(1);
});
global.console = new Console({ stdout: log, stderr: log, colorMode: false });
process.on('uncaughtExceptionMonitor', error => {
  try { fs.appendFileSync(logPath, `${error.stack || error}\n`); } catch {}
});
import('./start-server.mjs');
