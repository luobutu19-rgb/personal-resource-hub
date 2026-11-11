import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { FILES_DIR, TMP_DIR, sanitizeSegment } from './store.js';
import { classify } from './classifier.js';

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', avif: 'image/avif',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    cb(null, TMP_DIR);
  },
  filename(req, file, cb) {
    cb(null, `up_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  },
});

export const uploader = multer({
  storage,
  preservePath: true,
  limits: { fileSize: 1024 * 1024 * 1024, files: 200 },
});

export function decodeName(name) {
  const raw = String(name || '');
  if (!/[^\x00-\x7f]/.test(raw)) return raw;
  try {
    const latin = Buffer.from(raw, 'latin1');
    const utf = latin.toString('utf8');
    if (!utf.includes('\uFFFD') && Buffer.from(utf, 'utf8').equals(latin)) return utf;
  } catch {}
  return raw;
}

export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function buildStoredName(dir, title, ext, ignoreName = null) {
  const cleanExt = String(ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let stem = String(title || '').trim();
  if (cleanExt) stem = stem.replace(new RegExp(`\\.${cleanExt}$`, 'i'), '');
  stem = sanitizeSegment(stem, 'file').slice(0, 60) || 'file';

  let name = cleanExt ? `${stem}.${cleanExt}` : stem;
  let index = 2;
  while (fs.existsSync(path.join(dir, name)) && name !== ignoreName) {
    name = cleanExt ? `${stem}-${index}.${cleanExt}` : `${stem}-${index}`;
    index += 1;
  }
  return name;
}

export function guessMime(ext) {
  return MIME_BY_EXT[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

export function moveIntoLibrary(tempPath, fullName, hash, mime) {
  const info = classify(decodeName(fullName));
  const id = `f_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(FILES_DIR, sanitizeSegment(info.topic), info.category);
  fs.mkdirSync(dir, { recursive: true });

  const storedName = buildStoredName(dir, info.title, info.ext);
  const absPath = path.join(dir, storedName);
  fs.renameSync(tempPath, absPath);

  const relPath = path.relative(FILES_DIR, absPath).split(path.sep).join('/');
  const resolvedMime = mime && mime !== 'application/octet-stream' ? mime : guessMime(info.ext);
  const item = {
    id,
    originalName: info.baseName,
    title: info.title,
    storedName,
    relPath,
    topic: info.topic,
    category: info.category,
    tags: info.tags,
    summary: '',
    summaryStatus: 'none',
    ai: { suggested: false },
    size: fs.statSync(absPath).size,
    ext: info.ext,
    mime: resolvedMime,
    hash,
    favorite: false,
    createdAt: new Date().toISOString(),
  };
  return item;
}
