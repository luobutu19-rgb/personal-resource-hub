// 主页点阵屏：像素图标 + 今日概览

const GRID = 16;
const DOT_ROWS = 10;

const ICON_CALENDAR = [
  '................',
  '...##########...',
  '..##........##..',
  '..#..........#..',
  '..############..',
  '..#..........#..',
  '..#..##..##..#..',
  '..#..##..##..#..',
  '..#..........#..',
  '..#..##..##..#..',
  '..#..##..##..#..',
  '..#..........#..',
  '..############..',
  '................',
  '................',
  '................',
];

const ICON_BOOK = [
  '................',
  '................',
  '..#####..#####..',
  '..#...#..#...#..',
  '..#...#..#...#..',
  '..#...####...#..',
  '..#..........#..',
  '..############..',
  '..#..........#..',
  '..#..........#..',
  '..############..',
  '..#..........#..',
  '..#..........#..',
  '..############..',
  '................',
  '................',
];

const ICON_FLAME = [
  '................',
  '.......##.......',
  '......####......',
  '......####......',
  '.....######.....',
  '....###..###....',
  '...###....###...',
  '...##..##..##...',
  '..###..##..###..',
  '..###.####.###..',
  '..##########.#..',
  '...##########...',
  '....########....',
  '......####......',
  '.......##.......',
  '................',
];

let state = null;

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function dayDiff(target) {
  const a = new Date(`${todayKey()}T00:00:00`);
  const b = new Date(`${target}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function drawBoard(pattern, accent) {
  const canvas = document.getElementById('pbCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const cell = size / GRID;
  ctx.clearRect(0, 0, size, size);

  const baseColor = cssVar('--line-strong', '#d8d3c7');
  const softColor = cssVar('--line', '#e6e2d9');

  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const filled = pattern[y] && pattern[y][x] === '#';
      ctx.beginPath();
      ctx.arc(x * cell + cell / 2, y * cell + cell / 2, filled ? cell * 0.34 : cell * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = filled ? accent : y % 2 === 0 ? softColor : baseColor;
      if (!filled) ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function barHtml(ratio, accent) {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * DOT_ROWS);
  let html = '';
  for (let i = 0; i < DOT_ROWS; i += 1) {
    html += `<i class="${i < filled ? 'on' : ''}" style="--i:${i}"></i>`;
  }
  return `<span class="pb-bar" style="--accent:${accent}">${html}</span>`;
}

function renderRows(rows) {
  const box = document.getElementById('pbRows');
  if (!box) return;
  box.innerHTML = rows
    .map(
      (row) => `<div class="pb-row">
        <span class="pb-row-label">${row.label}</span>
        ${barHtml(row.ratio, row.accent)}
        <b class="pb-row-value">${row.value}</b>
      </div>`
    )
    .join('');
}

async function load() {
  const board = document.getElementById('pixelBoard');
  if (!board) return;

  const [exams, mistakes, stats] = await Promise.all([
    fetch('/api/exams').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/api/mistakes').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/api/stats').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const today = todayKey();
  const examList = Array.isArray(exams?.exams) ? exams.exams : [];
  const nextExam = examList
    .filter((item) => item?.date && item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const daysLeft = nextExam ? dayDiff(nextExam.date) : null;

  const tasks = Array.isArray(exams?.plan?.tasks) ? exams.plan.tasks : [];
  const todayTasks = tasks.filter((task) => task.date === today);
  const doneToday = todayTasks.filter((task) => task.done).length;

  const mistakesList = Array.isArray(mistakes?.items) ? mistakes.items : [];
  const openMistakes = mistakesList.filter((item) => item.status !== 'mastered').length;
  const fileCount = stats?.total ?? stats?.count ?? 0;

  const accent = daysLeft !== null && daysLeft <= 7 ? '#e8923f' : cssVar('--accent', '#0e7c66');
  const pattern = daysLeft !== null && daysLeft <= 7 ? ICON_FLAME : daysLeft !== null ? ICON_CALENDAR : ICON_BOOK;

  const big = document.getElementById('pbBig');
  const label = document.getElementById('pbLabel');
  const sub = document.getElementById('pbSub');
  if (big) big.textContent = daysLeft === null ? '—' : String(daysLeft);
  if (label) label.textContent = daysLeft === null ? '暂无考试' : '天后考试';
  if (sub) {
    sub.textContent = nextExam
      ? `${nextExam.name || '考试'} · ${nextExam.date}`
      : '在考试中心添加一场考试，这里会显示倒计时';
  }

  drawBoard(pattern, accent);
  renderRows([
    { label: '今日复习', value: `${doneToday}/${todayTasks.length}`, ratio: todayTasks.length ? doneToday / todayTasks.length : 0, accent },
    { label: '待巩固错题', value: `${openMistakes}`, ratio: Math.min(openMistakes / 10, 1), accent: '#c2733f' },
    { label: '资料总数', value: `${fileCount}`, ratio: Math.min(fileCount / 50, 1), accent: cssVar('--accent', '#0e7c66') },
  ]);

  state = { daysLeft };
}

function tickClock() {
  const node = document.getElementById('pbClock');
  if (!node) return;
  const d = new Date();
  node.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function initPixelBoard() {
  const board = document.getElementById('pixelBoard');
  if (!board) return;

  load();
  tickClock();
  setInterval(tickClock, 20000);
  setInterval(load, 300000);
  window.addEventListener('rh:cache-changed', () => load());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });
  // 切换深浅色时重绘点阵
  new MutationObserver(() => load()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}
