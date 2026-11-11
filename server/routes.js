import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FILES_DIR, DATA_DIR, allFiles, getFile, addFile, updateFile, updateFiles, removeFile, listFiles, stats, sanitizeSegment, setTopicSummary, renameTopicSummary } from './store.js';
import { CATEGORIES, TOPIC_RULES, TAG_RULES } from './classifier.js';
import { uploader, hashFile, moveIntoLibrary, buildStoredName } from './upload.js';
import { getSettings, publicSettings, updateSettings } from './settings.js';
import { summarizeFile, summarizeLink, suggestMeta, summarizeTopic, searchFiles, testConnection } from './ai.js';
import { canSummarize } from './text.js';
import { collectLink } from './collect.js';
import {
  getExamData,
  updateSettings as updateExamSettings,
  addExam,
  updateExam,
  removeExam,
  generatePlan,
  toggleTask,
  moveTask,
  togglePacking,
} from './exams.js';
import {
  vaultStatus,
  unlockVault,
  lockVault,
  setVaultPassword,
  isRequestUnlocked,
} from './vault.js';
import {
  buildContext as buildAssistantContext,
  buildSuggestions as buildAssistantSuggestions,
  askAssistant,
} from './assistant.js';
import {
  initMistakes,
  listMistakes,
  getMistake,
  addMistake,
  updateMistake,
  deleteMistake,
  startAnalysis,
  scanPhoto,
  confirmScan,
  discardScan,
  saveImage,
  imagePath,
  imageMime,
} from './mistakes.js';
import {
  listCards,
  deckSummary,
  cardsStats,
  addCard,
  addCards,
  updateCard,
  removeCard,
  reviewCard,
  generateCards,
  renameDeck,
} from './cards.js';
import {
  listEvents,
  listEras,
  historyStats,
  addEvent,
  updateEvent,
  removeEvent,
  reviewEvent,
} from './history.js';

export const router = express.Router();

