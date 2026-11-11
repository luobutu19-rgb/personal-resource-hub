import { initRipple } from './ripple.js';

const CATEGORY_TINTS = {
  图片: '#e8735a',
  文档: '#5c6bc0',
  视频: '#8e5bc0',
  音频: '#d9a227',
  压缩包: '#7c8288',
  代码: '#2aa198',
  其他: '#8b8f93',
};

const CATEGORY_ICONS = {
  图片: 'image',
  文档: 'doc',
  视频: 'video',
  音频: 'audio',
  压缩包: 'archive',
  代码: 'code',
  其他: 'file',
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg']);

const RINGS = [
  { key: 'inner', speed: 7, dragFactor: 1 },
  { key: 'mid', speed: -4.6, dragFactor: 0.72 },
  { key: 'outer', speed: 3.2, dragFactor: 0.55 },
];

const stage = document.getElementById('stage');
const core = document.getElementById('core');
const emptyHint = document.getElementById('emptyHint');
const footHint = document.getElementById('footHint');
const legend = document.getElementById('legend');
const spinBtn = document.getElementById('spinBtn');
const themeBtn = document.getElementById('themeBtnOrbit');

const ringEls = {
  inner: document.getElementById('ringInner'),
  mid: document.getElementById('ringMid'),
  outer: document.getElementById('ringOuter'),
};
const guideEls = {
  inner: document.querySelector('[data-guide="inner"]'),
  mid: document.querySelector('[data-guide="mid"]'),
  outer: document.querySelector('[data-guide="outer"]'),
};

const angles = { inner: 0, mid: -18, outer: 12 };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let spinning = !reducedMotion;
let dragging = false;
let dragStartX = 0;
let dragStartAngles = { ...angles };
let files = [];
let stats = null;
let layoutInfo = null;
const orbitItems = [];
let lastDepthAt = 0;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function formatSizeShort(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  const units = [
    { limit: 1024 ** 2, base: 1024, unit: 'KB' },
    { limit: 1024 ** 3, base: 1024 ** 2, unit: 'MB' },
    { limit: Infinity, base: 1024 ** 3, unit: 'GB' },
  ];
  for (const { limit, base, unit } of units) {
    if (size < limit) {
      const value = size / base;
      return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
    }
  }
  return `${size} B`;
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="/icons.svg#i-${name}"></use></svg>`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeLayout() {
  const width = stage.clientWidth || 360;
  const height = stage.clientHeight || 480;
  const minSide = Math.min(width, height);
  const base = minSide / 2 - 8;
  const small = minSide < 560;
  const card = small ? clamp(base * 0.3, 50, 58) : clamp(base * 0.235, 62, 86);
  const coreHalf = small ? Math.min(base * 0.5, 95) : Math.min(base * 0.4, 146);

  const innerR = coreHalf + card * 0.72 + 6;
  const outerR = Math.max(innerR, base - card * 0.42);

  const countFor = (radius, cap) => clamp(Math.round((2 * Math.PI * radius) / (card * 1.5)), 3, cap);
  const radii = { inner: outerR, mid: outerR, outer: outerR };
  const counts = { inner: 0, mid: 0, outer: countFor(outerR, 10) };

  // 环形之间留得下卡片的距离时，才分多层轨道；手机竖屏通常只保留一层，避免互相压叠
  if (outerR - innerR >= card * 1.25) {
    radii.inner = innerR;
    radii.mid = (innerR + outerR) / 2;
    counts.inner = countFor(innerR, small ? 5 : 6);
    counts.mid = small ? 0 : countFor(radii.mid, 8);
  }

  return { small, card, coreSize: coreHalf * 2, radii, counts };
}

function orderedFiles() {
  return files
    .slice()
    .sort((a, b) => {
      if (Boolean(b.favorite) !== Boolean(a.favorite)) return b.favorite ? 1 : -1;
      return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    });
}

function cardMarkup(file) {
  const isLink = file.kind === 'link';
  const ext = String(file.ext || '').toLowerCase();
  const isImage = !isLink && IMAGE_EXTS.has(ext);
  const tint = isLink ? '#0e7c66' : CATEGORY_TINTS[file.category] || CATEGORY_TINTS.其他;
  const href = `/?file=${encodeURIComponent(file.id)}`;

  let media;
  if (isLink) {
    media = file.coverPath
      ? `<span class="orbit-thumb" style="background-image:url('/api/files/${encodeURIComponent(file.id)}/cover')"></span>`
      : `<span class="orbit-icon">${icon('link')}</span>`;
  } else if (isImage) {
    media = `<span class="orbit-thumb" style="background-image:url('/api/files/${encodeURIComponent(file.id)}/raw')"></span>`;
  } else {
    media = `<span class="orbit-icon">${icon(CATEGORY_ICONS[file.category] || 'file')}</span>`;
  }

  return `<a class="orbit-card" href="${href}" title="${esc(file.title)}" style="--tint:${tint}">
    ${media}
    <span class="orbit-label">${esc(file.title)}</span>
  </a>`;
}

function buildOrbit() {
  layoutInfo = computeLayout();
  const ordered = orderedFiles();
  let cursor = 0;

  stage.style.setProperty('--card', `${layoutInfo.card}px`);
  core.style.width = `${layoutInfo.coreSize}px`;
  core.style.height = `${layoutInfo.coreSize}px`;
  orbitItems.length = 0;

  for (const def of RINGS) {
    const ring = ringEls[def.key];
    const guide = guideEls[def.key];
    const count = layoutInfo.counts[def.key];
    const radius = layoutInfo.radii[def.key];
    ring.innerHTML = '';

    if (!count || cursor >= ordered.length) {
      ring.hidden = true;
      if (guide) guide.hidden = true;
      continue;
    }

    ring.hidden = false;
    ring.style.setProperty('--r', `${radius}px`);
    if (guide) {
      guide.hidden = false;
      guide.style.width = `${radius * 2}px`;
      guide.style.height = `${radius * 2}px`;
    }

    const slice = ordered.slice(cursor, cursor + count);
    cursor += slice.length;

    slice.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'orbit-item';
      item.style.setProperty('--a', `${(360 / count) * index}deg`);
      item.style.setProperty('--r', `${radius}px`);
      item.innerHTML = cardMarkup(file);
      ring.appendChild(item);
      orbitItems.push({ el: item, baseAngle: (360 / count) * index, ring: def.key, filter: '' });
    });
  }

  emptyHint.hidden = ordered.length > 0;
  applyAngles();
  updateDepth(true);
}

function applyAngles() {
  for (const def of RINGS) {
    ringEls[def.key].style.setProperty('--spin', `${angles[def.key]}deg`);
  }
}

// 轨道后半圈（上方）逐渐加上高斯模糊，形成景深效果
function updateDepth(force = false) {
  const now = performance.now();
  if (!force && now - lastDepthAt < 90) return;
  lastDepthAt = now;

  for (const item of orbitItems) {
    const angle = (((item.baseAngle + angles[item.ring]) % 360) + 360) % 360;
    const depth = Math.max(0, -Math.sin((angle * Math.PI) / 180));
    const blur = depth * 1.8;
    const value = blur < 0.25 ? '' : `blur(${blur.toFixed(2)}px)`;
    if (item.filter !== value) {
      item.filter = value;
      item.el.style.filter = value;
    }
  }
}

let lastFrame = performance.now();
function tick(now) {
  const delta = Math.min(now - lastFrame, 60) / 1000;
  lastFrame = now;

  if (spinning && !dragging) {
    for (const def of RINGS) angles[def.key] = (angles[def.key] + def.speed * delta) % 360;
    applyAngles();
    updateDepth();
  }
  requestAnimationFrame(tick);
}

function animateNumber(element, target, formatter) {
  const from = 0;
  const duration = 760;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = formatter(from + (target - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function localStats(list) {
  const categories = Object.entries(CATEGORY_TINTS).map(([name, tint]) => {
    const items = list.filter((file) => file.category === name);
    return {
      name,
      tint,
      count: items.length,
      size: items.reduce((sum, file) => sum + (file.size || 0), 0),
    };
  });
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    total: list.length,
    totalSize: list.reduce((sum, file) => sum + (file.size || 0), 0),
    addedThisWeek: list.filter((file) => (Date.parse(file.createdAt) || 0) > weekAgo).length,
    categories,
    topics: [...new Set(list.map((file) => file.topic).filter(Boolean))].map((name) => ({ name })),
  };
}

function renderStats() {
  const total = stats?.total ?? files.length;
  const totalSize = stats?.totalSize ?? 0;
  const topicCount = stats?.topics?.length || 0;
  const weekCount = stats?.addedThisWeek || 0;
  const favoriteCount = files.filter((file) => file.favorite).length;

  animateNumber(document.getElementById('statTotal'), total, (value) => String(Math.round(value)));
  document.getElementById('statSize').textContent = formatSizeShort(totalSize);
  document.getElementById('statTopics').textContent = String(topicCount);
  document.getElementById('statWeek').textContent = String(weekCount);
  document.getElementById('statFav').textContent = `收藏 ${favoriteCount}`;

  const categories = (stats?.categories || localStats(files).categories)
    .filter((category) => category.count > 0)
    .map((category) => ({
      name: category.name,
      count: category.count,
      tint: CATEGORY_TINTS[category.name] || CATEGORY_TINTS.其他,
    }));

  if (categories.length && total > 0) {
    let cursor = 0;
    const stops = categories.map((category) => {
      const from = cursor;
      cursor += (category.count / total) * 360;
      return `${category.tint} ${from.toFixed(1)}deg ${cursor.toFixed(1)}deg`;
    });
    core.style.setProperty('--donut', `conic-gradient(${stops.join(', ')})`);
  } else {
    core.style.setProperty('--donut', 'conic-gradient(var(--line) 0 360deg)');
  }

  legend.innerHTML = categories
    .slice(0, 5)
    .map(
      (category) =>
        `<span style="--tint:${category.tint}"><i></i>${esc(category.name)} ${category.count}</span>`
    )
    .join('');
}

async function loadData() {
  try {
    const [filesResponse, statsResponse] = await Promise.all([
      fetch('/api/files'),
      fetch('/api/stats'),
    ]);
    if (!filesResponse.ok) throw new Error('files');
    const filesPayload = await filesResponse.json();
    files = Array.isArray(filesPayload.items) ? filesPayload.items : [];
    stats = statsResponse.ok ? await statsResponse.json() : null;
    footHint.textContent = '拖动旋转 · 空格暂停';
  } catch {
    const snapshot = await loadSnapshotSafe();
    if (snapshot) {
      files = snapshot.files || [];
      stats = localStats(files);
      footHint.textContent = '离线模式 · 显示已同步的资源';
    } else {
      files = [];
      stats = localStats([]);
      footHint.textContent = '连接不上电脑上的资源站';
    }
  }

  renderStats();
  buildOrbit();
}

async function loadSnapshotSafe() {
  try {
    const { loadSnapshot } = await import('./offline.js');
    return await loadSnapshot();
  } catch {
    return null;
  }
}

// 拖动旋转
stage.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.orbit-card')) return;
  dragging = true;
  dragStartX = event.clientX;
  dragStartAngles = { ...angles };
  try {
    stage.setPointerCapture(event.pointerId);
  } catch {
    // 忽略不支持指针捕获的浏览器
  }
});

stage.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const delta = (event.clientX - dragStartX) * 0.35;
  for (const def of RINGS) {
    angles[def.key] = dragStartAngles[def.key] + delta * def.dragFactor;
  }
  applyAngles();
  updateDepth();
});

function endDrag() {
  dragging = false;
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('pointerleave', () => {
  if (dragging) endDrag();
});

spinBtn.addEventListener('click', () => {
  spinning = !spinning;
  spinBtn.textContent = spinning ? '暂停旋转' : '继续旋转';
});

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'].includes(event.target?.tagName)) return;
  event.preventDefault();
  spinning = !spinning;
  spinBtn.textContent = spinning ? '暂停旋转' : '继续旋转';
});

const THEME_LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };
function renderThemeBtn() {
  const mode = window.RHTheme?.read() || 'auto';
  themeBtn.textContent = THEME_LABELS[mode];
  themeBtn.title = `主题：${THEME_LABELS[mode]}（点击切换）`;
}
renderThemeBtn();
document.addEventListener('rh:theme', renderThemeBtn);

themeBtn.addEventListener('click', () => {
  window.RHTheme?.cycle();
});

spinBtn.textContent = spinning ? '暂停旋转' : '继续旋转';
initRipple();

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => buildOrbit(), 160);
});

requestAnimationFrame(tick);
loadData();
