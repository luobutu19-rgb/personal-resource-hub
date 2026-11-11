import { toast } from './toast.js';

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const KINDS = ['中考', '一模', '二模', '月考', '周测', '其他'];
const THEME_LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };

const state = {
  data: null,
  tab: 'overview',
  planExamId: null,
  planRange: 14,
  planFilter: 'all',
  planSubject: 'all',
  scoreExamId: null,
  mistakes: [],
  mistakeSubject: 'all',
  mistakeStatus: 'all',
};

const panel = {
  overview: document.getElementById('panel-overview'),
  plan: document.getElementById('panel-plan'),
  scores: document.getElementById('panel-scores'),
  mistakes: document.getElementById('panel-mistakes'),
  settings: document.getElementById('panel-settings'),
};
const modalRoot = document.getElementById('modalRoot');

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])
  );
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

// ---------- 日期与统计 ----------

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDay(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(key, amount) {
  const date = parseDay(key);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function diffDays(key) {
  return Math.round((parseDay(key) - parseDay(dateKey())) / 86400000);
}

function formatDate(key) {
  const date = parseDay(key);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatFull(key) {
  const date = parseDay(key);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekdayName(key) {
  return WEEK[parseDay(key).getDay()];
}

function pct(rate) {
  return `${Math.round((Number(rate) || 0) * 100)}%`;
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function subjects() {
  return state.data?.settings?.subjects || [];
}

function subjectColor(key) {
  return subjects().find((item) => item.key === key)?.color || 'var(--accent)';
}

function sortedExams() {
  return [...(state.data?.exams || [])].sort((a, b) => a.date.localeCompare(b.date));
}

function examById(id) {
  return (state.data?.exams || []).find((item) => item.id === id) || null;
}

function upcomingExam() {
  const today = dateKey();
  return sortedExams().find((exam) => exam.date >= today) || null;
}

function examSubjects(exam) {
  const keys = exam?.subjects?.length ? exam.subjects : subjects().map((item) => item.key);
  return subjects().filter((item) => keys.includes(item.key));
}

function examTotal(exam) {
  let total = 0;
  let full = 0;
  let target = 0;
  let count = 0;
  for (const subject of examSubjects(exam)) {
    const entry = exam.scores?.[subject.key];
    if (!entry) continue;
    const entryFull = entry.full || subject.full;
    total += entry.score;
    full += entryFull;
    target += Math.round(subject.target * (entryFull / subject.full));
    count += 1;
  }
  return { total, full, target, count, rate: full ? total / full : 0 };
}

function referenceExam() {
  const scored = sortedExams().filter((exam) => examTotal(exam).count > 0);
  return scored.length ? scored[scored.length - 1] : null;
}

function adviceFor(rate) {
  if (rate < 0.6) return '先回归课本与基础题，每天做一组基础专项';
  if (rate < 0.75) return '按专题刷题，把同类型错题整理成模板';
  return '用套卷练速度与稳定性，错题当天复盘';
}

function isSchoolDay(key) {
  const weekday = parseDay(key).getDay();
  if (weekday === 0 || weekday === 6) return false;
  return !(state.data?.settings?.holidays || []).some((holiday) => holiday.date === key);
}

function materials() {
  return state.data?.settings?.materials || [];
}

// 下一个周五（含当天）：周日看到的是 5 天后的周五
function nextFridayKey() {
  const today = parseDay(dateKey());
  const delta = (5 - today.getDay() + 7) % 7;
  return dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta));
}

// ---------- 加载与渲染入口 ----------

async function load() {
  state.data = await api('/api/exams');
  state.holidayDraft = [...(state.data.settings?.holidays || [])];
  const exams = state.data.exams || [];
  if (!state.planExamId || !exams.some((exam) => exam.id === state.planExamId)) {
    state.planExamId =
      state.data.plan?.examId || upcomingExam()?.id || exams[exams.length - 1]?.id || null;
  }
  if (state.planSubject !== 'all' && !subjects().some((item) => item.key === state.planSubject)) {
    state.planSubject = 'all';
  }
  if (state.scoreExamId && !exams.some((exam) => exam.id === state.scoreExamId)) {
    state.scoreExamId = null;
  }
  renderAll();
  refreshMistakes();
}

function renderAll() {
  renderStats();
  renderOverview();
  renderPlan();
  renderScores();
  renderMistakes();
  renderSettings();
}

async function refreshMistakes() {
  try {
    const data = await api('/api/mistakes');
    state.mistakes = data.items || [];
  } catch {
    state.mistakes = state.mistakes || [];
  }
  renderMistakes();
  if (state.mistakes.some((item) => item.analyzing)) startMistakePoll();
  trackSplits(state.mistakes);
}

// 分析完成时如果一张图拆出了多道题，提示一下
const seenAnalyzing = new Set();

function trackSplits(list) {
  for (const item of list) {
    if (item.analyzing) {
      seenAnalyzing.add(item.id);
      continue;
    }
    if (seenAnalyzing.has(item.id)) {
      seenAnalyzing.delete(item.id);
      const parts = [];
      if (item.splitCount > 1) parts.push(`照片里识别到 ${item.splitCount} 道错题，已自动拆成 ${item.splitCount} 条`);
      if (item.skippedCorrect) parts.push(`跳过 ${item.skippedCorrect} 道已做对的`);
      if (parts.length) toast(parts.join('，'));
    }
  }
}

function renderStats() {
  const exam = upcomingExam();
  const daysNode = document.getElementById('statDays');
  const planNode = document.getElementById('statPlan');
  if (daysNode) daysNode.textContent = exam ? String(Math.max(0, diffDays(exam.date))) : '--';

  const tasks = state.data?.plan?.tasks || [];
  const done = tasks.filter((task) => task.done).length;
  if (planNode) planNode.textContent = tasks.length ? `${Math.round((done / tasks.length) * 100)}%` : '0%';
}

// ---------- 总览 ----------

function renderOverview() {
  const exam = upcomingExam();
  if (!exam) {
    const latest = sortedExams().slice(-1)[0];
    panel.overview.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>考试日程</h2><span class="spacer"></span>
          <button class="btn primary" data-action="new-exam" type="button">新增考试</button>
        </div>
        <p class="muted">${latest ? `最近一场是「${esc(latest.name)}」（${esc(formatFull(latest.date))}）。` : '还没有考试记录。'}新增下一场考试后，就能按日期和假期自动规划复习。</p>
      </div>`;
    return;
  }

  const days = Math.max(0, diffDays(exam.date));
  const plan = state.data.plan;
  const matches = plan && plan.examId === exam.id;
  const tasks = matches ? plan.tasks : [];
  const done = tasks.filter((task) => task.done).length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  const hero = `
    <div class="hero">
      <div class="countdown">
        <b>${days}</b>
        <span>天后 · ${esc(exam.name)}</span>
      </div>
      <div class="hero-info">
        <h2>${esc(exam.name)}</h2>
        <div class="hero-meta">
          <span class="chip accent">${esc(formatFull(exam.date))} ${esc(weekdayName(exam.date))}</span>
          <span class="chip">${esc(exam.kind)}</span>
          ${exam.note ? `<span class="chip">${esc(exam.note)}</span>` : ''}
        </div>
        <div class="progress-wrap">
          <div class="progress-line"><i style="width:${progress}%"></i></div>
          <p class="muted">${matches ? `复习计划完成 ${done}/${tasks.length} 项` : '还没有为这场考试生成复习计划'}</p>
        </div>
      </div>
      <div class="hero-actions">
        <button class="btn primary" data-action="gen-plan" data-exam="${esc(exam.id)}" type="button">
          ${matches ? '重新生成计划' : '生成复习计划'}
        </button>
        <button class="btn ghost ai-glow" data-action="gen-plan-ai" data-exam="${esc(exam.id)}" type="button">AI 智能排期</button>
        <button class="btn ghost" data-action="edit-exam" data-exam="${esc(exam.id)}" type="button">编辑日期 / 名称</button>
      </div>
    </div>`;

  const today = dateKey();
  const todayTasks = matches ? plan.tasks.filter((task) => task.date === today) : [];
  const todayHtml = !matches
    ? `<div class="card">
        <div class="card-head"><h2>今日任务</h2></div>
        <p class="muted">生成计划后，只在周末和法定假期安排复习：默认周末 3 科、假期 4 科（可在设置里改），并优先照顾得分率较低的科目；上学日不排任务。</p>
      </div>`
    : `<div class="card">
        <div class="card-head"><h2>今日任务</h2><span class="muted">${todayTasks.filter((task) => task.done).length}/${todayTasks.length} 已完成</span><span class="spacer"></span>
          <button class="btn ghost" data-action="goto-plan" type="button">查看完整计划</button>
        </div>
        ${
          todayTasks.length
            ? `<div class="list-card">${todayTasks.map(miniTaskHtml).join('')}</div>`
            : `<p class="muted">${
                isSchoolDay(today)
                  ? '今天是上学日，不安排复习任务；周末和假期再按计划复习。'
                  : '今天没有安排任务（计划从生成当天开始排期）。可以先做错题复盘或休息。'
              }</p>`
        }
      </div>`;

  const ref = referenceExam();
  const subjectRows = subjects()
    .map((subject) => {
      const entry = ref?.scores?.[subject.key];
      const full = entry?.full || subject.full;
      const rate = entry ? entry.score / full : Math.min(1, subject.target / subject.full);
      const targetRate = subject.target / subject.full;
      const delta = entry?.classAvg != null ? entry.score - entry.classAvg : null;
      const meta = [];
      if (entry) {
        meta.push(`得分率 ${pct(rate)}`);
        if (entry.classAvg != null) meta.push(`班平 ${entry.classAvg}（${delta >= 0 ? '+' : ''}${round1(delta)}）`);
        if (entry.rank != null) meta.push(`第 ${entry.rank} 名`);
      } else {
        meta.push(`目标 ${subject.target}/${subject.full}`);
      }
      const badge =
        subject.level === 'weak'
          ? '<span class="lvl-badge weak">弱科</span>'
          : subject.level === 'strong'
            ? '<span class="lvl-badge strong">强科</span>'
            : '';
      return `<div class="subject-row">
        <div class="top"><b>${esc(subject.name)}</b>${badge}<span class="score">${entry ? `${entry.score}/${full}` : '—'}</span></div>
        <div class="track">
          <i style="width:${Math.min(100, rate * 100).toFixed(1)}%;background:${esc(subject.color)}"></i>
          <b class="tick" style="left:${Math.min(100, targetRate * 100).toFixed(1)}%"></b>
        </div>
        <div class="sub"><span>${meta.map(esc).join(' · ')}</span></div>
      </div>`;
    })
    .join('');

  const subjectHtml = `<div class="card">
    <div class="card-head"><h2>各科得分率</h2>
      <span class="muted">${ref ? `来自 ${esc(ref.name)}（${esc(formatFull(ref.date))}）` : '暂无成绩，暂按目标分展示'}</span>
      <span class="spacer"></span>
      <button class="btn ghost" data-action="entry" type="button">录入成绩</button>
    </div>
    <div class="subject-grid">${subjectRows}</div>
  </div>`;

  panel.overview.innerHTML = hero + aiStrategyHtml(matches ? plan : null) + todayHtml + packingCard() + subjectHtml + trendCard() + adviceCard();
}

function aiStrategyHtml(plan) {
  const strategy = plan?.aiStrategy;
  if (!strategy) return '';
  const focusLines = Object.entries(strategy.focus || {})
    .map(([key, text]) => {
      const subject = subjects().find((item) => item.key === key);
      if (!subject || !text) return '';
      return `<p><b>${esc(subject.name)}</b> · ${esc(text)}</p>`;
    })
    .filter(Boolean)
    .join('');
  return `<div class="card ai-card">
    <div class="card-head"><h2>AI 复习策略</h2>
      <span class="chip accent">${strategy.usedAI ? 'AI 智能排期' : '本地算法'}</span>
      <span class="muted">强弱科权重已应用到计划</span>
    </div>
    <p class="ai-summary">${esc(strategy.summary)}</p>
    ${focusLines ? `<div class="ai-focus">${focusLines}</div>` : ''}
  </div>`;
}

function miniTaskHtml(task) {
  return `<div class="mini-task ${task.done ? 'done' : ''}" data-task="${esc(task.id)}" role="button" tabindex="0">
    <span class="box"><svg class="icon"><use href="/icons.svg#i-check"></use></svg></span>
    <span class="main"><b>${esc(task.title)}</b><small>${esc(task.type)} · ${task.minutes} 分钟</small></span>
    <i class="dot" style="background:${esc(subjectColor(task.subject))}"></i>
  </div>`;
}

function packingCard() {
  const friday = nextFridayKey();
  const saturday = addDays(friday, 1);
  const sunday = addDays(friday, 2);
  const isSunday = parseDay(dateKey()).getDay() === 0;
  const checkedMap = state.data?.packing?.[friday] || {};
  const plan = state.data.plan;
  const related = (plan?.tasks || []).filter((task) => task.date === saturday || task.date === sunday);

  const items = new Map();
  for (const task of related) {
    if (!task.materialKey) continue;
    const item = items.get(task.materialKey) || {
      key: task.materialKey,
      name: task.material,
      subject: task.subject,
      subjectName: task.subjectName,
      days: new Set(),
    };
    item.days.add(task.date === saturday ? '周六' : '周日');
    items.set(task.materialKey, item);
  }
  const order = subjects().map((subject) => subject.key);
  const list = [...items.values()].sort((a, b) => order.indexOf(a.subject) - order.indexOf(b.subject));

  const rows = list
    .map(
      (item) => `<label class="pack-item ${checkedMap[item.key] ? 'checked' : ''}">
        <input type="checkbox" data-pack="${esc(item.key)}" ${checkedMap[item.key] ? 'checked' : ''}>
        <span class="main"><b>${esc(item.name)}</b><small>${esc(item.subjectName)} · ${[...item.days].join('、')}使用</small></span>
      </label>`
    )
    .join('');

  let emptyHint;
  if (!plan) emptyHint = '还没有生成复习计划。生成后会自动按周末训练列出要带的教辅。';
  else if (related.length && !list.length) emptyHint = '这个周末没有需要携带的教辅（任务未绑定教辅，或该科目不用教辅）。';
  else emptyHint = '下周五后的周末没有安排训练，不需要额外带教辅。';

  return `<div class="card">
    <div class="card-head">
      <h2>下周五带回清单</h2>
      <span class="chip accent">周五 ${esc(formatDate(friday))}</span>
      ${isSunday ? '<span class="chip holiday">周日已更新</span>' : ''}
      <span class="spacer"></span>
      <span class="muted">按 ${esc(formatDate(saturday))}–${esc(formatDate(sunday))} 训练生成</span>
    </div>
    ${rows ? `<div class="pack-list">${rows}</div>` : `<p class="muted">${emptyHint}</p>`}
    <p class="muted" style="margin-top:10px">周五放学前按勾选装包；勾选状态会保存，周日打开本页自动换成下一周清单。</p>
  </div>`;
}

function trendCard() {
  const exams = sortedExams().filter((exam) => examTotal(exam).count > 0);
  if (!exams.length) {
    return `<div class="card"><div class="card-head"><h2>总分趋势</h2></div>
      <p class="muted">录入成绩后，这里会显示每次考试的总得分率变化。</p></div>`;
  }
  return `<div class="card">
    <div class="card-head"><h2>总分趋势</h2><span class="muted">总得分率 · ${exams.length} 次考试</span></div>
    ${trendSvg(exams)}
  </div>`;
}

function trendSvg(exams) {
  const width = 640;
  const height = 190;
  const pad = { l: 36, r: 18, t: 14, b: 30 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const toX = (index) =>
    pad.l + (exams.length === 1 ? innerW / 2 : (index * innerW) / (exams.length - 1));
  const toY = (rate) => pad.t + innerH * (1 - Math.max(0, Math.min(1, rate)));

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (value) =>
        `<line x1="${pad.l}" y1="${toY(value)}" x2="${width - pad.r}" y2="${toY(value)}" stroke="var(--line)" stroke-dasharray="3 5"/>
         <text x="${pad.l - 8}" y="${toY(value) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${value * 100}%</text>`
    )
    .join('');

  const points = exams.map((exam, index) => ({ exam, x: toX(index), y: toY(examTotal(exam).rate) }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${path} L${points[points.length - 1].x.toFixed(1)} ${height - pad.b} L${points[0].x.toFixed(1)} ${height - pad.b} Z`;

  const dots = points
    .map(
      (point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--bg-elev)" stroke-width="2"/>
        <text x="${point.x.toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">${esc(
          `${parseDay(point.exam.date).getMonth() + 1}/${parseDay(point.exam.date).getDate()}`
        )}</text>`
    )
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="总分趋势图" style="display:block">
    ${grid}
    <path d="${area}" fill="var(--accent)" opacity="0.08"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
  </svg>`;
}

function adviceCard() {
  const ref = referenceExam();
  const items = subjects()
    .map((subject) => {
      const entry = ref?.scores?.[subject.key];
      return { subject, entry, rate: entry ? entry.score / (entry.full || subject.full) : null };
    })
    .filter((item) => item.rate != null);

  if (!items.length) {
    return `<div class="card">
      <div class="card-head"><h2>自动分析</h2></div>
      <p class="muted">还没有成绩记录。在「成绩记录」里录入一次考试后，系统会按各科得分率给出弱科优先级，并用于安排复习任务。</p>
    </div>`;
  }

  const sorted = items.slice().sort((a, b) => a.rate - b.rate);
  const lines = sorted
    .slice(0, 3)
    .map((item, index) => {
      const targetRate = item.subject.target / item.subject.full;
      const gap = Math.round(item.subject.target - item.entry.score);
      const tone = item.rate < targetRate - 0.03 ? 'warn' : '';
      return `<p class="${tone}">优先 ${index + 1} · ${esc(item.subject.name)} 得分率 ${pct(item.rate)}${gap > 0 ? `，距目标 ${item.subject.target} 分还差 ${gap} 分` : '，已达到目标'} → ${adviceFor(item.rate)}</p>`;
    })
    .join('');
  const best = sorted[sorted.length - 1];

  return `<div class="card">
    <div class="card-head"><h2>自动分析</h2><span class="muted">基于 ${esc(ref.name)}</span></div>
    <div class="analysis">
      ${lines}
      <p class="good">保持项 · ${esc(best.subject.name)} 得分率 ${pct(best.rate)}，是当前最稳的科目。</p>
    </div>
  </div>`;
}

// ---------- 复习计划 ----------

function renderPlan() {
  const exams = sortedExams();
  if (!exams.length) {
    panel.plan.innerHTML = `<div class="card">
      <div class="card-head"><h2>复习计划</h2></div>
      <p class="muted">先新增一场考试，才能按考试日期生成复习计划。</p>
      <button class="btn primary" data-action="new-exam" type="button" style="margin-top:10px">新增考试</button>
    </div>`;
    return;
  }

  const exam = examById(state.planExamId) || upcomingExam() || exams[exams.length - 1];
  state.planExamId = exam.id;
  const plan = state.data.plan && state.data.plan.examId === exam.id ? state.data.plan : null;
  const options = exams
    .map(
      (item) =>
        `<option value="${esc(item.id)}" ${item.id === exam.id ? 'selected' : ''}>${esc(item.name)} · ${esc(formatFull(item.date))}</option>`
    )
    .join('');

  const toolbar = `<div class="card">
    <div class="card-head">
      <h2>复习计划</h2>
      <span class="muted">${plan ? `生成于 ${esc(formatDate(plan.generatedAt.slice(0, 10)))}` : '尚未生成'}</span>
      <span class="spacer"></span>
      <select class="select-pill" id="planExamSelect" aria-label="选择目标考试">${options}</select>
      <button class="btn ghost" data-action="edit-exam" data-exam="${esc(exam.id)}" type="button">编辑日期 / 名称</button>
      <button class="btn ghost ai-glow" data-action="gen-plan-ai" data-exam="${esc(exam.id)}" type="button">AI 智能排期</button>
      <button class="btn primary" data-action="gen-plan" data-exam="${esc(exam.id)}" type="button">${plan ? '重新生成' : '生成计划'}</button>
    </div>
    ${
      plan
        ? progressBlock(plan)
        : `<p class="muted">按「${esc(exam.name)}」（${esc(formatFull(exam.date))}）的日期，结合假期和历史得分率自动排期：只在周末与法定假期安排复习，默认周末 3 科、假期 4 科，上学日不排任务；计划按假期分组，只展示要复习的科目；考前 14 天转为套卷与错题复盘，考前 3 天回归课本。</p>`
    }
  </div>`;

  let body;
  if (!plan) {
    body = `<div class="card"><p class="muted">选择目标考试后点击「生成计划」。生成后按假期分组展示要复习的科目，可逐项勾选完成；点「AI 智能排期」会结合强弱科与历史成绩让 AI 给出策略和权重。</p></div>`;
    panel.plan.innerHTML = toolbar + body;
    document.getElementById('planExamSelect')?.addEventListener('change', (event) => {
      state.planExamId = event.target.value;
      renderPlan();
    });
    return;
  }

  const today = dateKey();
  let days = plan.days.slice();
  if (state.planRange > 0) {
    const limit = addDays(today, state.planRange - 1);
    days = days.filter((day) => day.date >= today && day.date <= limit);
  } else {
    days = days.filter((day) => day.date >= today);
  }

  // 按假期归组：同一假期的多天合并，不展示具体日期与时段
  const groupMap = new Map();
  for (const day of days) {
    const key = day.holidayName || (day.holiday ? '假期' : '周末');
    if (!groupMap.has(key)) groupMap.set(key, { name: key, dates: new Set(), holiday: false });
    const group = groupMap.get(key);
    group.dates.add(day.date);
    if (day.holiday) group.holiday = true;
  }
  const subjectLabel = (task) =>
    subjects().find((subject) => subject.key === task.subject)?.name || task.subjectName || task.subject;

  const planSubjectKeys = [...new Set(plan.tasks.map((task) => task.subject))];
  const subjectOptions = `<option value="all" ${state.planSubject === 'all' ? 'selected' : ''}>全部科目</option>${subjects()
    .filter((subject) => planSubjectKeys.includes(subject.key))
    .map(
      (subject) =>
        `<option value="${esc(subject.key)}" ${state.planSubject === subject.key ? 'selected' : ''}>${esc(subject.name)}</option>`
    )
    .join('')}`;

  const toolbar2 = `<div class="card plan-toolbar">
    <select class="select-pill" id="planSubject" aria-label="筛选科目">${subjectOptions}</select>
    <select class="select-pill" id="planRange" aria-label="计划范围">
      <option value="14" ${state.planRange === 14 ? 'selected' : ''}>未来 14 天</option>
      <option value="30" ${state.planRange === 30 ? 'selected' : ''}>未来 30 天</option>
      <option value="0" ${state.planRange === 0 ? 'selected' : ''}>全部</option>
    </select>
    <div class="filter-chips">
      ${[
        ['all', '全部'],
        ['todo', '未完成'],
        ['done', '已完成'],
      ]
        .map(
          ([key, label]) =>
            `<button class="filter-chip ${state.planFilter === key ? 'is-active' : ''}" data-filter="${key}" type="button">${label}</button>`
        )
        .join('')}
    </div>
    <span class="spacer"></span>
    <span class="muted">${groupMap.size} 个假期分组 · ${plan.tasks.length} 项</span>
  </div>`;

  const dayCards = [...groupMap.values()]
    .map((group) => {
      const all = plan.tasks.filter((task) => group.dates.has(task.date));
      const visible = all.filter((task) => {
        if (state.planSubject !== 'all' && task.subject !== state.planSubject) return false;
        if (state.planFilter === 'done') return task.done;
        if (state.planFilter === 'todo') return !task.done;
        return true;
      });
      if (!visible.length) return '';
      const doneCount = all.filter((task) => task.done).length;
      const isWeekendGroup = group.name === '周末';
      return `<div class="day-card holiday-card">
        <div class="day-head">
          <b>${esc(group.name)}</b>
          <span class="chip ${isWeekendGroup ? '' : 'holiday'}">${isWeekendGroup ? '周末' : '假期'}</span>
          <span class="right">${doneCount}/${all.length} 已完成</span>
        </div>
        <div class="day-tasks">
          ${visible
            .map(
              (task) => `<div class="task ${task.done ? 'done' : ''}" data-task="${esc(task.id)}" role="button" tabindex="0">
                <span class="box"><svg class="icon"><use href="/icons.svg#i-check"></use></svg></span>
                <span class="main"><b>${esc(subjectLabel(task))}</b><small>${esc(task.title)} · ${esc(task.type)}</small></span>
                <i class="dot" style="background:${esc(subjectColor(task.subject))}"></i>
              </div>`
            )
            .join('')}
        </div>
      </div>`;
    })
    .join('');

  body = `<div class="plan-days">${dayCards || `<div class="card"><p class="muted">这个范围内没有符合条件的任务。可以切换范围或科目，或重新生成计划。</p></div>`}</div>`;
  panel.plan.innerHTML = toolbar + aiStrategyHtml(plan) + toolbar2 + body;

  document.getElementById('planExamSelect')?.addEventListener('change', (event) => {
    state.planExamId = event.target.value;
    renderPlan();
  });
  document.getElementById('planSubject')?.addEventListener('change', (event) => {
    state.planSubject = event.target.value;
    renderPlan();
  });
  document.getElementById('planRange')?.addEventListener('change', (event) => {
    state.planRange = Number(event.target.value);
    renderPlan();
  });
  panel.plan.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.planFilter = button.dataset.filter;
      renderPlan();
    });
  });
}

function progressBlock(plan) {
  const total = plan.tasks.length;
  const done = plan.tasks.filter((task) => task.done).length;
  const value = total ? Math.round((done / total) * 100) : 0;
  return `<div class="progress-wrap">
    <div class="progress-line"><i style="width:${value}%"></i></div>
    <p class="muted">已完成 ${done} / ${total} 项 · ${value}%</p>
  </div>`;
}

// ---------- 成绩记录 ----------

function renderScores() {
  const exams = sortedExams().slice().reverse();
  const head = `<div class="card-head">
    <h2>成绩记录</h2>
    <span class="muted">共 ${exams.length} 场 · 录入后自动分析每科试卷与分数</span>
    <span class="spacer"></span>
    <button class="btn ghost" data-action="new-exam" type="button">新增考试</button>
    ${exams.length ? '<button class="btn primary" data-action="entry" type="button">录入成绩</button>' : ''}
  </div>`;

  const list = exams.map(examCardHtml).join('');
  panel.scores.innerHTML =
    head +
    (list ||
      `<div class="card"><p class="muted">还没有考试记录。点击「新增考试」添加，例如 2027 中考、区一模、月考、周测。</p></div>`);
}

function examCardHtml(exam) {
  const list = examSubjects(exam);
  const totals = examTotal(exam);
  const hasScores = totals.count > 0;
  const days = diffDays(exam.date);

  const subjectLines = list
    .map((subject) => {
      const entry = exam.scores?.[subject.key];
      if (!entry) {
        return `<div class="score-line pending">
          <span class="name"><i style="background:${esc(subject.color)}"></i>${esc(subject.name)}</span>
          <div class="bar"><i style="width:0"></i></div>
          <span class="val">未录入</span>
          <span class="meta">目标 ${subject.target}/${subject.full}</span>
        </div>`;
      }
      const full = entry.full || subject.full;
      const rate = entry.score / full;
      const delta = entry.classAvg != null ? entry.score - entry.classAvg : null;
      const meta = [];
      if (entry.rank != null) meta.push(`第 ${entry.rank} 名`);
      if (entry.note) meta.push(esc(entry.note));
      return `<div class="score-line">
        <span class="name"><i style="background:${esc(subject.color)}"></i>${esc(subject.name)}</span>
        <div class="bar">
          <i style="width:${Math.min(100, rate * 100).toFixed(1)}%;background:${esc(subject.color)}"></i>
          <b class="tick" style="left:${Math.min(100, (subject.target / subject.full) * 100).toFixed(1)}%"></b>
        </div>
        <span class="val"><b>${entry.score}</b>/${full}<em>${pct(rate)}</em></span>
        <span class="meta">
          ${entry.classAvg != null ? `班级平均 ${entry.classAvg} · <b class="${delta >= 0 ? 'delta-up' : 'delta-down'}">${delta >= 0 ? '+' : ''}${round1(delta)}</b>` : '未填班级平均'}
          ${meta.length ? ` · ${meta.join(' · ')}` : ''}
        </span>
      </div>`;
    })
    .join('');

  const analysis = analyzeExam(exam)
    .map((item) => `<p class="${item.tone}">${esc(item.text)}</p>`)
    .join('');

  return `<article class="card">
    <div class="card-head">
      <h2>${esc(exam.name)}</h2>
      <span class="chip accent">${esc(formatFull(exam.date))} ${esc(weekdayName(exam.date))}</span>
      <span class="chip">${esc(exam.kind)}</span>
      <span class="chip">${days >= 0 ? `${days} 天后` : `${Math.abs(days)} 天前`}</span>
      <span class="spacer"></span>
      <button class="btn ghost" data-action="entry" data-exam="${esc(exam.id)}" type="button">录入成绩</button>
      <button class="btn ghost" data-action="edit-exam" data-exam="${esc(exam.id)}" type="button">编辑</button>
      <button class="btn danger" data-action="del-exam" data-exam="${esc(exam.id)}" type="button">删除</button>
    </div>
    ${exam.note ? `<p class="muted">${esc(exam.note)}</p>` : ''}
    ${
      hasScores
        ? `<div class="total-line"><span>总分 <b>${totals.total}</b> / ${totals.full}</span>
            <span class="muted">得分率 ${pct(totals.rate)} · 目标 ${totals.target} 分</span></div>`
        : ''
    }
    <div class="score-lines">${subjectLines}</div>
    <div class="analysis">${analysis}</div>
  </article>`;
}

function analyzeExam(exam) {
  const entries = examSubjects(exam)
    .map((subject) => ({ subject, entry: exam.scores?.[subject.key] }))
    .filter((item) => item.entry);

  if (!entries.length) {
    return [{ tone: '', text: '还没有录入成绩。点「录入成绩」逐科填写分数、班级平均与排名，这里会自动生成每科分析。' }];
  }

  const out = [];
  const totals = examTotal(exam);
  out.push({
    tone: '',
    text: `总分 ${totals.total} / ${totals.full}（${pct(totals.rate)}），目标 ${totals.target} 分，${
      totals.total >= totals.target
        ? `已高出目标 ${Math.round(totals.total - totals.target)} 分。`
        : `还差 ${Math.round(totals.target - totals.total)} 分。`
    }`,
  });

  const ranked = entries
    .map((item) => ({ ...item, rate: item.entry.score / (item.entry.full || item.subject.full) }))
    .sort((a, b) => b.rate - a.rate);
  const best = ranked[0];
  out.push({
    tone: 'good',
    text: `最稳的一科是${best.subject.name}，${best.entry.score}/${best.entry.full || best.subject.full}，得分率 ${pct(best.rate)}。`,
  });

  const weak = ranked
    .filter((item) => item.rate < item.subject.target / item.subject.full - 0.03)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3);
  if (weak.length) {
    out.push({
      tone: 'warn',
      text: `需要加强：${weak
        .map((item) => `${item.subject.name} ${item.entry.score}/${item.entry.full || item.subject.full}（${pct(item.rate)}）`)
        .join('、')}。`,
    });
    const first = weak[0];
    const gap = Math.max(0, Math.round(first.subject.target - first.entry.score));
    out.push({
      tone: '',
      text: `${first.subject.name}建议优先：${adviceFor(first.rate)}${gap ? `，距目标还差 ${gap} 分` : ''}。`,
    });
  } else {
    out.push({ tone: 'good', text: '各科都接近或超过目标分，接下来重点练套卷稳定度与错题复盘。' });
  }

  const above = [];
  const below = [];
  for (const item of ranked) {
    if (item.entry.classAvg == null) continue;
    const delta = item.entry.score - item.entry.classAvg;
    if (delta >= 0) above.push(`${item.subject.name} +${round1(delta)}`);
    else below.push(`${item.subject.name} ${round1(delta)}`);
  }
  if (above.length || below.length) {
    out.push({
      tone: '',
      text: `与班级平均相比：${above.length ? `高于 ${above.join('、')}` : ''}${above.length && below.length ? '；' : ''}${
        below.length ? `低于 ${below.join('、')}` : ''
      }。`,
    });
  }

  const rank = ranked.filter((item) => item.entry.rank != null).sort((a, b) => a.entry.rank - b.entry.rank)[0];
  if (rank) out.push({ tone: 'good', text: `最好名次：${rank.subject.name} 第 ${rank.entry.rank} 名。` });

  const notes = ranked.filter((item) => item.entry.note);
  if (notes.length) {
    out.push({ tone: '', text: `试卷备注：${notes.map((item) => `${item.subject.name}：${item.entry.note}`).join('；')}。` });
  }

  return out;
}

// ---------- 设置 ----------


function renderSettings() {
  const settings = state.data.settings;
  const LEVELS = [
    ['weak', '弱'],
    ['normal', '常'],
    ['strong', '强'],
  ];
  const subjectRows = settings.subjects
    .map(
      (subject) => `<div class="row" data-key="${esc(subject.key)}">
        <span class="name"><i style="background:${esc(subject.color)}"></i>${esc(subject.name)}</span>
        <input class="mini-input" data-field="full" type="number" min="1" step="1" value="${subject.full}" aria-label="${esc(subject.name)}满分">
        <input class="mini-input" data-field="target" type="number" min="0" step="0.5" value="${subject.target}" aria-label="${esc(subject.name)}目标分">
        <div class="level-pick" aria-label="${esc(subject.name)}强弱">
          ${LEVELS.map(
            ([key, label]) =>
              `<button type="button" class="lvl ${key} ${key === (subject.level || 'normal') ? 'is-on' : ''}" data-level="${key}">${label}</button>`
          ).join('')}
        </div>
      </div>`
    )
    .join('');

  const weakCount = settings.subjects.filter((subject) => subject.level === 'weak').length;
  const strongCount = settings.subjects.filter((subject) => subject.level === 'strong').length;

  const holidayGroupsHtml = holidayGroups()
    .map(
      (group, index) => `<div class="holiday-group">
        <b>${esc(group.name)}</b>
        <span class="days-chip">${group.count} 天</span>
        <span class="rng">${esc(formatDate(group.start))}${group.count > 1 ? ` – ${esc(formatDate(group.end))}` : ''}</span>
        <button class="icon-btn small-btn" data-action="del-holiday-group" data-index="${index}" type="button" aria-label="删除假期">×</button>
      </div>`
    )
    .join('');

  const materialRows = (settings.materials || [])
    .map(
      (material) => `<div class="material-row" data-key="${esc(material.key)}">
        <input class="mini-input" data-field="name" maxlength="30" value="${esc(material.name)}" placeholder="教辅名称">
        <select class="mini-input" data-field="subject" aria-label="科目">
          ${settings.subjects
            .map(
              (subject) =>
                `<option value="${esc(subject.key)}" ${subject.key === material.subject ? 'selected' : ''}>${esc(subject.name)}</option>`
            )
            .join('')}
        </select>
        <button class="icon-btn small-btn" data-action="del-material" type="button" aria-label="删除教辅">×</button>
      </div>`
    )
    .join('');

  panel.settings.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>每日复习节奏</h2></div>
      <div class="setting-row">
        <label class="field" style="max-width:190px;margin:0">
          <span>每个复习日分钟数</span>
          <input id="setMinutes" type="number" min="30" max="600" step="10" value="${Number(settings.dailyMinutes) || 90}">
        </label>
        <label class="field" style="max-width:150px;margin:0">
          <span>每天科目数</span>
          <input id="setSubjectsPerDay" type="number" min="0" max="8" step="1" value="${
            Number(settings.dailySubjects) || 0
          }" placeholder="0 = 自动">
        </label>
        <button class="btn primary" data-action="save-minutes" type="button">保存</button>
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:11.5px">科目数填 0 表示自动（周末 3 科、假期 4 科）。复习计划只按假期分组展示要复习的科目，不显示具体日期和时段。</p>
      <p class="muted" style="margin-top:10px">只在周末与法定假期安排复习，上学日不排任务；任务数会按当天时长自动调整（每项至少 10 分钟）。考前 14 天与考前 3 天会自动切换任务类型。</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>科目与目标</h2><span class="muted">总分 ${settings.subjects.reduce((sum, item) => sum + item.full, 0)} 分${weakCount ? ` · 弱科 ${weakCount} 门` : ''}${strongCount ? ` · 强科 ${strongCount} 门` : ''}</span>
        <span class="spacer"></span>
        <button class="btn primary" data-action="save-subjects" type="button">保存科目</button>
      </div>
      <div class="subject-table" id="subjectTable">
        <div class="head"><span>科目</span><span>满分</span><span>目标分</span><span>强弱科</span></div>
        ${subjectRows}
      </div>
      <p class="muted" style="margin-top:10px">标记弱科后，生成计划时会自动加大它的出现频率；「AI 智能排期」也会参考强弱科标记和历史成绩分配权重。</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>假期日历</h2><span class="muted">${(state.holidayDraft || []).length} 天</span>
        <span class="spacer"></span>
        <button class="btn primary" data-action="save-holidays" type="button">保存假期</button>
      </div>
      <div class="holiday-add">
        <input id="holName" class="mini-input" maxlength="20" placeholder="假期名称，如：春节假期" aria-label="假期名称">
        <input id="holStart" class="mini-input" type="date" value="${dateKey()}" aria-label="开始日期">
        <input id="holDays" class="mini-input" type="number" min="1" max="60" value="3" aria-label="持续天数">
        <button class="btn ghost" data-action="add-holiday-block" type="button">添加</button>
      </div>
      <div class="holiday-list" id="holidayList">
        ${holidayGroupsHtml || '<p class="muted">还没有假期。填写名称、开始日期和持续天数后点「添加」，再点「保存假期」。放假期间生成计划会自动加量（每天 4 个任务）。</p>'}
      </div>
      <p class="muted" style="margin-top:10px">按整段假期录入即可，不用一天一天填；周六周日会按周末自动安排。保存后到「复习计划」重新生成生效。</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>教辅与训练材料</h2><span class="muted">${(settings.materials || []).length} 项</span>
        <span class="spacer"></span>
        <button class="btn ghost" data-action="add-material" type="button">添加教辅</button>
        <button class="btn primary" data-action="save-materials" type="button">保存教辅</button>
      </div>
      <div class="material-table" id="materialTable">
        <div class="head"><span>教辅 / 材料</span><span>科目</span><span></span></div>
        ${materialRows || '<p class="muted">还没有教辅。添加后生成计划时会自动把训练安排到对应教辅。</p>'}
      </div>
      <p class="muted" style="margin-top:10px">保存后到「复习计划」点「重新生成」，训练就会指名到具体教辅；周日会自动生成下周五要带回的教辅清单。</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>考试信息</h2></div>
      <p class="muted">「2027 中考」日期按往年估算（6 月 26 日），请按学校通知在「成绩记录 → 编辑」里修改。平时月考、区一模、二模也建议记录，分析会越来越准。</p>
    </div>`;
}

// ---------- 错题本 ----------

function mistakeSubjectName(key) {
  return subjects().find((item) => item.key === key)?.name || key || '未分类';
}

function mistakeById(id) {
  return state.mistakes.find((item) => item.id === id) || null;
}

function filteredMistakes() {
  return state.mistakes.filter(
    (item) =>
      (state.mistakeSubject === 'all' || item.subject === state.mistakeSubject) &&
      (state.mistakeStatus === 'all' || item.status === state.mistakeStatus)
  );
}

function renderMistakes() {
  if (!panel.mistakes) return;
  const items = filteredMistakes();
  const openCount = state.mistakes.filter((item) => item.status === 'open').length;

  const selects = `
    <select data-mistake-filter="subject" aria-label="按科目筛选">
      <option value="all">全部科目</option>
      ${subjects().map((s) => `<option value="${esc(s.key)}" ${state.mistakeSubject === s.key ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
    </select>
    <select data-mistake-filter="status" aria-label="按状态筛选">
      <option value="all" ${state.mistakeStatus === 'all' ? 'selected' : ''}>全部状态</option>
      <option value="open" ${state.mistakeStatus === 'open' ? 'selected' : ''}>待巩固</option>
      <option value="mastered" ${state.mistakeStatus === 'mastered' ? 'selected' : ''}>已掌握</option>
    </select>`;

  const cards = items
    .map((item) => {
      const mastered = item.status === 'mastered';
      const statusChip = item.analyzing
        ? '<span class="m-status analyzing">AI 分析中</span>'
        : item.analysisError && !item.analyzedAt
          ? '<span class="m-status failed">分析失败</span>'
          : `<span class="m-status ${mastered ? 'mastered' : ''}">${mastered ? '已掌握' : '待巩固'}</span>`;
      const summary = item.question || item.note || (item.analyzing ? '正在识别题目…' : '还没分析出题目，点开看详情');
      return `<button class="mistake-card" type="button" data-action="mistake-open" data-mistake="${esc(item.id)}" style="--subject-color:${esc(subjectColor(item.subject))}">
        ${item.image ? `<img class="m-thumb" src="/api/mistakes/${encodeURIComponent(item.id)}/image" alt="" loading="lazy">` : ''}
        <div class="m-head">
          <span class="m-subject">${esc(mistakeSubjectName(item.subject))}</span>
          ${statusChip}
        </div>
        <p class="m-question">${esc(summary)}</p>
        ${item.points?.length ? `<div class="m-points">${item.points.map((p) => `<span class="m-point">${esc(p)}</span>`).join('')}</div>` : ''}
        <div class="m-date">${formatDate(String(item.createdAt).slice(0, 10))} 记录${item.splitCount > 1 ? ` · 同一张图 ${item.splitCount} 道` : ''}${item.skippedCorrect ? ` · 跳过 ${item.skippedCorrect} 道对的题` : ''}</div>
      </button>`;
    })
    .join('');

  panel.mistakes.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>错题本</h2><span class="spacer"></span>${selects}
        <button class="btn ghost" data-action="mistake-review" type="button" ${items.length ? '' : 'disabled'}>小卡复习</button>
        <button class="btn primary" data-action="new-mistake" type="button">记一道错题</button>
      </div>
      ${state.mistakes.length
        ? items.length
          ? `<div class="mistake-grid">${cards}</div>
             <p class="muted" style="margin-top:14px">拍照或粘贴题目后，AI 会自动识别题目、给出正确答案、分析错因并标注知识点。共 ${state.mistakes.length} 道错题，待巩固 ${openCount} 道。点卡片看完整分析。</p>`
          : '<p class="muted" style="margin-top:16px">当前筛选条件下没有错题。</p>'
        : `<div class="mistake-card m-empty" style="--subject-color:var(--accent)">
             <span>还没有错题。考试或作业里做错的题，拍照存进来，让 AI 帮你分析错因。</span>
           </div>
           <p class="muted" style="margin-top:14px">拍照上传后 AI 自动识别题目、给出正确答案、分析错因并标注知识点；掌握了的题标记「已掌握」，复习时重点看「待巩固」。</p>`}
    </div>`;
}

// ---------- 错题小卡复习 ----------
let mistakeReview = null;
let mistakeReviewKey = null;

function startMistakeReview() {
  const items = filteredMistakes();
  if (!items.length) {
    toast('当前筛选下没有可复习的错题', { type: 'info' });
    return;
  }
  const open = items.filter((item) => item.status !== 'mastered');
  const mastered = items.filter((item) => item.status === 'mastered');
  const queue = [...open, ...mastered];
  mistakeReview = { queue, index: 0, flipped: false, known: new Set(), total: queue.length, openedAt: performance.now() };

  if (!mistakeReviewKey) {
    mistakeReviewKey = (event) => {
      if (!mistakeReview) return;
      if (event.key === 'Escape') {
        closeMistakeReview();
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!mistakeReview.flipped) flipMistakeCard();
        return;
      }
      if (!mistakeReview.flipped) return;
      if (event.key === '1') gradeMistake('again');
      if (event.key === '2') gradeMistake('hard');
      if (event.key === '3') gradeMistake('good');
    };
    document.addEventListener('keydown', mistakeReviewKey);
  }

  renderMistakeReview();
}

function closeMistakeReview() {
  document.getElementById('mistakeReview')?.remove();
  document.body.classList.remove('modal-open');
  if (mistakeReviewKey) document.removeEventListener('keydown', mistakeReviewKey);
  mistakeReviewKey = null;
  mistakeReview = null;
  renderMistakes();
  renderOverview();
}

function flipMistakeCard() {
  if (!mistakeReview) return;
  // 刚打开时的合成点击可能落在卡片上，短暂忽略，避免一进来就翻面
  if (performance.now() - mistakeReview.openedAt < 220) return;
  mistakeReview.flipped = !mistakeReview.flipped;
  renderMistakeReview();
}

function ensureMistakeReviewRoot() {
  let root = document.getElementById('mistakeReview');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'mistakeReview';
  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-mr]');
    if (!action) return;
    const act = action.dataset.mr;
    if (act === 'close') closeMistakeReview();
    if (act === 'restart') startMistakeReview();
    if (act === 'flip' && !mistakeReview.flipped) flipMistakeCard();
    if (act === 'again' || act === 'hard' || act === 'good') gradeMistake(act);
  });
  document.body.appendChild(root);
  document.body.classList.add('modal-open');
  return root;
}

function renderMistakeReview() {
  if (!mistakeReview) return;
  const root = ensureMistakeReviewRoot();
  const review = mistakeReview;

  if (review.index >= review.queue.length) {
    const left = Math.max(0, review.total - review.known.size);
    root.innerHTML = `<div class="mr-shell" role="dialog" aria-modal="true" aria-label="错题复习完成">
      <div class="mr-done">
        <span class="mr-eyebrow">复习完成</span>
        <h2>这一轮过完了</h2>
        <p>共复习 ${review.total} 道，记住 ${review.known.size} 道${left ? `，${left} 道还需要再看` : '。'}</p>
        <div class="mr-actions">
          <button class="btn ghost" type="button" data-mr="close">返回错题本</button>
          <button class="btn primary" type="button" data-mr="restart">再过一轮</button>
        </div>
      </div>
    </div>`;
    return;
  }

  const item = review.queue[review.index];
  const color = subjectColor(item.subject);
  const progress = Math.round((review.index / Math.max(1, review.queue.length)) * 100);
  const question = String(item.question || '').trim();
  const image = item.image
    ? `<img class="mr-img" src="/api/mistakes/${encodeURIComponent(item.id)}/image" alt="错题照片">`
    : '';
  const points = (item.points || []).length
    ? `<div class="mr-points">${item.points.map((point) => `<span>${esc(point)}</span>`).join('')}</div>`
    : '';

  root.innerHTML = `<div class="mr-shell" role="dialog" aria-modal="true" aria-label="错题小卡复习">
    <div class="mr-top">
      <span class="mr-progress">${review.index + 1} / ${review.queue.length}</span>
      <span class="mr-bar"><i style="width:${progress}%"></i></span>
      <button class="mr-close" type="button" data-mr="close" aria-label="退出复习">×</button>
    </div>

    <div class="mr-card ${review.flipped ? 'is-flipped' : ''}" data-mr="flip">
      <div class="mr-face mr-front">
        <span class="mr-subject" style="--c:${esc(color)}">${esc(mistakeSubjectName(item.subject))}</span>
        <div class="mr-question">${question ? esc(question) : '这道题还没识别出文字，先看下面的照片。'}</div>
        ${image}
        <span class="mr-hint">先自己回想答案，再点卡片翻面</span>
      </div>
      <div class="mr-face mr-back">
        <span class="mr-subject" style="--c:${esc(color)}">${esc(mistakeSubjectName(item.subject))} · 答案</span>
        <div class="mr-answer">${item.answer ? esc(item.answer) : '还没有 AI 分析答案，可以返回错题本点开这道题做一次分析。'}</div>
        ${item.cause ? `<div class="mr-block"><b>错因</b><p>${esc(item.cause)}</p></div>` : ''}
        ${item.advice ? `<div class="mr-block"><b>建议</b><p>${esc(item.advice)}</p></div>` : ''}
        ${points}
      </div>
    </div>

    <div class="mr-actions">
      ${
        review.flipped
          ? `<button class="btn ghost mr-again" type="button" data-mr="again">忘记了</button>
             <button class="btn ghost mr-hard" type="button" data-mr="hard">有点模糊</button>
             <button class="btn ghost mr-good" type="button" data-mr="good">记住了</button>`
          : '<button class="btn primary" type="button" data-mr="flip">看答案</button>'
      }
    </div>
  </div>`;
}

async function gradeMistake(result) {
  const review = mistakeReview;
  const item = review?.queue[review.index];
  if (!item || review.busy) return;

  review.busy = true;
  const nextStatus = result === 'good' ? 'mastered' : 'open';
  const previous = item.status;
  item.status = nextStatus;
  try {
    await api(`/api/mistakes/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    });
  } catch (error) {
    item.status = previous;
    toast(error.message, { type: 'error' });
    review.busy = false;
    return;
  }

  review.busy = false;

  if (result === 'good') review.known.add(item.id);
  if (result === 'again') review.queue.push(item);
  review.index += 1;
  review.flipped = false;
  renderMistakeReview();
}

function openMistakeModal() {
  if (!subjects().length) {
    toast('先在设置里添加科目', { type: 'error' });
    return;
  }
  const inner = `<h2>记一道错题</h2>
    <div class="mistake-form">
      <label class="field"><span>科目</span>
        <select id="mkSubject">${subjects().map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('')}</select>
      </label>
      <div>
        <label><span>错题照片（拍照，或从相册选一张）</span></label>
        <div class="mistake-upload">
          <button class="btn ghost mistake-upload-btn" id="mkShoot" type="button">拍照</button>
          <button class="btn ghost mistake-upload-btn" id="mkPick" type="button">从相册选择</button>
          <input id="mkShootInput" type="file" accept="image/*" capture="environment">
          <input id="mkPickInput" type="file" accept="image/*">
        </div>
        <p class="mistake-upload-name" id="mkFileName">支持 jpg / png / heic，10MB 以内 · 一张图有多道题会自动拆开，已做对的题会跳过</p>
        <img class="mistake-preview" id="mkPreview" alt="错题照片预览" style="display:none;margin-top:10px">
      </div>
      <label class="field"><span>或粘贴题目文字（拍照外另一种方式）</span>
        <textarea id="mkQuestion" rows="4" maxlength="4000" placeholder="例如：已知二次函数 y=ax²+bx+c 的图象经过点…"></textarea>
      </label>
      <label class="field"><span>备注（可选）：你当时的答案 / 觉得卡在哪</span>
        <input id="mkNote" type="text" maxlength="500" placeholder="例如：我选的 B，把对称轴算错了">
      </label>
    </div>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button class="btn ghost" data-close type="button">取消</button>
      <button class="btn primary ai-glow" id="mkSave" type="button">保存并 AI 分析</button>
    </div>`;

  mountSheet(inner, ({ close, sheet }) => {
    const shootInput = sheet.querySelector('#mkShootInput');
    const pickInput = sheet.querySelector('#mkPickInput');
    const preview = sheet.querySelector('#mkPreview');
    const fileName = sheet.querySelector('#mkFileName');
    let chosenFile = null;

    const bindInput = (input, other) => {
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        chosenFile = file;
        other.value = '';
        fileName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)}MB`;
        if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
        const url = URL.createObjectURL(file);
        preview.dataset.url = url;
        preview.src = url;
        preview.style.display = 'block';
      });
    };
    bindInput(shootInput, pickInput);
    bindInput(pickInput, shootInput);

    sheet.querySelector('#mkShoot').addEventListener('click', () => {
      shootInput.value = '';
      shootInput.click();
    });
    sheet.querySelector('#mkPick').addEventListener('click', () => {
      pickInput.value = '';
      pickInput.click();
    });

    sheet.querySelector('#mkSave').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const file = chosenFile;
      const question = sheet.querySelector('#mkQuestion').value.trim();
      if (!file && !question) {
        toast('请拍照上传错题，或粘贴题目文字', { type: 'error' });
        return;
      }

      const subject = sheet.querySelector('#mkSubject').value;
      const note = sheet.querySelector('#mkNote').value.trim();
      button.disabled = true;

      // 有照片：先识别，弹窗勾选确认后再入库，避免把做对的题也录进去
      if (file) {
        const form = new FormData();
        form.append('image', file);
        form.append('subject', subject);
        form.append('note', note);
        button.textContent = '识别题目中…（约十几秒）';
        try {
          const response = await fetch('/api/mistakes/scan', { method: 'POST', body: form });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || `识别失败（${response.status}）`);
          close();
          openScanReview(data.scan);
        } catch (error) {
          toast(error.message, { type: 'error' });
          button.disabled = false;
          button.textContent = '保存并 AI 分析';
        }
        return;
      }

      // 只有文字：直接保存，AI 后台分析
      const form = new FormData();
      form.append('subject', subject);
      form.append('question', question);
      form.append('note', note);
      button.textContent = '保存中…';
      try {
        const response = await fetch('/api/mistakes', { method: 'POST', body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `保存失败（${response.status}）`);
        close();
        await refreshMistakes();
        startMistakePoll();
        toast('已保存，AI 正在后台分析，可以先去做别的');
        openMistakeDetail(data.item?.id);
      } catch (error) {
        toast(error.message, { type: 'error' });
        button.disabled = false;
        button.textContent = '保存并 AI 分析';
      }
    });
  });
}

