import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './store.js';
import { chat, parseJSON } from './ai.js';

const FILE = path.join(DATA_DIR, 'exams.json');

const DEFAULT_SUBJECTS = [
  { key: 'chinese', name: '语文', full: 120, target: 100, color: '#c2410c' },
  { key: 'math', name: '数学', full: 120, target: 108, color: '#1d4ed8' },
  { key: 'english', name: '英语', full: 120, target: 105, color: '#0e7490' },
  { key: 'physics', name: '物理', full: 100, target: 88, color: '#6d28d9' },
  { key: 'chemistry', name: '化学', full: 100, target: 88, color: '#0f766e' },
  { key: 'politics', name: '政治', full: 50, target: 43, color: '#b45309' },
  { key: 'history', name: '历史', full: 50, target: 43, color: '#9d174d' },
  { key: 'pe', name: '体育', full: 60, target: 56, color: '#15803d' },
];

const DEFAULT_HOLIDAYS = [
  { date: '2027-01-01', name: '元旦' },
  { date: '2027-01-02', name: '元旦假期' },
  { date: '2027-01-03', name: '元旦假期' },
  { date: '2027-02-05', name: '春节假期' },
  { date: '2027-02-06', name: '春节' },
  { date: '2027-02-07', name: '春节假期' },
  { date: '2027-02-08', name: '春节假期' },
  { date: '2027-02-09', name: '春节假期' },
  { date: '2027-02-10', name: '春节假期' },
  { date: '2027-02-11', name: '春节假期' },
  { date: '2027-04-03', name: '清明假期' },
  { date: '2027-04-04', name: '清明假期' },
  { date: '2027-04-05', name: '清明' },
  { date: '2027-05-01', name: '劳动节' },
  { date: '2027-05-02', name: '劳动节假期' },
  { date: '2027-05-03', name: '劳动节假期' },
  { date: '2027-05-04', name: '劳动节假期' },
  { date: '2027-05-05', name: '劳动节假期' },
  { date: '2027-06-09', name: '端午假期' },
  { date: '2027-06-10', name: '端午假期' },
  { date: '2027-06-11', name: '端午' },
];

const PLAN_TYPES = ['知识梳理', '专题训练', '错题复盘'];
const SUBJECT_LEVELS = ['weak', 'normal', 'strong'];
const LEVEL_WEIGHT = { weak: 1.5, normal: 1, strong: 0.6 };
const LEVEL_NAMES = { weak: '弱科', normal: '普通', strong: '强科' };

const DEFAULT_MATERIALS = [
  { key: 'wenyan', name: '文言文练习册', subject: 'chinese' },
  { key: 'morning_reading', name: '语文早读材料', subject: 'chinese' },
  { key: 'math_peiyou', name: '数学培优新方法', subject: 'math' },
  { key: 'physics_peiyou', name: '物理培优新方法', subject: 'physics' },
  { key: 'english_wanwei', name: '英语阅读万维', subject: 'english' },
  { key: 'english_victor', name: '维克多英语阅读', subject: 'english' },
  { key: 'politics_outline', name: '政治提纲', subject: 'politics' },
  { key: 'history_outline', name: '历史提纲', subject: 'history' },
];

let state = null;

