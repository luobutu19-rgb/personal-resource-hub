import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './store.js';
import { chat, parseJSON } from './ai.js';

const CARDS_PATH = path.join(DATA_DIR, 'cards.json');
const DEFAULT_DECK = '默认';
const MAX_FRONT = 200;
const MAX_BACK = 800;
const MAX_TAGS = 6;

let db = { version: 1, cards: [] };
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CARDS_PATH)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(CARDS_PATH, 'utf8'));
    if (raw && Array.isArray(raw.cards)) db = { version: 1, cards: raw.cards };
  } catch (error) {
    console.error('[cards] 读取 cards.json 失败，将以空库启动：', error.message);
    const backup = `${CARDS_PATH}.broken-${Date.now()}`;
    try {
      fs.copyFileSync(CARDS_PATH, backup);
    } catch {}
  }
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${CARDS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, CARDS_PATH);
}

function newId() {
  return `c_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,，、\s]+/);
  return [...new Set(list.map((tag) => cleanText(tag, 12)).filter(Boolean))].slice(0, MAX_TAGS);
}

function normalizeDeck(input) {
  return cleanText(input, 20) || DEFAULT_DECK;
}

function freshReview() {
  return {
    due: new Date().toISOString(),
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    lastReviewedAt: null,
    lastResult: null,
  };
}

function normalizeCard(item) {
  return {
    id: item.id || newId(),
    deck: normalizeDeck(item.deck),
    title: cleanText(item.title, 48),
    front: cleanText(item.front, MAX_FRONT),
    back: cleanText(item.back, MAX_BACK),
    tags: normalizeTags(item.tags),
    source: item.source === 'ai' ? 'ai' : 'manual',
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
    review: { ...freshReview(), ...(item.review || {}) },
  };
}

export function initCards() {
  ensureLoaded();
}

export function listCards({ deck, q, due } = {}) {
  ensureLoaded();
  const query = String(q || '').trim().toLowerCase();
  const now = Date.now();
  let items = db.cards.slice();

  if (deck && deck !== 'all') items = items.filter((card) => card.deck === deck);
  if (due === '1' || due === 'true') {
    items = items.filter((card) => Date.parse(card.review?.due || 0) <= now);
  }
  if (query) {
    items = items.filter((card) =>
      `${card.title || ''} ${card.front} ${card.back} ${(card.tags || []).join(' ')} ${card.deck}`
        .toLowerCase()
        .includes(query)
    );
  }

  items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return items;
}

export function deckSummary() {
  ensureLoaded();
  const map = new Map();
  const now = Date.now();
  for (const card of db.cards) {
    const entry = map.get(card.deck) || { name: card.deck, count: 0, due: 0 };
    entry.count += 1;
    if (Date.parse(card.review?.due || 0) <= now) entry.due += 1;
    map.set(card.deck, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

export function cardsStats() {
  ensureLoaded();
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  let due = 0;
  let fresh = 0;
  let reviewedToday = 0;
  let learned = 0;

  for (const card of db.cards) {
    const review = card.review || {};
    if (Date.parse(review.due || 0) <= now) due += 1;
    if (!review.reps) fresh += 1;
    if (review.interval >= 1) learned += 1;
    if (review.lastReviewedAt && Date.parse(review.lastReviewedAt) >= startOfDay.getTime()) reviewedToday += 1;
  }

  return { total: db.cards.length, due, fresh, learned, reviewedToday, decks: deckSummary().length };
}

export function addCard(payload = {}) {
  ensureLoaded();
  const front = cleanText(payload.front, MAX_FRONT);
  const back = cleanText(payload.back, MAX_BACK);
  if (!front) throw badRequest('请填写卡片正面（问题）');
  if (!back) throw badRequest('请填写卡片背面（答案）');

  const card = normalizeCard({
    deck: payload.deck,
    title: payload.title,
    front,
    back,
    tags: payload.tags,
    source: payload.source,
  });
  db.cards.push(card);
  persist();
  return card;
}

export function addCards(items = []) {
  ensureLoaded();
  if (!Array.isArray(items) || !items.length) throw badRequest('没有可导入的卡片');
  if (items.length > 200) throw badRequest('一次最多导入 200 张卡片');

  const created = [];
  for (const item of items) {
    const front = cleanText(item.front, MAX_FRONT);
    const back = cleanText(item.back, MAX_BACK);
    if (!front || !back) throw badRequest('每张卡片都需要正面和背面内容');
    created.push(
      normalizeCard({
        deck: item.deck,
        title: item.title,
        front,
        back,
        tags: item.tags,
        source: item.source,
      })
    );
  }
  db.cards.push(...created);
  persist();
  return created;
}

export function updateCard(id, payload = {}) {
  ensureLoaded();
  const card = db.cards.find((item) => item.id === id);
  if (!card) throw notFound('卡片不存在');

  if (payload.front !== undefined) {
    const front = cleanText(payload.front, MAX_FRONT);
    if (!front) throw badRequest('卡片正面不能为空');
    card.front = front;
  }
  if (payload.back !== undefined) {
    const back = cleanText(payload.back, MAX_BACK);
    if (!back) throw badRequest('卡片背面不能为空');
    card.back = back;
  }
  if (payload.deck !== undefined) card.deck = normalizeDeck(payload.deck);
  if (payload.title !== undefined) card.title = cleanText(payload.title, 48);
  if (payload.tags !== undefined) card.tags = normalizeTags(payload.tags);
  card.updatedAt = new Date().toISOString();
  persist();
  return card;
}

export function removeCard(id) {
  ensureLoaded();
  const index = db.cards.findIndex((item) => item.id === id);
  if (index === -1) throw notFound('卡片不存在');
  const [removed] = db.cards.splice(index, 1);
  persist();
  return removed;
}

export function reviewCard(id, result) {
  ensureLoaded();
  const card = db.cards.find((item) => item.id === id);
  if (!card) throw notFound('卡片不存在');

  const grade = ['again', 'hard', 'good'].includes(result) ? result : 'good';
  const review = { ...freshReview(), ...(card.review || {}) };
  const now = Date.now();
  let interval = Number(review.interval) || 0;
  let ease = Number(review.ease) || 2.5;

  if (grade === 'again') {
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    review.lapses = (review.lapses || 0) + 1;
    review.due = new Date(now + 10 * 60 * 1000).toISOString();
  } else if (grade === 'hard') {
    interval = interval ? Math.max(1, Math.round(interval * 1.2)) : 1;
    ease = Math.max(1.3, ease - 0.05);
    review.due = new Date(now + interval * 86400000).toISOString();
  } else {
    interval = interval ? Math.round(interval * ease) : 2;
    ease = Math.min(3.3, ease + 0.08);
    review.due = new Date(now + interval * 86400000).toISOString();
  }

  review.interval = interval;
  review.ease = Number(ease.toFixed(2));
  review.reps = (review.reps || 0) + 1;
  review.lastReviewedAt = new Date(now).toISOString();
  review.lastResult = grade;
  card.review = review;
  card.updatedAt = new Date(now).toISOString();
  persist();
  return card;
}

export async function generateCards({ text, deck, count } = {}) {
  ensureLoaded();
  const source = cleanText(text, 8000);
  if (source.length < 12) throw badRequest('内容太短，至少粘贴 12 个字再让 AI 制卡');
  const target = clamp(Number.parseInt(count, 10) || 8, 1, 20);

  const content = await chat(
    [
      {
        role: 'system',
        content:
          '你是记忆卡片（Anki）制作助手。请把用户提供的学习材料拆成便于主动回忆的问答卡片。' +
          `要求：生成 ${target} 张卡片；front 是明确的问题或提示（不超过 60 字，避免“什么是…”的套话堆砌）；back 是简洁准确的答案（不超过 160 字，可用分号连接要点）；` +
          '覆盖材料中的关键概念、公式、结论或易错点，不要重复；每张卡 1-3 个短标签；使用中文。' +
          '只输出严格 JSON，不要代码块或解释，格式：{"cards":[{"front":"","back":"","tags":[""]}]}。',
      },
      { role: 'user', content: `学习材料：\n${source}` },
    ],
    { timeout: 90000, maxTokens: 1800 }
  );

  const parsed = parseJSON(content);
  const list = Array.isArray(parsed.cards) ? parsed.cards : [];
  const deckName = normalizeDeck(deck);
  const created = [];

  for (const item of list.slice(0, 20)) {
    const front = cleanText(item?.front, MAX_FRONT);
    const back = cleanText(item?.back, MAX_BACK);
    if (!front || !back) continue;
    const card = normalizeCard({
      deck: deckName,
      front,
      back,
      tags: item?.tags,
      source: 'ai',
    });
    db.cards.push(card);
    created.push(card);
  }

  if (!created.length) throw badRequest('AI 没有生成有效卡片，请补充材料或重试');
  persist();
  return created;
}

export function renameDeck(from, to) {
  ensureLoaded();
  const oldName = normalizeDeck(from);
  const newName = normalizeDeck(to);
  if (!newName) throw badRequest('卡组名不能为空');
  let updated = 0;
  for (const card of db.cards) {
    if (card.deck === oldName) {
      card.deck = newName;
      card.updatedAt = new Date().toISOString();
      updated += 1;
    }
  }
  if (updated) persist();
  return { updated, name: newName };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