function verdictLabel(verdict) {
  if (verdict === 'wrong') return { text: '判错', cls: 'wrong' };
  if (verdict === 'right') return { text: '做对', cls: 'right' };
  return { text: '没看清批改', cls: 'unknown' };
}

// 识别后先让用户勾选，确认再入库
function openScanReview(scan) {
  const questions = Array.isArray(scan?.questions) ? scan.questions : [];
  if (!questions.length) {
    toast('没有识别到题目，换一张更清楚的照片试试', { type: 'error' });
    return;
  }

  const initial = questions.map((q) => q.verdict === 'wrong');
  if (!initial.some(Boolean)) {
    const idx = questions.findIndex((q) => q.verdict !== 'right');
    if (idx >= 0) initial[idx] = true;
  }

  const rows = questions
    .map((q, index) => {
      const v = verdictLabel(q.verdict);
      return `<label class="scan-row">
        <input type="checkbox" data-scan-index="${index}" ${initial[index] ? 'checked' : ''}>
        <span class="scan-body">
          <span class="scan-q">${esc(q.question)}</span>
          <span class="scan-meta"><span class="scan-chip ${v.cls}">${v.text}</span>${
            q.points?.length ? ` · ${esc(q.points.join('、'))}` : ''
          }</span>
        </span>
      </label>`;
    })
    .join('');

  const inner = `<h2>识别到 ${questions.length} 道题</h2>
    <p class="muted" style="margin:0 0 12px">默认勾选的是有批改痕迹（打叉 / 圈错）的题。AI 可能看错，确认一下再录入，做对的题取消勾选即可。</p>
    <div class="scan-list">${rows}</div>
    <div class="sheet-actions">
      <button class="btn ghost" type="button" data-scan-all>全选</button>
      <button class="btn ghost" type="button" data-scan-none>全不选</button>
      <span class="spacer"></span>
      <button class="btn ghost" id="scanCancel" type="button">取消</button>
      <button class="btn primary ai-glow" id="scanConfirm" type="button">录入</button>
    </div>`;

  mountSheet(inner, ({ close, sheet }) => {
    const boxes = Array.from(sheet.querySelectorAll('[data-scan-index]'));
    const confirmBtn = sheet.querySelector('#scanConfirm');

    const sync = () => {
      const count = boxes.filter((box) => box.checked).length;
      confirmBtn.disabled = count === 0;
      confirmBtn.textContent = count ? `录入选中的 ${count} 道` : '请先勾选';
    };

    boxes.forEach((box) => box.addEventListener('change', sync));
    sheet.querySelector('[data-scan-all]').addEventListener('click', () => {
      boxes.forEach((box) => {
        box.checked = true;
      });
      sync();
    });
    sheet.querySelector('[data-scan-none]').addEventListener('click', () => {
      boxes.forEach((box) => {
        box.checked = false;
      });
      sync();
    });
    sheet.querySelector('#scanCancel').addEventListener('click', () => {
      close();
      fetch(`/api/mistakes/scan/${encodeURIComponent(scan.id)}`, { method: 'DELETE' }).catch(() => {});
    });
    sync();

    confirmBtn.addEventListener('click', async () => {
      const indexes = boxes.filter((box) => box.checked).map((box) => Number(box.dataset.scanIndex));
      if (!indexes.length) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = '录入中…';
      try {
        const data = await api(`/api/mistakes/scan/${encodeURIComponent(scan.id)}/confirm`, {
          method: 'POST',
          body: JSON.stringify({ indexes }),
        });
        close();
        await refreshMistakes();
        toast(`已录入 ${data.items?.length || indexes.length} 道错题`);
        if (data.items?.[0]) openMistakeDetail(data.items[0].id);
      } catch (error) {
        toast(error.message, { type: 'error' });
        sync();
      }
    });
  });
}