function defaultState() {
  return {
    settings: {
      subjects: DEFAULT_SUBJECTS.map((item) => ({ ...item })),
      holidays: DEFAULT_HOLIDAYS.map((item) => ({ ...item })),
      materials: DEFAULT_MATERIALS.map((item) => ({ ...item })),
      dailyMinutes: 90,
      dailySubjects: 3,
    },
    exams: [
      {
        id: 'exam_zhongkao_2027',
        name: '2027 中考',
        date: '2027-06-26',
        kind: '中考',
        note: '日期按往年估算，请按学校通知在“成绩记录”里修改',
        subjects: DEFAULT_SUBJECTS.map((item) => item.key),
        scores: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    plan: null,
    packing: {},
  };
}

function normalize(data) {
  const base = defaultState();
  const next = data && typeof data === 'object' ? data : {};
  next.settings = { ...base.settings, ...(next.settings || {}) };
  if (!Array.isArray(next.settings.subjects) || !next.settings.subjects.length) {
    next.settings.subjects = base.settings.subjects;
  }
  next.settings.subjects = next.settings.subjects.map((item) => ({
    level: 'normal',
    ...item,
    level: SUBJECT_LEVELS.includes(item?.level) ? item.level : 'normal',
  }));
  if (!Array.isArray(next.settings.holidays)) next.settings.holidays = [];

  const subjectsPerDay = Number(next.settings.dailySubjects);
  next.settings.dailySubjects = Number.isFinite(subjectsPerDay)
    ? Math.min(8, Math.max(0, Math.round(subjectsPerDay)))
    : 3;
  delete next.settings.dayPlans;
  delete next.settings.dayMinutes;
  delete next.settings.dailyTime;
  if (!Array.isArray(next.settings.materials)) next.settings.materials = base.settings.materials;
  if (!Array.isArray(next.exams)) next.exams = base.exams;
  next.exams = next.exams.map((exam) => ({
    scores: {},
    subjects: [],
    ...exam,
  }));
  if (!next.plan || typeof next.plan !== 'object') next.plan = null;
  if (!next.packing || typeof next.packing !== 'object') next.packing = {};
  return next;
}

function save() {
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function initExams() {
  try {
    state = normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    state = defaultState();
  }
  save();
}

function ensure() {
  if (!state) initExams();
  return state;
}

export function getExamData() {
  return ensure();
}

export function updateSettings(patch = {}) {
  const data = ensure();
  const next = { ...data.settings };

  if (Array.isArray(patch.subjects)) {
    next.subjects = patch.subjects
      .filter((item) => item && item.key && item.name)
      .map((item, index) => ({
        key: String(item.key),
        name: String(item.name).slice(0, 20),
        full: Math.max(1, Number(item.full) || 100),
        target: Math.max(0, Number(item.target) || 0),
        color: item.color || DEFAULT_SUBJECTS[index % DEFAULT_SUBJECTS.length].color,
        level: SUBJECT_LEVELS.includes(item.level) ? item.level : 'normal',
      }));
  }
  if (Array.isArray(patch.holidays)) {
    next.holidays = patch.holidays
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || '')))
      .map((item) => ({ date: String(item.date), name: String(item.name || '假期').slice(0, 20) }));
  }
  if (Array.isArray(patch.materials)) {
    const seen = new Set();
    next.materials = patch.materials
      .filter((item) => {
        if (!item || !item.key || !item.name) return false;
        const key = String(item.key);
        if (seen.has(key)) return false;
        if (!next.subjects.some((subject) => subject.key === item.subject)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 40)
      .map((item) => ({
        key: String(item.key),
        name: String(item.name).slice(0, 30),
        subject: String(item.subject),
      }));
  }
  if (patch.dailyMinutes != null) {
    next.dailyMinutes = Math.min(600, Math.max(30, Number(patch.dailyMinutes) || 90));
  }
  if (patch.dailySubjects != null) {
    next.dailySubjects = Math.min(8, Math.max(0, Math.round(Number(patch.dailySubjects) || 0)));
  }

  data.settings = next;
  save();
  return data.settings;
}


export function addExam(input = {}) {
  const data = ensure();
  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error('请选择考试日期');
    error.status = 400;
    throw error;
  }
  const exam = {
    id: `exam_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    name: String(input.name || '考试').slice(0, 40),
    date,
    kind: String(input.kind || '模考').slice(0, 10),
    note: String(input.note || '').slice(0, 200),
    subjects:
      Array.isArray(input.subjects) && input.subjects.length
        ? input.subjects.filter((key) => data.settings.subjects.some((item) => item.key === key))
        : data.settings.subjects.map((item) => item.key),
    scores: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.exams.push(exam);
  data.exams.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  save();
  return exam;
}

export function updateExam(id, patch = {}) {
  const data = ensure();
  const exam = data.exams.find((item) => item.id === id);
  if (!exam) {
    const error = new Error('考试不存在');
    error.status = 404;
    throw error;
  }
  if (patch.name != null) exam.name = String(patch.name).slice(0, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(patch.date || ''))) {
    const nextDate = String(patch.date);
    if (nextDate !== exam.date && data.plan?.examId === id) data.plan = null;
    exam.date = nextDate;
  }
  if (patch.kind != null) exam.kind = String(patch.kind).slice(0, 10);
  if (patch.note != null) exam.note = String(patch.note).slice(0, 200);
  if (Array.isArray(patch.subjects)) {
    exam.subjects = patch.subjects.filter((key) => data.settings.subjects.some((item) => item.key === key));
  }
  if (patch.scores && typeof patch.scores === 'object') {
    const scores = { ...exam.scores };
    for (const subject of data.settings.subjects) {
      const value = patch.scores[subject.key];
      if (!value) continue;
      if (value.score === '' || value.score == null) {
        delete scores[subject.key];
        continue;
      }
      const score = Number(value.score);
      if (!Number.isFinite(score)) {
        delete scores[subject.key];
        continue;
      }
      scores[subject.key] = {
        score: Math.max(0, score),
        full: Math.max(1, Number(value.full) || subject.full),
        classAvg: Number.isFinite(Number(value.classAvg)) && value.classAvg !== '' ? Number(value.classAvg) : null,
        rank: Number.isFinite(Number(value.rank)) && value.rank !== '' ? Number(value.rank) : null,
        note: String(value.note || '').slice(0, 200),
      };
    }
    exam.scores = scores;
  }
  exam.updatedAt = new Date().toISOString();
  data.exams.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  save();
  return exam;
}

export function removeExam(id) {
  const data = ensure();
  const index = data.exams.findIndex((item) => item.id === id);
  if (index === -1) {
    const error = new Error('考试不存在');
    error.status = 404;
    throw error;
  }
  data.exams.splice(index, 1);
  if (data.plan && data.plan.examId === id) data.plan = null;
  save();
  return true;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function rateFromScores(data, exam) {
  const rates = {};
  for (const examItem of data.exams) {
    if (examItem.id === exam.id) continue;
    for (const subject of data.settings.subjects) {
      const entry = examItem.scores?.[subject.key];
      if (!entry || !entry.full) continue;
      const rate = entry.score / entry.full;
      (rates[subject.key] ||= []).push(rate);
    }
  }
  const result = {};
  for (const subject of data.settings.subjects) {
    const list = rates[subject.key] || [];
    result[subject.key] = list.length
      ? list.reduce((sum, value) => sum + value, 0) / list.length
      : subject.target / subject.full;
  }
  return result;
}

function pickSubjects(subjects, rates, count, dayIndex, counts, aiWeights = {}) {
  const scored = subjects
    .map((subject, index) => {
      const rate = Math.min(0.99, Math.max(0.2, rates[subject.key] ?? 0.75));
      const weight = Math.max(0.5, 1.7 - rate);
      const levelW = LEVEL_WEIGHT[subject.level] || 1;
      const aiW = Math.min(2.2, Math.max(0.4, Number(aiWeights[subject.key]) || 1));
      const used = counts?.[subject.key] || 0;
      const decay = 1 / (1 + used * 0.22);
      const rotate = 0.9 + 0.2 * (((dayIndex + index * 2) % 7) / 6);
      return { subject, priority: weight * levelW * aiW * decay * rotate };
    })
    .sort((a, b) => b.priority - a.priority);

  // 先保证每个科目都至少被安排到一次，再按优先级轮换
  const unseen = scored.filter((item) => !(counts?.[item.subject.key] || 0));
  const ordered = unseen.length
    ? [...unseen, ...scored.filter((item) => !unseen.includes(item))]
    : scored;

  return ordered.slice(0, Math.min(count, ordered.length)).map((item) => item.subject);
}

// AI 智能分析：根据强弱科、历史得分率、剩余天数产出训练权重与重点
async function aiStrategy(data, exam, subjects, rates, stat) {
  const subjectLines = subjects
    .map((subject) => {
      const rate = rates[subject.key];
      const entry = `满分 ${subject.full}，目标 ${subject.target}（${pctText(subject.target / subject.full)}）`;
      const level = LEVEL_NAMES[subject.level] || '普通';
      const score = Number.isFinite(rate) ? `历史平均得分率 ${pctText(rate)}` : '暂无成绩记录';
      return `- ${subject.key}（${subject.name}）：${entry}，${score}，用户标记为「${level}」`;
    })
    .join('\n');

  const content = await chat(
    [
      {
        role: 'system',
        content:
          '你是初三学生的复习规划师。根据学生标记的强弱科、历史得分率、距离考试的剩余天数和可复习时间，为每科给出复习权重与训练重点。只输出严格 JSON，不要代码块。格式：{"summary":"不超过60字的总体策略","subjects":[{"key":"科目key","weight":1.2,"focus":"不超过24字的训练重点"}]}。weight 取 0.4~2.2：越需要加强越大；用户标记的弱科应明显偏大，强科偏小；key 必须用给定清单里的 key。',
      },
      {
        role: 'user',
        content: `目标考试：${exam.name}（${exam.date}，还有 ${stat.daysLeft} 天）\n可复习日：周末与假期约 ${stat.studyDays} 天，每天 ${stat.dailyMinutes} 分钟${
          stat.dailySubjects ? `、约 ${stat.dailySubjects} 科` : ''
        }，考前 14 天转套卷错题、考前 3 天回归课本。\n科目清单：\n${subjectLines}`,
      },
    ],
    { timeout: 90000, maxTokens: 1600 }
  );

  const parsed = parseJSON(content);
  const weights = {};
  const focus = {};
  for (const item of Array.isArray(parsed.subjects) ? parsed.subjects : []) {
    if (!item?.key) continue;
    weights[item.key] = Number(item.weight) || 1;
    focus[item.key] = String(item.focus || '').slice(0, 40);
  }
  return {
    summary: String(parsed.summary || '').slice(0, 120),
    weights,
    focus,
  };
}

function pctText(rate) {
  return `${Math.round((Number(rate) || 0) * 100)}%`;
}

export async function generatePlan(examId, options = {}) {
  const data = ensure();
  const exam = data.exams.find((item) => item.id === examId);
  if (!exam) {
    const error = new Error('考试不存在');
    error.status = 404;
    throw error;
  }

  const today = startOfDay(options.today || new Date());
  const examDay = startOfDay(exam.date);
  if (examDay <= today) {
    const error = new Error('这场考试的日期已过或就是今天，无法生成计划');
    error.status = 400;
    throw error;
  }

  const holidayMap = new Map(data.settings.holidays.map((item) => [item.date, item.name]));
  const subjects = data.settings.subjects.filter((item) => !exam.subjects?.length || exam.subjects.includes(item.key));
  const rates = rateFromScores(data, exam);

  let studyDays = 0;
  for (let cursor = new Date(today); cursor < examDay; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay();
    if (weekday === 0 || weekday === 6 || holidayMap.get(dateKey(cursor))) studyDays += 1;
  }

  // AI 智能排期：可选；失败时自动回退本地算法
  let strategy = null;
  if (options.useAI) {
    try {
      strategy = await aiStrategy(data, exam, subjects, rates, {
        daysLeft: Math.round((examDay - today) / 86400000),
        studyDays,
        dailyMinutes: data.settings.dailyMinutes,
        dailySubjects: data.settings.dailySubjects,
      });
    } catch (err) {
      strategy = {
        summary: `AI 分析没能完成（${err.message}），本次按强弱科与得分率的本地算法排期`,
        weights: {},
        focus: {},
        fallback: true,
      };
    }
  }
  const aiWeights = strategy?.weights || {};

  const materialPools = {};
  for (const material of data.settings.materials || []) {
    if (!material?.key || !material?.name) continue;
    (materialPools[material.subject] ||= []).push(material);
  }
  const materialUse = {};
  const tasks = [];
  const days = [];
  const counts = {};
  let dayIndex = 0;

  for (let cursor = new Date(today); cursor < examDay; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor);
    const weekday = cursor.getDay();
    const holidayName = holidayMap.get(key) || '';
    const isWeekend = weekday === 0 || weekday === 6;
    const daysLeft = Math.round((examDay - cursor) / 86400000);

    // 上学日（周一至周五且不是法定假期）不安排复习
    if (!isWeekend && !holidayName) {
      dayIndex += 1;
      continue;
    }

    const isHoliday = Boolean(holidayName);
    const targetMinutes = Math.round(Number(data.settings.dailyMinutes) || 90);

    const perDay = Number(data.settings.dailySubjects);
    let count = Number.isFinite(perDay) && perDay > 0 ? perDay : isHoliday ? 4 : 3;
    if (daysLeft <= 3) count = 2;
    count = Math.max(1, Math.min(count, Math.floor(targetMinutes / 10), subjects.length));
    const minutes = Math.max(10, Math.round(targetMinutes / count));

    let types;
    if (daysLeft <= 3) types = ['回归课本', '错题速览'];
    else if (daysLeft <= 14) types = ['限时套卷', '错题复盘'];
    else types = PLAN_TYPES;

    const picked = pickSubjects(subjects, rates, count, dayIndex, counts, aiWeights);
    for (const subject of picked) counts[subject.key] = (counts[subject.key] || 0) + 1;
    const dayTasks = picked.map((subject, index) => {
      const type = subject.key === 'pe' ? '体能训练' : types[(dayIndex + index) % types.length];
      const pool = materialPools[subject.key] || [];
      const material = pool.length
        ? pool
            .slice()
            .sort(
              (a, b) =>
                (materialUse[a.key] || 0) - (materialUse[b.key] || 0) || a.key.localeCompare(b.key)
            )[0]
        : null;
      if (material) materialUse[material.key] = (materialUse[material.key] || 0) + 1;
      const title = material
        ? material.name.startsWith(subject.name)
          ? material.name
          : `${subject.name} · ${material.name}`
        : `${subject.name} · ${type}`;
      return {
        id: `task_${key}_${subject.key}_${index}`,
        date: key,
        subject: subject.key,
        subjectName: subject.name,
        material: material?.name || '',
        materialKey: material?.key || '',
        title,
        type,
        minutes,
        done: false,
      };
    });

    tasks.push(...dayTasks);
    days.push({
      date: key,
      holiday: isHoliday || isWeekend,
      holidayName: holidayName || '周末',
      daysLeft,
      minutes: dayTasks.reduce((sum, task) => sum + task.minutes, 0),
    });
    dayIndex += 1;
  }

  if (!tasks.length) {
    const error = new Error('从现在到考试之间没有周末或假期，无法安排复习任务');
    error.status = 400;
    throw error;
  }

  data.plan = {
    examId,
    examName: exam.name,
    examDate: exam.date,
    generatedAt: new Date().toISOString(),
    aiStrategy: strategy
      ? { summary: strategy.summary, focus: strategy.focus, fallback: Boolean(strategy.fallback), usedAI: !strategy.fallback }
      : null,
    days,
    tasks,
  };
  save();
  return data.plan;
}

export function toggleTask(taskId, done) {
  const data = ensure();
  if (!data.plan) {
    const error = new Error('还没有生成复习计划');
    error.status = 400;
    throw error;
  }
  const task = data.plan.tasks.find((item) => item.id === taskId);
  if (!task) {
    const error = new Error('任务不存在');
    error.status = 404;
    throw error;
  }
  task.done = Boolean(done);
  save();
  return data.plan;
}

// 把任务移动到任意一天（包括原本不排任务的上学日）
export function moveTask(taskId, newDate) {
  const data = ensure();
  if (!data.plan) {
    const error = new Error('还没有生成复习计划');
    error.status = 400;
    throw error;
  }
  const task = data.plan.tasks.find((item) => item.id === taskId);
  if (!task) {
    const error = new Error('任务不存在');
    error.status = 404;
    throw error;
  }
  const date = String(newDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error('日期格式不正确');
    error.status = 400;
    throw error;
  }
  if (date > data.plan.examDate) {
    const error = new Error('不能安排到考试之后');
    error.status = 400;
    throw error;
  }
  if (date === task.date) return data.plan;

  const recompute = (day) => {
    day.minutes = data.plan.tasks
      .filter((item) => item.date === day.date)
      .reduce((sum, item) => sum + (item.minutes || 0), 0);
  };
  for (const day of data.plan.days) recompute(day);

  task.date = date;

  let day = data.plan.days.find((item) => item.date === date);
  if (!day) {
    const daysLeft = Math.round((startOfDay(data.plan.examDate) - startOfDay(date)) / 86400000);
    day = { date, holiday: true, holidayName: '手动安排', daysLeft, minutes: 0 };
    data.plan.days.push(day);
    data.plan.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  recompute(day);
  save();
  return data.plan;
}

export function togglePacking(week, key, packed) {
  const data = ensure();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week || '')) || !key) {
    const error = new Error('清单参数不合法');
    error.status = 400;
    throw error;
  }
  if (!data.packing || typeof data.packing !== 'object') data.packing = {};
  if (!data.packing[week]) data.packing[week] = {};
  if (packed) data.packing[week][key] = true;
  else delete data.packing[week][key];
  if (!Object.keys(data.packing[week]).length) delete data.packing[week];

  // 只保留最近 60 天的勾选记录
  const keepFrom = dateKey(new Date(Date.now() - 60 * 86400000));
  for (const weekKey of Object.keys(data.packing)) {
    if (weekKey < keepFrom) delete data.packing[weekKey];
  }
  save();
  return data.packing;
}
