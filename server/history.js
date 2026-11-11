import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './store.js';

const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const MAX_TIME = 24;
const MAX_TITLE = 60;
const MAX_DETAIL = 1200;
const MAX_ERA = 20;

let db = { version: 1, events: [] };
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_PATH)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (raw && Array.isArray(raw.events)) db = { version: 1, events: raw.events.map(normalizeEvent) };
  } catch (error) {
    console.error('[history] 读取 history.json 失败，将以空库启动：', error.message);
    try {
      fs.copyFileSync(HISTORY_PATH, `${HISTORY_PATH}.broken-${Date.now()}`);
    } catch {}
  }
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${HISTORY_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, HISTORY_PATH);
}

function newId() {
  return `h_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

function freshReview() {
  return { reps: 0, lapses: 0, lastResult: null, lastReviewedAt: null };
}

// 支持「1840年6月」「1840-06」「公元前221年」等写法，生成可排序的数值
function parseTime(text) {
  const value = String(text || '').trim();
  const yearMatch = /(公元前|前)?\s*(\d{3,4})/.exec(value);
  if (!yearMatch) return null;

  const before = Boolean(yearMatch[1]);
  const year = Number(yearMatch[2]) * (before ? -1 : 1);
  const rest = value.slice(yearMatch.index + yearMatch[0].length);
  const monthMatch = /(\d{1,2})\s*月/.exec(rest) || /^\s*[-./]\s*(\d{1,2})/.exec(rest);
  const month = monthMatch ? Math.min(12, Number(monthMatch[1])) : 0;
  const dayMatch = /(\d{1,2})\s*日/.exec(rest);
  const day = dayMatch ? Math.min(31, Number(dayMatch[1])) : 0;

  return { sort: year * 10000 + month * 100 + day, year };
}

function normalizeEvent(item = {}) {
  const time = cleanText(item.time, MAX_TIME);
  const parsed = parseTime(time);
  return {
    id: item.id || newId(),
    time,
    sort: parsed ? parsed.sort : 0,
    year: parsed ? parsed.year : 0,
    title: cleanText(item.title, MAX_TITLE),
    detail: cleanText(item.detail, MAX_DETAIL),
    era: cleanText(item.era, MAX_ERA),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
    review: { ...freshReview(), ...(item.review || {}) },
  };
}

function sortEvents(items) {
  return items.slice().sort((a, b) => a.sort - b.sort || String(a.time).localeCompare(String(b.time), 'zh-CN'));
}

export function initHistory() {
  ensureLoaded();
}

export function listEvents({ q, era } = {}) {
  ensureLoaded();
  const query = String(q || '').trim().toLowerCase();
  const eraKey = String(era || '').trim();
  let items = db.events.slice();

  if (eraKey && eraKey !== 'all') items = items.filter((item) => item.era === eraKey);
  if (query) {
    items = items.filter((item) =>
      `${item.time} ${item.title} ${item.detail} ${item.era}`.toLowerCase().includes(query)
    );
  }

  return sortEvents(items);
}

export function historyStats() {
  ensureLoaded();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const eras = new Set();
  let learned = 0;
  let reviewedToday = 0;
  for (const item of db.events) {
    if (item.era) eras.add(item.era);
    if (item.review?.lastResult === 'good') learned += 1;
    if (item.review?.lastReviewedAt && Date.parse(item.review.lastReviewedAt) >= startOfDay.getTime()) {
      reviewedToday += 1;
    }
  }

  return { total: db.events.length, eras: eras.size, learned, reviewedToday };
}

export function listEras() {
  ensureLoaded();
  const map = new Map();
  for (const item of db.events) {
    if (!item.era) continue;
    map.set(item.era, (map.get(item.era) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([name, count]) => ({ name, count }));
}

export function addEvent(payload = {}) {
  ensureLoaded();
  const time = cleanText(payload.time, MAX_TIME);
  const title = cleanText(payload.title, MAX_TITLE);
  if (!time) throw badRequest('请填写时间，例如 1840年6月');
  if (!parseTime(time)) throw badRequest('时间需要包含年份，例如 1840年6月 或 公元前221年');
  if (!title) throw badRequest('请填写历史事件');

  const item = normalizeEvent({
    time,
    title,
    detail: payload.detail,
    era: payload.era,
  });
  db.events.push(item);
  persist();
  return item;
}

export function updateEvent(id, payload = {}) {
  ensureLoaded();
  const item = db.events.find((entry) => entry.id === id);
  if (!item) throw notFound('这条历史事件不存在');

  if (payload.time !== undefined) {
    const time = cleanText(payload.time, MAX_TIME);
    if (!time) throw badRequest('时间不能为空');
    const parsed = parseTime(time);
    if (!parsed) throw badRequest('时间需要包含年份，例如 1840年6月 或 公元前221年');
    item.time = time;
    item.sort = parsed.sort;
    item.year = parsed.year;
  }
  if (payload.title !== undefined) {
    const title = cleanText(payload.title, MAX_TITLE);
    if (!title) throw badRequest('历史事件不能为空');
    item.title = title;
  }
  if (payload.detail !== undefined) item.detail = cleanText(payload.detail, MAX_DETAIL);
  if (payload.era !== undefined) item.era = cleanText(payload.era, MAX_ERA);
  item.updatedAt = new Date().toISOString();
  persist();
  return item;
}

export function removeEvent(id) {
  ensureLoaded();
  const index = db.events.findIndex((entry) => entry.id === id);
  if (index === -1) throw notFound('这条历史事件不存在');
  const [removed] = db.events.splice(index, 1);
  persist();
  return removed;
}

export function reviewEvent(id, result) {
  ensureLoaded();
  const item = db.events.find((entry) => entry.id === id);
  if (!item) throw notFound('这条历史事件不存在');

  const grade = ['again', 'hard', 'good'].includes(result) ? result : 'good';
  const review = { ...freshReview(), ...(item.review || {}) };
  review.reps = (review.reps || 0) + 1;
  if (grade === 'again') review.lapses = (review.lapses || 0) + 1;
  review.lastResult = grade;
  review.lastReviewedAt = new Date().toISOString();
  item.review = review;
  item.updatedAt = review.lastReviewedAt;
  persist();
  return item;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}