function analysisKey(item) {
  return `${item.analyzing ? 1 : 0}|${item.analyzedAt || ''}|${item.analysisError || ''}`;
}

function mistakeAnalysisHtml(item) {
  if (item.analyzing) {
    return `<div class="d-block da-loading">
      <span class="dot-bounce"><i></i><i></i><i></i></span>
      <p>AI 正在后台分析，可以先关掉这里去做别的，结果好了会自动出现</p>
    </div>`;
  }
  if (item.analyzedAt) {
    const parts = [];
    if (item.answer) {
      parts.push(`<div class="d-block"><div class="d-label">正确答案与关键步骤</div><div class="d-text">${esc(item.answer)}</div></div>`);
    }
    if (item.cause) {
      parts.push(`<div class="d-block"><div class="d-label">错因分析</div><div class="d-text d-cause">${esc(item.cause)}</div></div>`);
    }
    if (item.advice) {
      parts.push(`<div class="d-block"><div class="d-label">练习建议</div><div class="d-text">${esc(item.advice)}</div></div>`);
    }
    if (item.points?.length) {
      parts.push(
        `<div class="d-block"><div class="d-label">知识点</div><div class="d-points">${item.points
          .map((p) => `<span class="d-point">${esc(p)}</span>`)
          .join('')}</div></div>`
      );
    }
    return parts.join('') || '<div class="d-block mistake-loading">分析完成了，但没拿到内容，可以重新分析一次。</div>';
  }
  if (item.analysisError) {
    return `<div class="d-block mistake-loading">分析失败：${esc(item.analysisError)}<br>可以点下面的「AI 分析」重试。</div>`;
  }
  return '<div class="d-block mistake-loading">这道错题还没分析过，点下面的「AI 分析」试试。</div>';
}