function resolveStored(item) {
  const abs = path.resolve(FILES_DIR, item.relPath);
  const root = path.resolve(FILES_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function contentDisposition(type, name) {
  const ascii = String(name || 'file')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name || 'file')}`;
}

function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,，]/);
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))].slice(0, 10).map((t) => t.slice(0, 16));
}

function applyFilePatch(item, body = {}) {
  const patch = {};

  if (typeof body.title === 'string') {
    const title = body.title.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (title) patch.title = title;
  }
  if (typeof body.favorite === 'boolean') patch.favorite = body.favorite;
  if (typeof body.hidden === 'boolean') patch.hidden = body.hidden;
  if (body.tags !== undefined) patch.tags = normalizeTags(body.tags);

  let nextTopic = item.topic;
  let nextCategory = item.category;

  if (typeof body.topic === 'string') {
    const topic = sanitizeSegment(body.topic, '');
    if (!topic) {
      const error = new Error('主题名不能为空');
      error.status = 400;
      throw error;
    }
    nextTopic = topic.slice(0, 24);
  }
  if (typeof body.category === 'string') {
    if (!CATEGORIES.includes(body.category)) {
      const error = new Error('类型不合法');
      error.status = 400;
      throw error;
    }
    nextCategory = body.category;
  }

  const nextTitle = patch.title || item.title;
  const titleChanged = nextTitle !== item.title;

  if (item.kind === 'link') {
    patch.topic = nextTopic;
    patch.category = nextCategory;
    return updateFile(item.id, patch);
  }

  if (nextTopic !== item.topic || nextCategory !== item.category || titleChanged) {
    const oldAbs = resolveStored(item);
    const dir = path.join(FILES_DIR, sanitizeSegment(nextTopic), nextCategory);
    fs.mkdirSync(dir, { recursive: true });

    const oldDir = oldAbs ? path.dirname(oldAbs) : null;
    const sameDir = oldDir === path.resolve(dir);
    let nextStored = item.storedName;

    if (titleChanged) {
      nextStored = buildStoredName(dir, nextTitle, item.ext, sameDir && oldAbs ? path.basename(oldAbs) : null);
    } else if (!sameDir && fs.existsSync(path.join(dir, nextStored))) {
      nextStored = buildStoredName(dir, item.title, item.ext, null);
    }

    const newAbs = path.join(dir, nextStored);
    if (oldAbs && fs.existsSync(oldAbs) && path.resolve(oldAbs) !== path.resolve(newAbs)) {
      fs.renameSync(oldAbs, newAbs);
    }

    patch.topic = nextTopic;
    patch.category = nextCategory;
    if (nextStored !== item.storedName) patch.storedName = nextStored;
    patch.relPath = path.relative(FILES_DIR, newAbs).split(path.sep).join('/');
  }

  return updateFile(item.id, patch);
}

async function autoSummarize(id) {
  updateFile(id, { summaryStatus: 'pending' });
  try {
    const item = getFile(id);
    const summary = await summarizeFile(item);
    updateFile(id, { summary, summaryStatus: 'done' });
  } catch {
    updateFile(id, { summaryStatus: 'failed' });
  }
}

async function autoSummarizeLink(id) {
  updateFile(id, { summaryStatus: 'pending' });
  try {
    const item = getFile(id);
    const summary = await summarizeLink(item);
    updateFile(id, { aiSummary: summary, summaryStatus: 'done' });
  } catch {
    updateFile(id, { summaryStatus: 'failed' });
  }
}

function maybeAutoSummarize(item) {
  const settings = getSettings();
  if (!item || !settings.ai.enabled || !settings.ai.apiKey || !settings.ai.autoSummaryOnUpload) return;
  if (item.kind === 'link') {
    autoSummarizeLink(item.id).catch(() => {});
    return;
  }
  if (canSummarize(item.ext)) autoSummarize(item.id).catch(() => {});
}

// ---------- AI 自动分类 ----------
const classifyQueue = [];
const classifying = new Set();
const CLASSIFY_CONCURRENCY = 2;
let classifyRunning = 0;

function needsClassify(item) {
  if (item.aiClassified) return false;
  return item.topic === '未分类' || !(item.tags || []).length || item.category === '其他';
}

// 只补主题、标签和「其他」类型，不改文件名，避免自动整理得太激进
async function autoClassify(id) {
  const item = getFile(id);
  if (!item || item.hidden) return null;

  const topics = [...new Set(allFiles().map((file) => file.topic).filter((topic) => topic && topic !== '未分类'))];
  const suggestion = await suggestMeta(item, topics);
  const current = getFile(id);
  if (!current) return null;

  const patch = {};
  if (suggestion.topic && suggestion.topic !== current.topic) patch.topic = suggestion.topic;
  if (suggestion.tags.length) patch.tags = suggestion.tags;

  const aiCategory = CATEGORIES.includes(suggestion.category) ? suggestion.category : '';
  if (aiCategory && aiCategory !== current.category) {
    if (current.kind === 'link') {
      if (['视频', '音频'].includes(aiCategory) || current.category === '其他') patch.category = aiCategory;
    } else if (current.category === '其他') {
      // 有明确扩展名的文件保留按扩展名判断的类型，只补「其他」
      patch.category = aiCategory;
    }
  }
  if (!Object.keys(patch).length) {
    updateFile(id, { aiClassified: true });
    return null;
  }

  const updated = applyFilePatch(current, patch);
  updateFile(id, { aiClassified: true });
  return updated;
}

function pumpClassify() {
  while (classifyRunning < CLASSIFY_CONCURRENCY && classifyQueue.length) {
    const id = classifyQueue.shift();
    if (classifying.has(id)) continue;
    classifying.add(id);
    classifyRunning += 1;
    autoClassify(id)
      .catch(() => {})
      .finally(() => {
        classifying.delete(id);
        classifyRunning -= 1;
        pumpClassify();
      });
  }
}

function queueClassify(id) {
  if (classifying.has(id) || classifyQueue.includes(id)) return;
  classifyQueue.push(id);
  pumpClassify();
}

function maybeAutoClassify(item) {
  const settings = getSettings();
  if (!item || item.hidden) return;
  if (!settings.ai.enabled || !settings.ai.apiKey || !settings.ai.autoClassifyOnUpload) return;
  if (!needsClassify(item)) return;
  queueClassify(item.id);
}

router.get('/server-info', (req, res) => {
  const addresses = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  const unique = [...new Set(addresses)].sort(
    (a, b) => (a.startsWith('192.168.') ? 0 : 1) - (b.startsWith('192.168.') ? 0 : 1)
  );
  res.json({ port: req.socket.localPort, addresses: unique });
});

// 隐藏文件（隐私空间）守卫：未解锁时一律视为不存在
function guardHidden(req, item) {
  return item && item.hidden && !isRequestUnlocked(req);
}

router.get('/files', (req, res) => {
  const { q, topic, category, tag, favorite, sort } = req.query;
  const unlocked = isRequestUnlocked(req);
  const wantHidden = String(req.query.hidden || '') === '1' && unlocked;
  const items = listFiles({
    q,
    topic: topic ? String(topic) : undefined,
    category: CATEGORIES.includes(category) ? category : undefined,
    tag: tag ? String(tag) : undefined,
    favorite,
    sort: String(sort || 'newest'),
    includeHidden: unlocked,
  }).filter((f) => (wantHidden ? f.hidden : !f.hidden));
  res.json({ items, total: items.length });
});

function collectCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

router.options('/collect', (req, res) => {
  collectCors(res);
  res.sendStatus(204);
});

router.get('/collect/ping', (req, res) => {
  collectCors(res);
  res.json({ ok: true, service: 'resource-hub', port: req.socket.localPort });
});

router.post('/collect', async (req, res) => {
  collectCors(res);
  const payload = typeof req.body === 'string' ? { text: req.body } : req.body || {};
  try {
    const result = await collectLink(payload);
    if (!result.duplicate) {
      maybeAutoSummarize(result.item);
      maybeAutoClassify(result.item);
    }
    res.json(result);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.get('/collect', async (req, res) => {
  collectCors(res);
  try {
    const result = await collectLink(req.query || {});
    if (!result.duplicate) {
      maybeAutoSummarize(result.item);
      maybeAutoClassify(result.item);
    }
    res.json(result);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/files', (req, res, next) => {
  uploader.array('files', 200)(req, res, async (err) => {
    if (err) return next(err);
    const uploaded = req.files || [];
    const items = [];
    let skippedDuplicates = 0;

    try {
      const knownHashes = new Set(allFiles().map((f) => f.hash).filter(Boolean));
      for (const file of uploaded) {
        const hash = await hashFile(file.path);
        if (knownHashes.has(hash)) {
          skippedDuplicates += 1;
          fs.rmSync(file.path, { force: true });
          continue;
        }
        const item = moveIntoLibrary(file.path, file.originalname, hash, file.mimetype);
        addFile(item);
        knownHashes.add(hash);
        items.push(item);
      }
    } catch (error) {
      return next(error);
    }

    const settings = getSettings();
    if (items.length && settings.ai.enabled && settings.ai.apiKey && settings.ai.autoSummaryOnUpload) {
      for (const item of items) {
        if (canSummarize(item.ext)) autoSummarize(item.id).catch(() => {});
      }
    }
    // 一次上传很多文件时只自动分类前 20 个，避免一次发太多 AI 请求
    for (const item of items.slice(0, 20)) maybeAutoClassify(item);

    res.json({ items, skippedDuplicates });
  });
});

router.get('/files/:id/cover', (req, res) => {
  const item = getFile(req.params.id);
  if (!item || !item.coverPath || guardHidden(req, item)) return res.status(404).json({ error: '没有封面' });

  const root = path.resolve(DATA_DIR);
  const abs = path.resolve(DATA_DIR, item.coverPath);
  if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) {
    return res.status(404).json({ error: '封面已丢失' });
  }
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(abs);
});

// ---------- AI 助手 ----------

router.get('/assistant/brief', (req, res) => {
  try {
    const context = buildAssistantContext();
    res.json({ context, suggestions: buildAssistantSuggestions(context) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/assistant/chat', async (req, res) => {
  try {
    const reply = await askAssistant(req.body?.messages, req.body?.fileIds);
    res.json({ reply });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

// 聚焦搜索用的轻量索引：包含隐私文件的标题等信息（内容仍需密码）
router.get('/search/index', (req, res) => {
  const items = allFiles().map((file) => ({
    id: file.id,
    kind: file.kind || 'file',
    title: file.title,
    topic: file.topic,
    category: file.category,
    tags: file.tags || [],
    size: file.size,
    createdAt: file.createdAt,
    hidden: Boolean(file.hidden),
  }));
  res.json({ items });
});

router.get('/files/:id/download', (req, res) => {
  const item = getFile(req.params.id);
  if (!item || guardHidden(req, item)) return res.status(404).json({ error: '文件不存在' });
  if (item.kind === 'link') return res.status(400).json({ error: '网页收藏没有可下载的文件' });
  const abs = resolveStored(item);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: '文件已丢失' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition('attachment', item.originalName));
  res.sendFile(abs);
});

router.get('/files/:id/raw', (req, res) => {
  const item = getFile(req.params.id);
  if (!item || guardHidden(req, item)) return res.status(404).json({ error: '文件不存在' });
  if (item.kind === 'link') return res.status(404).json({ error: '网页收藏没有文件内容' });
  const abs = resolveStored(item);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: '文件已丢失' });

  const ext = String(item.ext || '').toLowerCase();
  res.setHeader('Content-Type', item.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition('inline', item.originalName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (ext === 'svg' || ext === 'html' || ext === 'htm') {
    res.setHeader('Content-Security-Policy', 'sandbox');
  }
  res.sendFile(abs);
});

router.patch('/files/:id', (req, res) => {
  const item = getFile(req.params.id);
  if (!item) return res.status(404).json({ error: '文件不存在' });
  if (req.body && 'hidden' in req.body && !isRequestUnlocked(req)) {
    return res.status(401).json({ error: '请先解锁隐私空间' });
  }

  try {
    const updated = applyFilePatch(item, req.body || {});
    res.json(updated);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

function removeFileCompletely(item) {
  if (item.kind === 'link') {
    if (item.coverPath) {
      const root = path.resolve(DATA_DIR);
      const cover = path.resolve(DATA_DIR, item.coverPath);
      if (cover.startsWith(root + path.sep)) {
        try {
          fs.rmSync(cover, { force: true });
        } catch {}
      }
    }
    removeFile(item.id);
    return;
  }

  const abs = resolveStored(item);
  if (abs && fs.existsSync(abs)) {
    try {
      fs.rmSync(abs, { force: true });
    } catch {}
  }
  removeFile(item.id);
}

router.delete('/files/:id', (req, res) => {
  const item = getFile(req.params.id);
  if (!item || guardHidden(req, item)) return res.status(404).json({ error: '文件不存在' });
  removeFileCompletely(item);
  res.json({ ok: true });
});

// 批量修改：收藏、移动到主题、加标签、隐藏/取消隐藏
router.post('/files/batch', (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))].filter(Boolean).slice(0, 300) : [];
  if (!ids.length) return res.status(400).json({ error: '先选择文件' });
  if (body.patch && 'hidden' in body.patch && !isRequestUnlocked(req)) {
    return res.status(401).json({ error: '请先解锁隐私空间' });
  }

  const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
  const unlocked = isRequestUnlocked(req);
  let updated = 0;
  let skipped = 0;

  for (const id of ids) {
    const item = getFile(id);
    if (!item || (item.hidden && !unlocked)) {
      skipped += 1;
      continue;
    }

    const next = {};
    if (typeof patch.favorite === 'boolean') next.favorite = patch.favorite;
    if (typeof patch.hidden === 'boolean') next.hidden = patch.hidden;
    if (typeof patch.topic === 'string') next.topic = patch.topic;
    if (Array.isArray(patch.addTags) && patch.addTags.length) {
      next.tags = [...new Set([...(item.tags || []), ...normalizeTags(patch.addTags)])];
    }
    if (!Object.keys(next).length) {
      skipped += 1;
      continue;
    }

    try {
      applyFilePatch(item, next);
      updated += 1;
    } catch {
      skipped += 1;
    }
  }

  res.json({ ok: true, updated, skipped });
});

// 批量删除
router.post('/files/batch-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? [...new Set(req.body.ids.map(String))].filter(Boolean).slice(0, 300)
    : [];
  if (!ids.length) return res.status(400).json({ error: '先选择文件' });

  const unlocked = isRequestUnlocked(req);
  let deleted = 0;
  let skipped = 0;
  for (const id of ids) {
    const item = getFile(id);
    if (!item || (item.hidden && !unlocked)) {
      skipped += 1;
      continue;
    }
    removeFileCompletely(item);
    deleted += 1;
  }
  res.json({ ok: true, deleted, skipped });
});

router.post('/files/:id/ai/summary', async (req, res) => {
  const item = getFile(req.params.id);
  if (!item || guardHidden(req, item)) return res.status(404).json({ error: '文件不存在' });
  try {
    if (item.kind === 'link') {
      const summary = await summarizeLink(item);
      updateFile(item.id, { aiSummary: summary, summaryStatus: 'done' });
      return res.json({ summary, aiSummary: summary, summaryStatus: 'done' });
    }
    const summary = await summarizeFile(item);
    updateFile(item.id, { summary, summaryStatus: 'done' });
    res.json({ summary, summaryStatus: 'done' });
  } catch (error) {
    updateFile(item.id, { summaryStatus: 'failed' });
    res.status(400).json({ error: error.message });
  }
});

router.post('/files/:id/ai/suggest', async (req, res) => {
  const item = getFile(req.params.id);
  if (!item || guardHidden(req, item)) return res.status(404).json({ error: '文件不存在' });
  try {
    const topics = [...new Set(allFiles().map((file) => file.topic))];
    const suggestion = await suggestMeta(item, topics);
    res.json({ suggestion });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/files/:id/ai/organize', async (req, res) => {
  const item = getFile(req.params.id);
  if (!item || guardHidden(req, item)) return res.status(404).json({ error: '文件不存在' });

  try {
    const topics = [...new Set(allFiles().map((file) => file.topic))];
    const suggestion = await suggestMeta(item, topics);
    const updated = applyFilePatch(item, {
      title: suggestion.title || item.title,
      topic: suggestion.topic || item.topic,
      category: CATEGORIES.includes(suggestion.category) ? suggestion.category : item.category,
      tags: suggestion.tags.length ? suggestion.tags : item.tags,
    });
    res.json({ item: updated, suggestion });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

// 手动触发：把还没有主题/标签的文件交给 AI 整理
router.post('/ai/classify-unfiled', async (req, res) => {
  const settings = getSettings();
  if (!settings.ai.enabled || !settings.ai.apiKey) {
    return res.status(400).json({ error: 'AI 尚未启用，请先填写接口和 API Key' });
  }

  const targets = allFiles()
    .filter((file) => !file.hidden && needsClassify(file))
    .slice(0, 20);

  let changed = 0;
  for (const item of targets) {
    if (classifying.has(item.id)) continue;
    try {
      const updated = await autoClassify(item.id);
      if (updated) changed += 1;
    } catch {}
  }

  res.json({ total: targets.length, changed });
});

router.get('/stats', (req, res) => {
  const data = stats();
  const settings = getSettings();
  res.json({ ...data, aiEnabled: Boolean(settings.ai.enabled && settings.ai.apiKey) });
});

router.get('/rules', (req, res) => {
  res.json({
    categories: CATEGORIES,
    topics: TOPIC_RULES.map((rule) => rule.topic),
    tags: TAG_RULES.map((rule) => rule.tag),
  });
});

router.post('/topics/summary', async (req, res) => {
  const topic = sanitizeSegment(req.body?.topic, '').slice(0, 24);
  if (!topic) return res.status(400).json({ error: '主题名不能为空' });

  const files = allFiles().filter((file) => file.topic === topic);
  if (!files.length) return res.status(404).json({ error: '该主题下还没有文件' });

  try {
    const summary = await summarizeTopic(topic, files);
    const saved = setTopicSummary(topic, summary, files.length);
    res.json({ topic, summary: saved.summary, fileCount: saved.fileCount, updatedAt: saved.updatedAt });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/ai/search', async (req, res) => {
  const query = String(req.body?.query || '').trim().slice(0, 120);
  if (!query) return res.status(400).json({ error: '请先描述你要找的内容' });

  const files = allFiles();
  if (!files.length) return res.json({ items: [], query });

  try {
    const matches = await searchFiles(query, files);
    const byId = new Map(files.map((file) => [file.id, file]));
    const items = matches
      .map((match) => ({ ...byId.get(match.id), reason: match.reason }))
      .filter((item) => item.id);
    res.json({ items, query });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/topics/rename', (req, res) => {
  const from = sanitizeSegment(req.body?.from, '');
  const to = sanitizeSegment(req.body?.to, '').slice(0, 24);
  if (!from || !to) return res.status(400).json({ error: '主题名不能为空' });
  if (from === to) return res.json({ updated: 0 });

  const targets = allFiles().filter((f) => f.topic === from);
  if (!targets.length) return res.status(404).json({ error: '该主题下没有文件' });

  const updates = [];
  for (const item of targets) {
    if (item.kind === 'link') {
      updates.push({ id: item.id, patch: { topic: to } });
      continue;
    }

    const oldAbs = resolveStored(item);
    const dir = path.join(FILES_DIR, to, item.category);
    fs.mkdirSync(dir, { recursive: true });
    const newAbs = path.join(dir, item.storedName);
    try {
      if (oldAbs && fs.existsSync(oldAbs)) fs.renameSync(oldAbs, newAbs);
    } catch {}
    updates.push({
      id: item.id,
      patch: { topic: to, relPath: path.relative(FILES_DIR, newAbs).split(path.sep).join('/') },
    });
  }
  updateFiles(updates);
  renameTopicSummary(from, to);

  try {
    const oldDir = path.join(FILES_DIR, sanitizeSegment(from));
    if (fs.existsSync(oldDir)) {
      for (const entry of fs.readdirSync(oldDir)) {
        const sub = path.join(oldDir, entry);
        if (fs.statSync(sub).isDirectory() && fs.readdirSync(sub).length === 0) fs.rmdirSync(sub);
      }
      if (fs.readdirSync(oldDir).length === 0) fs.rmdirSync(oldDir);
    }
  } catch {}

  res.json({ updated: updates.length });
});

router.get('/cards', (req, res) => {
  const { deck, q, due } = req.query;
  res.json({
    items: listCards({ deck: deck ? String(deck) : '', q: q ? String(q) : '', due: String(due || '') }),
    decks: deckSummary(),
    stats: cardsStats(),
  });
});

router.post('/cards/generate', async (req, res) => {
  try {
    const items = await generateCards(req.body || {});
    res.json({ items, decks: deckSummary(), stats: cardsStats() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/cards/decks/rename', (req, res) => {
  try {
    const result = renameDeck(req.body?.from, req.body?.to);
    res.json({ ...result, decks: deckSummary() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/cards/bulk', (req, res) => {
  try {
    const body = req.body || {};
    const items = addCards(Array.isArray(body) ? body : body.items);
    res.json({ items, count: items.length, decks: deckSummary(), stats: cardsStats() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/cards', (req, res) => {
  try {
    const item = addCard(req.body || {});
    res.json({ item, decks: deckSummary(), stats: cardsStats() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.patch('/cards/:id', (req, res) => {
  try {
    const item = updateCard(req.params.id, req.body || {});
    res.json({ item, decks: deckSummary(), stats: cardsStats() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.delete('/cards/:id', (req, res) => {
  try {
    removeCard(req.params.id);
    res.json({ ok: true, decks: deckSummary(), stats: cardsStats() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/cards/:id/review', (req, res) => {
  try {
    const item = reviewCard(req.params.id, req.body?.result);
    res.json({ item, stats: cardsStats(), decks: deckSummary() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.get('/history', (req, res) => {
  const { q, era } = req.query;
  res.json({
    items: listEvents({ q: q ? String(q) : '', era: era ? String(era) : '' }),
    eras: listEras(),
    stats: historyStats(),
  });
});

router.post('/history', (req, res) => {
  try {
    const item = addEvent(req.body || {});
    res.json({ item, eras: listEras(), stats: historyStats() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.patch('/history/:id', (req, res) => {
  try {
    const item = updateEvent(req.params.id, req.body || {});
    res.json({ item, eras: listEras(), stats: historyStats() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.delete('/history/:id', (req, res) => {
  try {
    removeEvent(req.params.id);
    res.json({ ok: true, eras: listEras(), stats: historyStats() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/history/:id/review', (req, res) => {
  try {
    const item = reviewEvent(req.params.id, req.body?.result);
    res.json({ item, stats: historyStats() });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.get('/settings', (req, res) => {
  res.json(publicSettings());
});

router.put('/settings', (req, res) => {
  const { privacy, ...body } = req.body || {}; // 隐私空间密码只能走 /api/vault/password
  updateSettings(body);
  res.json(publicSettings());
});

router.post('/settings/ai/test', async (req, res) => {
  try {
    await testConnection();
    res.json({ ok: true, message: '连接成功，AI 可用' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/exams', (req, res) => {
  res.json(getExamData());
});

router.put('/exams/settings', (req, res) => {
  try {
    res.json(updateExamSettings(req.body || {}));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/exams', (req, res) => {
  try {
    res.json(addExam(req.body || {}));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.patch('/exams/tasks/:taskId', (req, res) => {
  try {
    res.json(toggleTask(req.params.taskId, req.body?.done));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.patch('/exams/tasks/:taskId/move', (req, res) => {
  try {
    res.json(moveTask(req.params.taskId, req.body?.date));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.patch('/exams/packing', (req, res) => {
  try {
    const { week, key, packed } = req.body || {};
    res.json(togglePacking(week, key, packed));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/exams/:id/plan', async (req, res) => {
  try {
    res.json(await generatePlan(req.params.id, { useAI: Boolean(req.body?.useAI) }));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.patch('/exams/:id', (req, res) => {
  try {
    res.json(updateExam(req.params.id, req.body || {}));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.delete('/exams/:id', (req, res) => {
  try {
    removeExam(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

// 隐私空间
router.get('/vault', (req, res) => {
  res.json(vaultStatus(req));
});

router.post('/vault/unlock', (req, res) => {
  try {
    const result = unlockVault((req.body || {}).password);
    res.json(result);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/vault/lock', (req, res) => {
  res.json(lockVault(req));
});

router.put('/vault/password', (req, res) => {
  try {
    const { current, next } = req.body || {};
    res.json(setVaultPassword({ current, next }));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

// ---------- 错题本 ----------

router.get('/mistakes', (req, res) => {
  let items = listMistakes();
  if (req.query.subject && req.query.subject !== 'all') {
    items = items.filter((item) => item.subject === req.query.subject);
  }
  if (req.query.status && req.query.status !== 'all') {
    items = items.filter((item) => item.status === req.query.status);
  }
  res.json({ items });
});

router.post('/mistakes', (req, res) => {
  uploader.single('image')(req, res, async (uploadError) => {
    if (uploadError) {
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: tooBig ? '图片不能超过 10MB' : '图片上传失败' });
    }
    try {
      if (req.file && req.file.size > 10 * 1024 * 1024) {
        return res.status(400).json({ error: '图片不能超过 10MB' });
      }
      const image = req.file ? saveImage(req.file.path, req.file.originalname) : null;
      const subject = String(req.body?.subject || '').trim();
      const question = String(req.body?.question || '').trim();
      const note = String(req.body?.note || '').trim();
      if (!image && !question) {
        return res.status(400).json({ error: '请拍照上传错题，或粘贴题目文字' });
      }
      if (!subject) {
        return res.status(400).json({ error: '请选择科目' });
      }
      const record = addMistake({ subject, question, note, image });
      if (!record) return res.status(400).json({ error: '请拍照上传错题，或粘贴题目文字' });

      // 立刻返回，AI 分析放到后台跑
      try {
        startAnalysis(record.id);
      } catch {}
      res.json({ item: getMistake(record.id), analyzing: true });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });
});

router.post('/mistakes/scan', (req, res) => {
  uploader.single('image')(req, res, async (uploadError) => {
    if (uploadError) {
      const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: tooBig ? '图片不能超过 10MB' : '图片上传失败' });
    }
    if (!req.file) return res.status(400).json({ error: '请先选择一张照片' });
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: '图片不能超过 10MB' });
    }
    let saved = null;
    try {
      saved = saveImage(req.file.path, req.file.originalname);
      const scan = await scanPhoto({
        image: saved.image,
        subject: String(req.body?.subject || '').trim(),
        note: String(req.body?.note || '').trim(),
      });
      res.json({ scan: { id: scan.id, questions: scan.questions } });
    } catch (error) {
      if (saved?.image) {
        try {
          fs.rmSync(imagePath(saved.image), { force: true });
        } catch {}
      }
      res.status(400).json({ error: error.message });
    }
  });
});

router.post('/mistakes/scan/:id/confirm', (req, res) => {
  try {
    const items = confirmScan(req.params.id, req.body?.indexes);
    res.json({ items });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.delete('/mistakes/scan/:id', (req, res) => {
  discardScan(req.params.id);
  res.json({ ok: true });
});

router.patch('/mistakes/:id', (req, res) => {
  try {
    res.json({ item: updateMistake(req.params.id, req.body || {}) });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/mistakes/:id/analyze', (req, res) => {
  try {
    res.json({ item: startAnalysis(req.params.id) });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.delete('/mistakes/:id', (req, res) => {
  try {
    deleteMistake(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.get('/mistakes/:id/image', (req, res) => {
  const item = getMistake(req.params.id);
  if (!item?.image) return res.status(404).json({ error: '图片不存在' });
  res.setHeader('Content-Type', imageMime(item.image));
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(imagePath(item.image));
});

router.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});