import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { FILES_DIR } from './store.js';

export const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'yml', 'yaml', 'xml', 'ini', 'conf', 'log',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs',
  'php', 'rb', 'sh', 'bat', 'ps1', 'sql', 'html', 'htm', 'css', 'scss', 'ipynb', 'r', 'lua', 'kt', 'swift', 'dart',
]);

export const OFFICE_EXTS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods']);
export const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

export function absPathOf(item) {
  return path.join(FILES_DIR, item.relPath);
}

export function isImageExt(ext) {
  return IMAGE_EXTS.has(String(ext || '').toLowerCase());
}

export function isOfficeExt(ext) {
  return OFFICE_EXTS.has(String(ext || '').toLowerCase());
}

export function canSummarize(ext) {
  const value = String(ext || '').toLowerCase();
  return TEXT_EXTS.has(value) || value === 'pdf' || OFFICE_EXTS.has(value) || IMAGE_EXTS.has(value);
}

async function readHead(filePath, bytes = 180000) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function plainFromXml(xml) {
  const text = xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slideNumber(name) {
  const match = /slide(\d+)\.xml$/.exec(name);
  return match ? Number(match[1]) : 0;
}

function officeText(buffer, ext) {
  const allowed = (name) =>
    name === 'word/document.xml' ||
    name === 'content.xml' ||
    name === 'xl/sharedStrings.xml' ||
    /^ppt\/slides\/slide\d+\.xml$/.test(name) ||
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name);

  let entries;
  try {
    entries = unzipSync(new Uint8Array(buffer), {
      filter: (file) => allowed(file.name) && file.originalSize <= 8 * 1024 * 1024,
    });
  } catch {
    throw new Error('无法解析这个 Office 文档，可能已损坏');
  }

  const read = (name) => (entries[name] ? strFromU8(entries[name]) : '');

  if (ext === 'docx') {
    return plainFromXml(read('word/document.xml'));
  }

  if (ext === 'pptx') {
    return Object.keys(entries)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => slideNumber(a) - slideNumber(b))
      .map((name) => {
        const xml = read(name);
        const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
          .map((match) => decodeEntities(match[1]).trim())
          .filter(Boolean);
        return texts.join(' ');
      })
      .filter(Boolean)
      .join('\n');
  }

  if (ext === 'xlsx') {
    const shared = [...read('xl/sharedStrings.xml').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((match) => decodeEntities(match[1]).trim())
      .filter(Boolean);
    const sheets = Object.keys(entries)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .map((name) => read(name))
      .join('\n');
    const inline = [...sheets.matchAll(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/g)]
      .map((match) => decodeEntities(match[1]).trim())
      .filter(Boolean);
    return [...new Set([...shared, ...inline])].join('，');
  }

  return plainFromXml(read('content.xml'));
}

export async function extractText(item) {
  const ext = String(item.ext || '').toLowerCase();
  const filePath = absPathOf(item);
  if (!fs.existsSync(filePath)) throw new Error('文件已丢失，无法读取内容');

  if (TEXT_EXTS.has(ext)) {
    return (await readHead(filePath)).replace(/\u0000/g, '');
  }

  if (ext === 'pdf' || OFFICE_EXTS.has(ext)) {
    const { size } = await fs.promises.stat(filePath);
    if (size > 60 * 1024 * 1024) throw new Error('文件超过 60MB，暂不支持自动总结');
    const buffer = await fs.promises.readFile(filePath);
    if (ext === 'pdf') {
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
      const data = await pdfParse(buffer, { max: 5 });
      return (data.text || '').replace(/\u0000/g, '');
    }
    return officeText(buffer, ext);
  }

  // 未知扩展名：尝试当作文本读取，二进制内容直接放弃
  const head = (await readHead(filePath, 4000)).replace(/\u0000/g, '');
  const control = (head.match(/[\u0000-\u0008\u000e-\u001f]/g) || []).length;
  if (head.trim() && control / Math.max(1, head.length) < 0.01) return head;

  return '';
}