function mistakeDetailHtml(item) {
  const mastered = item.status === 'mastered';
  const analyzed = Boolean(item.analyzedAt);
  return `<div class="mistake-detail" style="--subject-color:${esc(subjectColor(item.subject))}">
    ${item.image ? `<img class="mistake-detail-img" src="/api/mistakes/${encodeURIComponent(item.id)}/image" alt="错题照片">` : ''}
    ${item.question ? `<div class="d-block"><div class="d-label">题目</div><div class="d-text">${esc(item.question)}</div></div>` : ''}
    <div class="d-analysis" data-analysis data-key="${esc(analysisKey(item))}">${mistakeAnalysisHtml(item)}</div>
    ${item.note ? `<div class="d-block"><div class="d-label">我的备注</div><div class="d-text">${esc(item.note)}</div></div>` : ''}
    <div class="d-actions">
      <button class="btn ghost ai-glow" data-action="mistake-analyze" data-mistake="${esc(item.id)}" type="button" ${item.analyzing ? 'disabled' : ''}>${item.analyzing ? 'AI 分析中…' : analyzed ? '重新 AI 分析' : 'AI 分析'}</button>
      <button class="btn ${mastered ? 'ghost' : 'primary'}" data-action="mistake-toggle" data-mistake="${esc(item.id)}" type="button">${mastered ? '标回待巩固' : '标记已掌握'}</button>
      <button class="btn danger" data-action="mistake-del" data-mistake="${esc(item.id)}" type="button">删除</button>
    </div>
  </div>`;
}

