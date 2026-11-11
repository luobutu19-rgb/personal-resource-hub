import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const log = fs.createWriteStream(path.join(LOG_DIR, 'server.log'), { flags: 'a' });

const stamp = () => new Date().toLocaleString('zh-CN', { hour12: false });

function start() {
  log.write(`\n[${stamp()}] 启动服务\n`);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => log.write(chunk));
  child.stderr.on('data', (chunk) => log.write(chunk));
  child.on('exit', (code, signal) => {
    log.write(`[${stamp()}] 服务退出 code=${code} signal=${signal}，3 秒后重启\n`);
    setTimeout(start, 3000);
  });
}

start();
