import express from 'express';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { router } from './routes.js';
import { init } from './store.js';
import { initCards } from './cards.js';
import { initExams } from './exams.js';
import { initMistakes } from './mistakes.js';
import { initHistory } from './history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

init();
initCards();
initExams();
initMistakes();
initHistory();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: ['text/plain', 'text/*'], limit: '1mb' }));
app.use('/api', router);

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      if (/\.(?:html|css|js)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  }
  next();
});

app.use((req, res) => {
  res.status(404).json({ error: '页面不存在' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '单个文件不能超过 1GB' });
  }
  if (err?.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ error: '一次最多上传 200 个文件' });
  }
  const status = err?.status || 500;
  if (status >= 500) console.error('[server]', err);
  res.status(status).json({ error: err?.message || '服务器内部错误' });
});

function lanAddresses() {
  const result = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address);
    }
  }
  const unique = [...new Set(result)];
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return unique.sort((a, b) => rank(a) - rank(b));
}

function printBanner(port) {
  const local = `http://localhost:${port}`;
  const lan = lanAddresses();
  const phone = lan[0] ? `http://${lan[0]}:${port}` : null;

  console.log('\n  ┌─────────────────────────────────────────────┐');
  console.log('  │  我的资源站已启动                            │');
  console.log('  └─────────────────────────────────────────────┘\n');
  console.log(`  电脑访问   ${local}`);
  if (phone) {
    console.log(`  手机访问   ${phone}   （手机与电脑连同一个 Wi-Fi）`);
  } else {
    console.log('  手机访问   未检测到局域网 IP，请确认电脑已联网');
  }
  console.log('  数据目录   data/   （备份时直接复制这个文件夹）');
  console.log('  停止服务   按 Ctrl + C\n');

  if (phone) {
    console.log('  用 iPhone 相机或微信扫这个二维码：\n');
    qrcode.generate(phone, { small: true }, (code) => console.log(code));
  }
}

function start(port, attemptsLeft = 20) {
  const server = app.listen(port, '0.0.0.0');
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  端口 ${port} 已被占用，尝试 ${port + 1} …`);
      start(port + 1, attemptsLeft - 1);
      return;
    }
    console.error('启动失败：', err.message);
    process.exit(1);
  });
  server.once('listening', () => printBanner(port));
}

start(Number(process.env.PORT) || 5178);