function openMistakeDetail(id) {
  const item = mistakeById(id);
  if (!item) return;
  const inner = `<h2>${esc(mistakeSubjectName(item.subject))} · 错题详情</h2>${mistakeDetailHtml(item)}
    <div class="sheet-actions"><span class="spacer"></span><button class="btn ghost" data-close type="button">关闭</button></div>`;

  mountSheet(inner, ({ close, sheet }) => {
    mistakeDetailCtx = { id, sheet };

    sheet
      .querySelector('[data-action="mistake-analyze"]')
      ?.addEventListener('click', () => beginMistakeAnalysis(id));

    sheet
      .querySelector('[data-action="mistake-toggle"]')
      ?.addEventListener('click', async () => {
        const fresh = mistakeById(id);
        const next = fresh?.status === 'mastered' ? 'open' : 'mastered';
        try {
          await api(`/api/mistakes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
          await refreshMistakes();
          updateMistakeDetailSheet();
          toast(next === 'mastered' ? '已标记掌握，继续加油' : '已标回待巩固');
        } catch (error) {
          toast(error.message, { type: 'error' });
        }
      });

    sheet
      .querySelector('[data-action="mistake-del"]')
      ?.addEventListener('click', async () => {
        if (!window.confirm('删除这道错题？照片也会一并删除。')) return;
        try {
          await api(`/api/mistakes/${encodeURIComponent(id)}`, { method: 'DELETE' });
          mistakeDetailCtx = null;
          await refreshMistakes();
          close();
          toast('错题已删除');
        } catch (error) {
          toast(error.message, { type: 'error' });
        }
      });

    if (item.analyzing) startMistakePoll();
  });
}

let mistakeDetailCtx = null;
let mistakePollTimer = null;

async function beginMistakeAnalysis(id) {
  try {
    await api(`/api/mistakes/${encodeURIComponent(id)}/analyze`, { method: 'POST', body: '{}' });
    await refreshMistakes();
    updateMistakeDetailSheet();
    toast('已开始后台分析，可以关掉这里等结果');
    startMistakePoll();
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

// 轮询：列表里还有分析中的错题就每 3 秒刷新一次
function startMistakePoll() {
  if (mistakePollTimer) return;
  mistakePollTimer = setInterval(async () => {
    await refreshMistakes();
    updateMistakeDetailSheet();
    if (!state.mistakes.some((item) => item.analyzing)) {
      clearInterval(mistakePollTimer);
      mistakePollTimer = null;
    }
  }, 3000);
}

// 详情弹层就地更新，不打断浏览
function updateMistakeDetailSheet() {
  const ctx = mistakeDetailCtx;
  if (!ctx) return;
  const { id, sheet } = ctx;
  if (!sheet.isConnected) {
    mistakeDetailCtx = null;
    return;
  }
  const item = mistakeById(id);
  if (!item) return;

  const box = sheet.querySelector('[data-analysis]');
  if (box && box.dataset.key !== analysisKey(item)) {
    box.dataset.key = analysisKey(item);
    box.innerHTML = mistakeAnalysisHtml(item);
  }

  const analyzeBtn = sheet.querySelector('[data-action="mistake-analyze"]');
  if (analyzeBtn) {
    analyzeBtn.disabled = Boolean(item.analyzing);
    analyzeBtn.textContent = item.analyzing ? 'AI 分析中…' : item.analyzedAt ? '重新 AI 分析' : 'AI 分析';
  }

  const toggle = sheet.querySelector('[data-action="mistake-toggle"]');
  if (toggle) {
    const mastered = item.status === 'mastered';
    toggle.textContent = mastered ? '标回待巩固' : '标记已掌握';
    toggle.className = `btn ${mastered ? 'ghost' : 'primary'}`;
  }
}

function openMoveSheet(taskId) {
  const plan = state.data?.plan;
  const task = plan?.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const today = dateKey();
  const holidayMap = new Map((state.data.settings?.holidays || []).map((item) => [item.date, item.name]));

  const rows = [];
  for (let key = today; key <= plan.examDate; key = addDays(key, 1)) {
    const day = plan.days.find((item) => item.date === key);
    const weekday = parseDay(key).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const tag = day?.holidayName || holidayMap.get(key) || (isWeekend ? '周末' : '上学日');
    rows.push({
      key,
      tag,
      daysLeft: day?.daysLeft ?? Math.round((parseDay(plan.examDate) - parseDay(key)) / 86400000),
      minutes: day?.minutes ?? 0,
      current: key === task.date,
    });
  }

  const inner = `<h2>移动到哪天？</h2>
    <p class="muted" style="margin:0 0 12px">「${esc(task.title)}」现在在 ${formatDate(task.date)}（${weekdayName(task.date)}）。上学日也能安排，选了就会生成一个「手动安排」的日子。</p>
    <div class="move-list">
      ${rows
        .map(
          (row) => `<button class="move-day ${row.current ? 'is-current' : ''}" data-move-date="${esc(row.key)}" type="button" ${row.current ? 'disabled' : ''}>
            <span class="md-main"><b>${formatDate(row.key)}</b><span class="weekday">${weekdayName(row.key)}</span></span>
            <span class="chip ${row.tag === '上学日' ? '' : 'holiday'}">${esc(row.tag)}</span>
            <small>距考试 ${row.daysLeft} 天${row.minutes ? ` · 已排 ${row.minutes} 分钟` : ''}</small>
            ${row.current ? '<span class="md-now">当前</span>' : ''}
          </button>`
        )
        .join('')}
    </div>
    <div class="sheet-actions"><span class="spacer"></span><button class="btn ghost" data-close type="button">取消</button></div>`;

  mountSheet(inner, ({ close, sheet }) => {
    sheet.querySelectorAll('[data-move-date]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        const ok = await moveTaskTo(taskId, button.dataset.moveDate);
        if (ok) close();
        else button.disabled = false;
      });
    });
  });
}

async function moveTaskTo(taskId, date) {
  try {
    await api(`/api/exams/tasks/${encodeURIComponent(taskId)}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ date }),
    });
    state.data = await api('/api/exams');
    renderAll();
    toast(`已移到 ${formatDate(date)}（${weekdayName(date)}）`);
    // 落地高亮 + 滚动到新位置，让移动结果看得见
    requestAnimationFrame(() => {
      const row = document.querySelector(`.task[data-task="${CSS.escape(taskId)}"]`);
      if (!row) return;
      row.classList.add('just-moved');
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => row.classList.remove('just-moved'), 400);
    });
    return true;
  } catch (error) {
    toast(error.message, { type: 'error' });
    return false;
  }
}

