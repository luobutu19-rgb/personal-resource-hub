import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from './classifier.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const emptyDB = () => ({ version: 1, files: [], topicSummaries: {} });
let db = emptyDB();

function ensureDirs() {
  for (const dir of [DATA_DIR, FILES_DIR, TMP_DIR]) fs.mkdirSync(dir, { recursive: true });
}

export function init() {
  ensureDirs();
  if (!fs.existsSync(DB_PATH)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (raw && Array.isArray(raw.files)) {
      db = { version: 1, files: raw.files, topicSummaries: raw.topicSummaries || {} };
      let changed = false;
      for (const file of db.files) {
        // 旧版本的网页收藏没有类型，统一补成「网页」
        if (file.kind === 'link' && (!file.category || file.category === '其他')) {
          file.category = '网页';
          changed = true;
        }
      }
      if (changed) persist();
    }
  } catch (err) {
    console.error('[store] 读取 db.json 失败，将以空库启动：', err.message);
    const backup = `${DB_PATH}.broken-${Date.now()}`;
    try { fs.copyFileSync(DB_PATH, backup); console.error(`[store] 已备份损坏文件到 ${backup}`); } catch {}
  }
}

function persist() {
  ensureDirs();
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

export function sanitizeSegment(input, fallback = '未命名') {
  let s = String(input ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^\.+/, '').replace(/\.+$/, '').trim();
  return (s || fallback).slice(0, 60);
}

export function allFiles() {
  return db.files;
}

export function getFile(id) {
  return db.files.find((f) => f.id === id) || null;
}

export function addFile(item) {
  db.files.push(item);
  persist();
  return item;
}

export function updateFile(id, patch) {
  const item = getFile(id);
  if (!item) return null;
  Object.assign(item, patch);
  persist();
  return item;
}

export function updateFiles(updates) {
  for (const { id, patch } of updates) {
    const item = getFile(id);
    if (item) Object.assign(item, patch);
  }
  persist();
}

export function removeFile(id) {
  const index = db.files.findIndex((f) => f.id === id);
  if (index === -1) return null;
  const [item] = db.files.splice(index, 1);
  persist();
  return item;
}

export function getTopicSummary(topic) {
  return db.topicSummaries?.[topic] || null;
}

export function setTopicSummary(topic, summary, fileCount) {
  if (!db.topicSummaries) db.topicSummaries = {};
  db.topicSummaries[topic] = {
    summary,
    fileCount,
    updatedAt: new Date().toISOString(),
  };
  persist();
  return db.topicSummaries[topic];
}

export function renameTopicSummary(from, to) {
  if (!db.topicSummaries?.[from]) return;
  db.topicSummaries[to] = db.topicSummaries[from];
  delete db.topicSummaries[from];
  persist();
}

export function listFiles({ q, topic, category, tag, favorite, sort, includeHidden = false } = {}) {
  let items = db.files.slice();

  if (!includeHidden) items = items.filter((f) => !f.hidden);
  if (topic) items = items.filter((f) => f.topic === topic);
  if (category) items = items.filter((f) => f.category === category);
  if (tag) items = items.filter((f) => Array.isArray(f.tags) && f.tags.includes(tag));
  if (favorite === true || favorite === '1' || favorite === 'true') items = items.filter((f) => f.favorite);

  const query = String(q || '').trim().toLowerCase();
  if (query) {
    items = items.filter((f) =>
      `${f.title} ${f.originalName} ${f.summary || ''} ${f.topic} ${(f.tags || []).join(' ')}`
        .toLowerCase()
        .includes(query)
    );
  }

  const sorters = {
    newest: (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
    oldest: (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0),
    name: (a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN'),
    size: (a, b) => (b.size || 0) - (a.size || 0),
  };
  items.sort(sorters[sort] || sorters.newest);
  return items;
}

export function stats() {
  const cats = new Map(CATEGORIES.map((name) => [name, { name, count: 0, size: 0 }]));
  const topics = new Map();
  const tags = new Map();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let totalSize = 0;
  let addedThisWeek = 0;

  for (const f of db.files) {
    if (f.hidden) continue;
    const size = f.size || 0;
    totalSize += size;

    const cat = cats.get(f.category) || cats.get('其他');
    cat.count += 1;
    cat.size += size;

    const stored = db.topicSummaries?.[f.topic];
    const topic = topics.get(f.topic) || {
      name: f.topic,
      count: 0,
      size: 0,
      lastAt: 0,
      summary: stored?.summary || '',
      summaryUpdatedAt: stored?.updatedAt || null,
      summaryFileCount: stored?.fileCount || 0,
    };
    topic.count += 1;
    topic.size += size;
    topic.lastAt = Math.max(topic.lastAt, Date.parse(f.createdAt) || 0);
    topics.set(f.topic, topic);

    for (const t of f.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
    if ((Date.parse(f.createdAt) || 0) >= weekAgo) addedThisWeek += 1;
  }

  return {
    total: db.files.filter((f) => !f.hidden).length,
    totalSize,
    addedThisWeek,
    categories: [...cats.values()],
    topics: [...topics.values()].sort((a, b) => b.lastAt - a.lastAt || b.count - a.count),
    tags: [...tags.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')),
  };
}
