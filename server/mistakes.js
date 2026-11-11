import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './store.js';
import { chat, parseJSON } from './ai.js';

const MISTAKES_PATH = path.join(DATA_DIR, 'mistakes.json');
const IMG_DIR = path.join(DATA_DIR, 'mistakes-images');

const IMAGE_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

let cache = null;

function ensure() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(MISTAKES_PATH, 'utf8'));
  } catch {
    cache = { items: [] };
  }
  if (!Array.isArray(cache.items)) cache.items = [];
  return cache;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MISTAKES_PATH, JSON.stringify(cache, null, 2));
}

export function initMistakes() {
  const data = ensure();
  fs.mkdirSync(IMG_DIR, { recursive: true });
  // 进程重启后，上次没跑完的分析标记要清掉，否则界面会一直显示「分析中」
  let changed = false;
  for (const item of data.items) {
    if (item.analyzing) {
      item.analyzing = false;
      item.analysisError = item.analysisError || '上次分析中断了，可以点「重新 AI 分析」再试';
      changed = true;
    }
  }
  if (changed) save();
}

export function listMistakes() {
  return [...ensure().items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getMistake(id) {
  return ensure().items.find((item) => item.id === id) || null;
}

// 保存拍照上传的图片，返回 { image, mime }
export function saveImage(tempPath, originalName) {
  const ext = String(originalName || 'photo.jpg')
    .split('.')
    .pop()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const mime = IMAGE_MIME[ext];
  if (!mime) throw new Error('只支持 jpg / png / webp / gif / heic 图片');
  const id = `m_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const fileName = `${id}.${ext}`;
  fs.renameSync(tempPath, path.join(IMG_DIR, fileName));
  return { image: fileName, mime };
}

export function imagePath(fileName) {
  return path.join(IMG_DIR, path.basename(String(fileName)));
}

export function imageMime(fileName) {
  const ext = String(fileName).split('.').pop().toLowerCase();
  return IMAGE_MIME[ext] || 'image/jpeg';
}

export function addMistake({ subject, question, note, image } = {}) {
  const hasText = String(question || '').trim();
  if (!image && !hasText) return null;
  const item = {
    id: `m_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    subject: String(subject || ''),
    question: String(question || '').trim().slice(0, 4000),
    note: String(note || '').trim().slice(0, 500),
    answer: '',
    cause: '',
    advice: '',
    points: [],
    image: image?.image || null,
    status: 'open',
    analyzing: false,
    analysisError: '',
    analyzedAt: null,
    createdAt: new Date().toISOString(),
  };
  ensure().items.push(item);
  save();
  return item;
}

export function updateMistake(id, patch = {}) {
  const item = getMistake(id);
  if (!item) {
    const error = new Error('错题不存在');
    error.status = 404;
    throw error;
  }
  if (['open', 'mastered'].includes(patch.status)) item.status = patch.status;
  if (typeof patch.note === 'string') item.note = patch.note.trim().slice(0, 500);
  if (typeof patch.subject === 'string' && patch.subject) item.subject = patch.subject;
  save();
  return item;
}

export function deleteMistake(id) {
  const data = ensure();
  const index = data.items.findIndex((item) => item.id === id);
  if (index === -1) {
    const error = new Error('错题不存在');
    error.status = 404;
    throw error;
  }
  const [item] = data.items.splice(index, 1);
  save();
  if (item.image) {
    // 同一张照片可能被拆成多道题共用，还有别的记录引用时不要删图
    const stillUsed = data.items.some((other) => other.image === item.image);
    if (!stillUsed) {
      try {
        fs.rmSync(imagePath(item.image), { force: true });
      } catch {}
    }
  }
}

// AI 分析：拍照识题 + 答案 + 错因 + 知识点
export async function analyzeMistake(id, subjectName = '') {
  const item = getMistake(id);
  if (!item) {
    const error = new Error('错题不存在');
    error.status = 404;
    throw error;
  }
  if (!item.image && !item.question) throw new Error('没有题目内容可分析');

  const context = [
    item.subject ? `科目：${subjectName || item.subject}` : '',
    item.note ? `学生备注（可能是他自己的答案或错在哪）：${item.note}` : '',
  ]
    .filter(Boolean)
    .join('；');

  // 已经有题目文字时按文字分析，避免把整张照片再识别成别的题
  const useImage = Boolean(item.image) && !String(item.question || '').trim();

  const messages = [
    {
      role: 'system',
      content:
        '你是初三学生的错题分析老师。根据错题照片或题目文字，输出严格 JSON，不要代码块。格式：{"question":"题目原文，完整抄录并保留数学符号与选项","answer":"正确答案与关键步骤，简洁准确","cause":"错因分析：结合学生备注推断可能错在哪（看错条件、概念混淆、计算失误、思路不清等），不超过60字","advice":"针对这个错因的练习建议，不超过40字","points":["知识点",最多4个]}。如果照片里能看到学生的作答和红笔批改，据此判断错因；看不清的部分如实说。',
    },
    {
      role: 'user',
      content: useImage
        ? [
            { type: 'text', text: `${context || '请分析这张错题照片'}。请提取题目并分析。` },
            { type: 'image_url', image_url: { url: imageDataUrl(item.image) } },
          ]
        : `${context ? `${context}。` : ''}题目：${item.question}`,
    },
  ];

  const content = await chat(messages, { timeout: 120000, maxTokens: 2400 });
  const parsed = parseJSON(content);

  applyParsed(item, parsed);
  item.analyzedAt = new Date().toISOString();
  save();
  return item;
}

function applyParsed(item, parsed = {}) {
  item.question = String(parsed.question || '').trim().slice(0, 4000) || item.question;
  item.answer = String(parsed.answer || '').trim().slice(0, 1200);
  item.cause = String(parsed.cause || '').trim().slice(0, 120);
  item.advice = String(parsed.advice || '').trim().slice(0, 100);
  item.points = Array.isArray(parsed.points)
    ? parsed.points.map((p) => String(p).trim()).filter(Boolean).slice(0, 4)
    : [];
}

// 一张照片里可能有多道题：让 AI 逐题识别并各自给答案/错因
async function analyzePhotoQuestions(item) {
  const context = [
    item.subject ? `科目：${item.subject}` : '',
    item.note ? `学生备注：${item.note}` : '',
  ]
    .filter(Boolean)
    .join('；');

  const content = await chat(
    [
      {
        role: 'system',
        content:
          '你是初三学生的错题整理老师。照片里可能有多道独立题目，且带批改痕迹（红叉、圈错、打勾、订正）。请逐题识别并判断对错，只输出严格 JSON，不要代码块。格式：{"questions":[{"question":"题目原文，完整抄录题号、题干、选项","verdict":"wrong 或 right 或 unknown","answer":"正确答案与关键步骤","cause":"错因分析，不超过60字","advice":"练习建议，不超过40字","points":["知识点",最多4个]}]}。判断规则：被红叉/圈错/打×/红笔订正/扣分的记为 wrong；被打勾或明显答对且无扣分的记为 right；看不清批改的记为 unknown。收录规则：wrong 的题目必须完整给出；right 的题目只填 question 和 verdict，其余字段留空。一道大题下的(1)(2)小问算同一道；页眉页脚、笔记、涂鸦不算题目；不要编造照片里没有的题目。',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${context ? `${context}。` : ''}请逐题识别这张照片里的题目，判断每题对错并分析错题。` },
          { type: 'image_url', image_url: { url: imageDataUrl(item.image) } },
        ],
      },
    ],
    { timeout: 150000, maxTokens: 3600 }
  );

  const parsed = parseJSON(content);
  const list = Array.isArray(parsed.questions) ? parsed.questions : [];
  return list
    .filter((q) => q && String(q.question || '').trim())
    .map((q) => ({ ...q, verdict: normalizeVerdict(q.verdict) }));
}

function normalizeVerdict(value) {
  const text = String(value || '').toLowerCase();
  if (/wrong|incorrect|false|错|x|×|✗/.test(text)) return 'wrong';
  if (/right|correct|true|对|√|✓/.test(text)) return 'right';
  return 'unknown';
}

// ---------- 拍照识别 → 人工勾选 → 录入 ----------

const scans = new Map();

// 只识别不落库，返回题目列表让用户确认
export async function scanPhoto({ image, subject = '', note = '' }) {
  const questions = await analyzePhotoQuestions({ image, subject, note });
  if (!questions.length) throw new Error('照片里没识别到题目，换一张更清晰的试试');

  const id = `s_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const scan = { id, image, subject, note, questions, createdAt: Date.now() };
  scans.set(id, scan);
  const timer = setTimeout(() => discardScan(id), 30 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  return scan;
}

export function discardScan(id) {
  const scan = scans.get(id);
  if (!scan) return;
  scans.delete(id);
  const used = ensure().items.some((item) => item.image === scan.image);
  if (!used) {
    try {
      fs.rmSync(imagePath(scan.image), { force: true });
    } catch {}
  }
}

// 按用户勾选的序号生成错题记录
export function confirmScan(id, indexes) {
  const scan = scans.get(id);
  if (!scan) {
    const error = new Error('这次识别已过期，请重新上传照片');
    error.status = 404;
    throw error;
  }
  const picks = (Array.isArray(indexes) ? indexes : [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < scan.questions.length);
  if (!picks.length) {
    const error = new Error('至少勾选一道错题');
    error.status = 400;
    throw error;
  }

  const data = ensure();
  const items = picks.map((index) => {
    const record = {
      id: `m_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      subject: scan.subject,
      note: scan.note,
      question: '',
      answer: '',
      cause: '',
      advice: '',
      points: [],
      image: scan.image,
      status: 'open',
      analyzing: false,
      analysisError: '',
      analyzedAt: new Date().toISOString(),
      fromScan: true,
      splitCount: picks.length,
      skippedCorrect: scan.questions.length - picks.length,
      createdAt: new Date().toISOString(),
    };
    applyParsed(record, scan.questions[index]);
    data.items.push(record);
    return record;
  });
  save();
  scans.delete(id);
  return items;
}

const running = new Set();

// 后台分析：立刻返回，AI 跑完再写回结果，前端轮询拿状态
export function startAnalysis(id) {
  const item = getMistake(id);
  if (!item) {
    const error = new Error('错题不存在');
    error.status = 404;
    throw error;
  }
  if (!item.image && !item.question) throw new Error('没有题目内容可分析');
  if (running.has(id)) return item;

  running.add(id);
  item.analyzing = true;
  item.analysisError = '';
  save();

  (async () => {
    try {
      await analyzeMistake(id);
      const fresh = getMistake(id);
      if (fresh) {
        fresh.analysisError = '';
        save();
      }
    } catch (error) {
      const fresh = getMistake(id);
      if (fresh) {
        fresh.analysisError = error?.message || '分析失败';
        save();
      }
    } finally {
      const fresh = getMistake(id);
      if (fresh) {
        fresh.analyzing = false;
        save();
      }
      running.delete(id);
    }
  })();

  return getMistake(id);
}

function imageDataUrl(fileName) {
  const abs = imagePath(fileName);
  const size = fs.statSync(abs).size;
  if (size > 10 * 1024 * 1024) throw new Error('图片超过 10MB，无法识别');
  const buffer = fs.readFileSync(abs);
  return `data:${imageMime(fileName)};base64,${buffer.toString('base64')}`;
}