// ---------- 拖动任务到某天 ----------
// 电脑：整行可拖（HTML5 drag）；
// 手机：按住任务行右侧的日历把手拖动（Pointer 事件 + 幽灵气泡）。

let draggingTaskId = null;
let dropHover = null;

function setDropHover(dayCard) {
  if (dropHover === dayCard) return;
  dropHover?.classList.remove('drop-hover');
  dayCard?.classList.add('drop-hover');
  dropHover = dayCard;
}

function clearDropHover() {
  dropHover?.classList.remove('drop-hover');
  dropHover = null;
}

document.addEventListener('dragstart', (event) => {
  const row = event.target.closest?.('.task[draggable="true"]');
  if (!row) return;
  draggingTaskId = row.dataset.task;
  document.body.classList.add('is-dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggingTaskId);
  row.classList.add('dragging');
});

document.addEventListener('dragend', () => {
  draggingTaskId = null;
  document.body.classList.remove('is-dragging');
  document.querySelector('.task.dragging')?.classList.remove('dragging');
  clearDropHover();
});

document.addEventListener('dragover', (event) => {
  if (!draggingTaskId) return;
  const dayCard = event.target.closest?.('[data-date]');
  if (dayCard) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropHover(dayCard);
  }
});

document.addEventListener('drop', (event) => {
  if (!draggingTaskId) return;
  const dayCard = event.target.closest?.('[data-date]');
  if (!dayCard) return;
  event.preventDefault();
  clearDropHover();
  document.body.classList.remove('is-dragging');
  const taskId = draggingTaskId;
  draggingTaskId = null;
  document.querySelector('.task.dragging')?.classList.remove('dragging');
  const task = state.data?.plan?.tasks.find((item) => item.id === taskId);
  if (!task || task.date === dayCard.dataset.date) return;
  moveTaskTo(taskId, dayCard.dataset.date);
});

// 手机端：从日历把手起拖
let suppressHandleClick = false;

document.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest?.('.task-move');
  if (!handle || event.button !== 0) return;
  const row = handle.closest('.task');
  const taskId = row?.dataset.task;
  if (!taskId) return;

  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  let ghost = null;
  let raf = 0;
  let point = { x: startX, y: startY };
  let target = null;
  let scrollSpeed = 0;

  try {
    handle.setPointerCapture(event.pointerId);
  } catch {}

  // 每帧只写一次 transform，避免拖动时重排掉帧
  const paint = () => {
    raf = 0;
    if (!ghost) return;
    ghost.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -130%)`;
    target = document.elementFromPoint(point.x, point.y);
    setDropHover(target?.closest?.('[data-date]') || null);

    // 靠近上下边缘自动滚动
    const edge = 90;
    const h = window.innerHeight;
    if (point.y < edge) scrollSpeed = -Math.ceil((edge - point.y) / 8);
    else if (point.y > h - edge) scrollSpeed = Math.ceil((point.y - (h - edge)) / 8);
    else scrollSpeed = 0;

    if (scrollSpeed) {
      window.scrollBy(0, scrollSpeed);
      raf = requestAnimationFrame(paint);
    }
  };

  const onMove = (moveEvent) => {
    if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 8) return;
    if (!moved) {
      moved = true;
      const task = state.data?.plan?.tasks.find((item) => item.id === taskId);
      ghost = document.createElement('div');
      ghost.className = 'task-ghost';
      ghost.textContent = task?.title || '复习任务';
      document.body.appendChild(ghost);
      document.body.classList.add('is-dragging');
      row?.classList.add('dragging');
    }
    point = { x: moveEvent.clientX, y: moveEvent.clientY };
    if (!raf) raf = requestAnimationFrame(paint);
    moveEvent.preventDefault();
  };

  const onUp = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    const dayCard = dropHover;
    clearDropHover();
    ghost?.remove();
    ghost = null;
    document.body.classList.remove('is-dragging');
    row?.classList.remove('dragging');
    if (moved && dayCard) {
      suppressHandleClick = true;
      setTimeout(() => {
        suppressHandleClick = false;
      }, 400);
      const task = state.data?.plan?.tasks.find((item) => item.id === taskId);
      if (task && task.date !== dayCard.dataset.date) moveTaskTo(taskId, dayCard.dataset.date);
    }
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
});

// 拖完的那一下不算点击（否则会弹出行程选择框）
document.addEventListener(
  'click',
  (event) => {
    if (suppressHandleClick && event.target.closest?.('.task-move')) {
      event.stopPropagation();
      event.preventDefault();
    }
  },
  true
);

// ---------- 弹层 ----------

function mountSheet(inner, wire) {
  modalRoot.innerHTML = `<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`;
  document.body.classList.add('modal-open');
  const backdrop = modalRoot.querySelector('.sheet-backdrop');
  const sheet = modalRoot.querySelector('.sheet');

  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  function close() {
    document.removeEventListener('keydown', onKey);
    modalRoot.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  sheet.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
  wire?.({ close, sheet });
  return close;
}

function scoreRowsHtml(exam) {
  return examSubjects(exam)
    .map((subject) => {
      const entry = exam.scores?.[subject.key] || {};
      return `<div class="score-input-row" data-key="${esc(subject.key)}">
        <span class="subject-name"><i style="background:${esc(subject.color)}"></i>${esc(subject.name)}</span>
        <input class="mini-input" data-field="score" type="number" min="0" step="0.5" value="${entry.score ?? ''}" placeholder="得分">
        <input class="mini-input" data-field="full" type="number" min="1" step="1" value="${entry.full ?? subject.full}" placeholder="满分">
        <input class="mini-input" data-field="classAvg" type="number" step="0.5" value="${entry.classAvg ?? ''}" placeholder="班平均">
        <input class="mini-input" data-field="rank" type="number" min="1" step="1" value="${entry.rank ?? ''}" placeholder="排名">
        <input class="mini-input wide" data-field="note" type="text" maxlength="60" value="${esc(entry.note || '')}" placeholder="试卷备注（可选）：失分点 / 题型问题">
      </div>`;
    })
    .join('');
}

function openScoreModal(examId) {
  const exams = sortedExams();
  if (!exams.length) {
    toast('先新增一场考试', { type: 'info' });
    openExamModal();
    return;
  }
  let currentId =
    examId ||
    state.scoreExamId ||
    upcomingExam()?.id ||
    (state.data.plan?.examId ?? '') ||
    exams[exams.length - 1].id;
  if (!examById(currentId)) currentId = exams[exams.length - 1].id;
  state.scoreExamId = currentId;

  const options = exams
    .map(
      (exam) =>
        `<option value="${esc(exam.id)}" ${exam.id === currentId ? 'selected' : ''}>${esc(exam.name)} · ${esc(formatFull(exam.date))}</option>`
    )
    .join('');

  const inner = `<h2>录入成绩</h2>
    <label class="field"><span>考试</span><select id="scoreExam">${options}</select></label>
    <div class="score-grid-head"><span>科目</span><span>得分</span><span>满分</span><span>班平均</span><span>排名</span></div>
    <div id="scoreRows">${scoreRowsHtml(examById(currentId))}</div>
    <div class="sheet-actions">
      <span class="muted" style="flex:1">留空的科目不会保存；填了备注会出现在试卷分析里。</span>
      <button class="btn ghost" data-close type="button">取消</button>
      <button class="btn primary" id="scoreSave" type="button">保存成绩</button>
    </div>`;

  mountSheet(inner, ({ close, sheet }) => {
    const select = sheet.querySelector('#scoreExam');
    select.addEventListener('change', () => {
      currentId = select.value;
      state.scoreExamId = currentId;
      sheet.querySelector('#scoreRows').innerHTML = scoreRowsHtml(examById(currentId));
    });

    sheet.querySelector('#scoreSave').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const scores = {};
      for (const row of sheet.querySelectorAll('.score-input-row')) {
        const key = row.dataset.key;
        const value = (field) => row.querySelector(`[data-field="${field}"]`).value.trim();
        scores[key] = {
          score: value('score'),
          full: Number(value('full')) || undefined,
          classAvg: value('classAvg'),
          rank: value('rank'),
          note: value('note'),
        };
      }
      button.disabled = true;
      try {
        await api(`/api/exams/${encodeURIComponent(currentId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ scores }),
        });
        await load();
        close();
        toast('成绩已保存，分析已更新');
      } catch (error) {
        toast(error.message, { type: 'error' });
        button.disabled = false;
      }
    });
  });
}

function openExamModal(exam = null) {
  const isNew = !exam;
  const base = exam
    ? { ...exam }
    : {
        name: '',
        date: dateKey(),
        kind: '月考',
        note: '',
        subjects: subjects().map((subject) => subject.key),
      };

  const inner = `<h2>${isNew ? '新增考试' : '编辑考试'}</h2>
    <label class="field"><span>考试名称</span>
      <input id="examName" maxlength="40" value="${esc(base.name)}" placeholder="例如：2027 中考 / 区一模">
    </label>
    <div class="form-row">
      <label class="field"><span>日期</span><input id="examDate" type="date" value="${esc(base.date)}"></label>
      <label class="field"><span>类型</span>
        <select id="examKind">${KINDS.map((kind) => `<option ${kind === base.kind ? 'selected' : ''}>${kind}</option>`).join('')}</select>
      </label>
    </div>
    <label class="field"><span>备注（可选）</span>
      <input id="examNote" maxlength="120" value="${esc(base.note || '')}" placeholder="例如：日期按学校通知">
    </label>
    <div class="field"><span>计入科目</span>
      <div class="subject-picks">
        ${subjects()
          .map(
            (subject) =>
              `<label class="pick"><input type="checkbox" value="${esc(subject.key)}" ${
                base.subjects?.includes(subject.key) ? 'checked' : ''
              }><span>${esc(subject.name)}</span></label>`
          )
          .join('')}
      </div>
    </div>
    <div class="sheet-actions">
      ${isNew ? '' : '<button class="btn danger" id="examDelete" type="button">删除</button>'}
      <span class="spacer"></span>
      <button class="btn ghost" data-close type="button">取消</button>
      <button class="btn primary" id="examSave" type="button">保存</button>
    </div>`;

  mountSheet(inner, ({ close, sheet }) => {
    sheet.querySelector('#examSave').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const payload = {
        name: sheet.querySelector('#examName').value.trim(),
        date: sheet.querySelector('#examDate').value,
        kind: sheet.querySelector('#examKind').value,
        note: sheet.querySelector('#examNote').value.trim(),
        subjects: [...sheet.querySelectorAll('.subject-picks input:checked')].map((input) => input.value),
      };
      if (!payload.name) {
        toast('请填写考试名称', { type: 'error' });
        return;
      }
      const planWillClear =
        !isNew && payload.date !== exam.date && state.data.plan?.examId === exam.id;
      button.disabled = true;
      try {
        if (isNew) {
          await api('/api/exams', { method: 'POST', body: JSON.stringify(payload) });
        } else {
          await api(`/api/exams/${encodeURIComponent(exam.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
        }
        await load();
        close();
        if (planWillClear) {
          toast('日期已更新，正在按新日期重排复习计划', { type: 'info', duration: 2600 });
          await generatePlan(exam.id);
        } else {
          toast('考试已保存');
        }
      } catch (error) {
        toast(error.message, { type: 'error' });
        button.disabled = false;
      }
    });

    if (!isNew) {
      sheet.querySelector('#examDelete').addEventListener('click', async () => {
        if (!window.confirm(`删除「${exam.name}」及其成绩记录？`)) return;
        try {
          await api(`/api/exams/${encodeURIComponent(exam.id)}`, { method: 'DELETE' });
          await load();
          close();
          toast('考试已删除');
        } catch (error) {
          toast(error.message, { type: 'error' });
        }
      });
    }
  });
}

// ---------- 任务与设置操作 ----------

function refreshPlanProgress() {
  const plan = state.data.plan;
  if (!plan) return;
  const total = plan.tasks.length;
  const done = plan.tasks.filter((task) => task.done).length;
  const value = total ? Math.round((done / total) * 100) : 0;
  panel.plan.querySelectorAll('.progress-line > i').forEach((node) => {
    node.style.width = `${value}%`;
  });
  panel.plan.querySelectorAll('.progress-wrap > .muted').forEach((node) => {
    node.textContent = `已完成 ${done} / ${total} 项 · ${value}%`;
  });
  panel.plan.querySelectorAll('.day-card').forEach((card) => {
    const tasks = plan.tasks.filter((task) => task.date === card.dataset.date);
    const right = card.querySelector('.day-head .right');
    if (right) right.textContent = `${tasks.filter((task) => task.done).length}/${tasks.length} 已完成`;
  });
  const todayNode = panel.overview.querySelector('.card-head .muted');
  if (todayNode && /已完成$/.test(todayNode.textContent)) {
    const today = dateKey();
    const tasks = plan.tasks.filter((task) => task.date === today);
    todayNode.textContent = `${tasks.filter((task) => task.done).length}/${tasks.length} 已完成`;
  }
  renderStats();
}

async function toggleTaskRow(element) {
  const taskId = element.dataset.task;
  const task = state.data.plan?.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const next = !task.done;
  task.done = next;
  element.classList.toggle('done', next);
  document.querySelectorAll(`[data-task="${CSS.escape(taskId)}"]`).forEach((node) => {
    node.classList.toggle('done', next);
  });
  refreshPlanProgress();
  try {
    const plan = await api(`/api/exams/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: next }),
    });
    state.data.plan = plan;
    if (state.planFilter !== 'all') renderPlan();
  } catch (error) {
    task.done = !next;
    element.classList.toggle('done', !next);
    document.querySelectorAll(`[data-task="${CSS.escape(taskId)}"]`).forEach((node) => {
      node.classList.toggle('done', !next);
    });
    refreshPlanProgress();
    toast(error.message, { type: 'error' });
  }
}

async function generatePlan(examId, options = {}) {
  const button = options.button || null;
  if (button) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.innerHTML = '<span class="spin"></span>AI 分析中…';
  }
  if (options.useAI) {
    toast('AI 正在分析强弱科和历史成绩，可能需要 10–30 秒…', { type: 'info', duration: 6000 });
  }
  try {
    const plan = await api(`/api/exams/${encodeURIComponent(examId)}/plan`, {
      method: 'POST',
      body: JSON.stringify({ useAI: Boolean(options.useAI) }),
    });
    state.data.plan = plan;
    state.planExamId = examId;
    state.planRange = 14;
    state.planFilter = 'all';
    state.planSubject = 'all';
    renderStats();
    renderOverview();
    renderPlan();
    const days = plan.days.length;
    const prefix = plan.aiStrategy?.usedAI ? 'AI 已排期' : '已生成';
    toast(`${prefix}：${days} 天复习计划，共 ${plan.tasks.length} 项任务`);
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.label || 'AI 智能排期';
    }
  }
}

async function saveMinutes(button) {
  const minutes = Number(document.getElementById('setMinutes')?.value);
  const perDay = Number(document.getElementById('setSubjectsPerDay')?.value);

  if (!Number.isFinite(minutes) || minutes < 30 || minutes > 600) {
    toast('每天时长需要在 30–600 分钟之间', { type: 'error' });
    return;
  }
  if (!Number.isFinite(perDay) || perDay < 0 || perDay > 8) {
    toast('每天科目数需要在 0–8 之间（0 表示自动）', { type: 'error' });
    return;
  }

  button.disabled = true;
  try {
    const settings = await api('/api/exams/settings', {
      method: 'PUT',
      body: JSON.stringify({ dailyMinutes: minutes, dailySubjects: perDay }),
    });
    state.data.settings = settings;
    renderSettings();
    renderPlan();
    toast('每日复习节奏已保存');
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    button.disabled = false;
  }
}

async function saveSubjects(button) {
  const rows = [...panel.settings.querySelectorAll('#subjectTable .row')];
  const payload = rows.map((row) => {
    const subject = subjects().find((item) => item.key === row.dataset.key) || {};
    return {
      key: row.dataset.key,
      name: subject.name,
      color: subject.color,
      full: Number(row.querySelector('[data-field="full"]').value),
      target: Number(row.querySelector('[data-field="target"]').value),
      level: row.querySelector('.level-pick .lvl.is-on')?.dataset.level || 'normal',
    };
  });
  if (payload.some((item) => !item.full || item.full < 1)) {
    toast('满分需要大于 0', { type: 'error' });
    return;
  }
  button.disabled = true;
  try {
    await api('/api/exams/settings', { method: 'PUT', body: JSON.stringify({ subjects: payload }) });
    await load();
    toast('科目与强弱科已保存，重新生成计划后生效');
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    button.disabled = false;
  }
}

// ---------- 假期（按块录入） ----------

function holidayGroups() {
  const rows = [...(state.holidayDraft || [])].sort((a, b) => a.date.localeCompare(b.date));
  const groups = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.name === row.name && addDays(last.end, 1) === row.date) {
      last.end = row.date;
      last.count += 1;
    } else {
      groups.push({ name: row.name, start: row.date, end: row.date, count: 1 });
    }
  }
  return groups;
}

function addHolidayBlock() {
  const name = document.getElementById('holName')?.value.trim();
  const start = document.getElementById('holStart')?.value;
  const days = Number(document.getElementById('holDays')?.value);
  if (!name) {
    toast('请填写假期名称', { type: 'error' });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) {
    toast('请选择开始日期', { type: 'error' });
    return;
  }
  if (!Number.isFinite(days) || days < 1 || days > 60) {
    toast('持续天数需要是 1–60', { type: 'error' });
    return;
  }
  state.holidayDraft ||= [];
  for (let i = 0; i < days; i += 1) {
    state.holidayDraft.push({ date: addDays(start, i), name });
  }
  renderSettings();
  toast(`已添加「${name}」${days} 天，记得点「保存假期」`, { type: 'info' });
}

function deleteHolidayGroup(index) {
  const group = holidayGroups()[index];
  if (!group) return;
  state.holidayDraft = (state.holidayDraft || []).filter(
    (row) => !(row.name === group.name && row.date >= group.start && row.date <= group.end)
  );
  renderSettings();
}

async function saveHolidays(button) {
  const draft = state.holidayDraft || [];
  if (draft.some((row) => !/^\d{4}-\d{2}-\d{2}$/.test(row.date))) {
    toast('有假期的日期格式不正确', { type: 'error' });
    return;
  }
  button.disabled = true;
  try {
    await api('/api/exams/settings', { method: 'PUT', body: JSON.stringify({ holidays: draft }) });
    await load();
    toast(`假期日历已保存（共 ${draft.length} 天）`);
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    button.disabled = false;
  }
}

async function saveMaterials(button) {
  const rows = [...panel.settings.querySelectorAll('#materialTable .material-row')];
  if (rows.some((row) => !row.querySelector('[data-field="name"]').value.trim())) {
    toast('教辅名称不能为空', { type: 'error' });
    return;
  }
  const materialsPayload = rows.map((row) => ({
    key: row.dataset.key,
    name: row.querySelector('[data-field="name"]').value.trim(),
    subject: row.querySelector('[data-field="subject"]').value,
  }));
  button.disabled = true;
  try {
    await api('/api/exams/settings', {
      method: 'PUT',
      body: JSON.stringify({ materials: materialsPayload }),
    });
    await load();
    toast('教辅已保存，到「复习计划」重新生成后生效', { duration: 4200 });
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    button.disabled = false;
  }
}

function addMaterialRow() {
  const table = document.getElementById('materialTable');
  if (!table) return;
  const empty = table.querySelector('.muted');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = 'material-row';
  row.dataset.key = `mat_${Date.now().toString(36)}`;
  row.innerHTML = `
    <input class="mini-input" data-field="name" maxlength="30" value="" placeholder="教辅名称">
    <select class="mini-input" data-field="subject" aria-label="科目">
      ${subjects().map((subject) => `<option value="${esc(subject.key)}">${esc(subject.name)}</option>`).join('')}
    </select>
    <button class="icon-btn small-btn" data-action="del-material" type="button" aria-label="删除教辅">×</button>`;
  table.appendChild(row);
  row.querySelector('[data-field="name"]').focus();
}

// ---------- 事件 ----------

document.addEventListener('click', async (event) => {
  const actionNode = event.target.closest('[data-action]');
  if (actionNode) {
    const action = actionNode.dataset.action;
    const examId = actionNode.dataset.exam;
    if (action === 'gen-plan') return generatePlan(examId || state.planExamId);
    if (action === 'gen-plan-ai') {
      return generatePlan(examId || state.planExamId, { useAI: true, button: actionNode });
    }
    if (action === 'goto-plan') return switchTab('plan');
    if (action === 'entry') return openScoreModal(examId);
    if (action === 'new-exam') return openExamModal();
    if (action === 'edit-exam') return openExamModal(examById(examId));
    if (action === 'del-exam') {
      const exam = examById(examId);
      if (!exam) return;
      if (!window.confirm(`删除「${exam.name}」及其成绩记录？`)) return;
      try {
        await api(`/api/exams/${encodeURIComponent(examId)}`, { method: 'DELETE' });
        await load();
        toast('考试已删除');
      } catch (error) {
        toast(error.message, { type: 'error' });
      }
      return;
    }
    if (action === 'save-minutes') return saveMinutes(actionNode);
    if (action === 'save-subjects') return saveSubjects(actionNode);
    if (action === 'save-holidays') return saveHolidays(actionNode);
    if (action === 'add-holiday-block') return addHolidayBlock();
    if (action === 'del-holiday-group') {
      deleteHolidayGroup(Number(actionNode.dataset.index));
      return;
    }
    if (action === 'save-materials') return saveMaterials(actionNode);
    if (action === 'add-material') return addMaterialRow();
    if (action === 'del-material') {
      actionNode.closest('.material-row')?.remove();
      return;
    }
    if (action === 'new-mistake') return openMistakeModal();
    if (action === 'mistake-review') return startMistakeReview();
    if (action === 'mistake-open') return openMistakeDetail(actionNode.dataset.mistake);
    if (action === 'move-task') return openMoveSheet(actionNode.dataset.taskId);
  }

  const taskNode = event.target.closest('[data-task]');
  if (taskNode) {
    await toggleTaskRow(taskNode);
  }
});

document.addEventListener('click', (event) => {
  const levelButton = event.target.closest?.('.level-pick .lvl');
  if (!levelButton) return;
  const group = levelButton.closest('.level-pick');
  group?.querySelectorAll('.lvl').forEach((node) => node.classList.toggle('is-on', node === levelButton));
});

document.addEventListener('change', async (event) => {
  const filterNode = event.target.closest?.('[data-mistake-filter]');
  if (filterNode) {
    const key = filterNode.dataset.mistakeFilter;
    const value = filterNode.value;
    if (key === 'subject') state.mistakeSubject = value;
    if (key === 'status') state.mistakeStatus = value;
    renderMistakes();
    return;
  }
  const input = event.target.closest?.('[data-pack]');
  if (!input) return;
  const item = input.closest('.pack-item');
  item?.classList.toggle('checked', input.checked);
  try {
    const packing = await api('/api/exams/packing', {
      method: 'PATCH',
      body: JSON.stringify({ week: nextFridayKey(), key: input.dataset.pack, packed: input.checked }),
    });
    state.data.packing = packing;
  } catch (error) {
    input.checked = !input.checked;
    item?.classList.toggle('checked', input.checked);
    toast(error.message, { type: 'error' });
  }
});

document.addEventListener('keydown', (event) => {
  const taskNode = event.target.closest?.('[data-task]');
  if (!taskNode) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleTaskRow(taskNode);
  }
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

function switchTab(name) {
  if (!panel[name]) return;
  state.tab = name;
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  Object.entries(panel).forEach(([key, node]) => {
    node.classList.toggle('is-active', key === name);
  });
  try {
    history.replaceState(null, '', name === 'overview' ? location.pathname : `#${name}`);
  } catch {
    // 忽略
  }
}

function initThemeButton() {
  const button = document.getElementById('themeBtnExam');
  if (!button) return;
  const mode = window.RHTheme?.read() || 'auto';
  button.textContent = THEME_LABELS[mode];
  button.addEventListener('click', () => {
    const result = window.RHTheme?.cycle();
    if (!result) return;
    button.textContent = THEME_LABELS[result.mode];
    toast(`主题已切换：${THEME_LABELS[result.mode]}`, { type: 'info', duration: 2000 });
  });
}

async function init() {
  initThemeButton();
  Object.values(panel).forEach((node) => {
    node.innerHTML = '<div class="card"><p class="muted">加载中…</p></div>';
  });
  try {
    await load();
  } catch (error) {
    toast(`加载失败：${error.message}`, { type: 'error', duration: 5000 });
    panel.overview.innerHTML = `<div class="card"><p class="muted">考试中心数据加载失败：${esc(error.message)}</p></div>`;
    return;
  }

  const hash = location.hash.replace('#', '');
  if (hash && panel[hash]) switchTab(hash);
}

init();
