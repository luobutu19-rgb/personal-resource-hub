import { api } from './api.js';
import { isCached } from './offline.js';
import { state, visibleFiles, topicSummary, hasFilters } from './store.js';

const CATEGORIES = ['图片', '文档', '视频', '音频', '压缩包', '代码', '网页', '其他'];

const CATEGORY_ICONS = {
  图片: 'image',
  文档: 'doc',
  视频: 'video',
  音频: 'audio',
  压缩包: 'archive',
  代码: 'code',
  网页: 'link',
  其他: 'file',
};

const CATEGORY_TINTS = {
  图片: '#e8735a',
  文档: '#5c6bc0',
  视频: '#8e5bc0',
  音频: '#d9a227',
  压缩包: '#7c8288',
  代码: '#2aa198',
  网页: '#4a7dbd',
  其他: '#8b8f93',
};

const TOPIC_TINTS = ['#0e7c66', '#5c6bc0', '#c2733f', '#2aa198', '#a34a7a', '#6d7f35', '#b07d2b', '#4a7dbd'];

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg']);

export function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="/icons.svg#i-${name}"></use></svg>`;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

export function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function categoryColor(category) {
  return CATEGORY_TINTS[category] || CATEGORY_TINTS.其他;
}

export function categoryIcon(category) {
  return CATEGORY_ICONS[category] || 'file';
}

export function topicColor(name) {
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 31 + char.codePointAt(0)) % 9973;
  return TOPIC_TINTS[hash % TOPIC_TINTS.length];
}

function currentTitle() {
  if (state.favorite) return '收藏';
  if (state.topic) return state.topic;
  if (state.category) return state.category;
  if (state.tag) return `#${state.tag}`;
  return '全部资源';
}

export function renderAll() {
  renderSidebar();
  renderHeader();
  renderTopicPanel();
  renderTopicStrip();
  renderChips();
  renderFiles();
  renderToolbar();
}

function renderSidebar() {
  const stats = state.stats;
  const files = state.files;

  document.getElementById('countAll').textContent = stats?.total ?? files.length;
  document.getElementById('countFav').textContent = files.filter((file) => file.favorite).length;

  const navAll = document.getElementById('navAll');
  navAll.classList.toggle('active', !state.topic && !state.category && !state.tag && !state.favorite);

  const favoriteButton = document.querySelector('.side-item[data-filter="favorite"]');
  if (favoriteButton) favoriteButton.classList.toggle('active', state.favorite);

  const topics = stats?.topics?.length
    ? stats.topics.map((topic) => ({ name: topic.name, count: topic.count, size: topic.size }))
    : topicSummary();

  const topicNav = document.getElementById('topicNav');
  topicNav.innerHTML = topics.length
    ? topics
        .map((topic) => {
          const tint = topicColor(topic.name);
          return `<button class="side-item ${state.topic === topic.name ? 'active' : ''}" type="button" data-topic="${esc(
            topic.name
          )}" title="${esc(topic.name)} · ${formatSize(topic.size)}">
            <svg class="icon" aria-hidden="true" style="color:${tint}"><use href="/icons.svg#i-folder"></use></svg>
            <span>${esc(topic.name)}</span>
            <span class="count">${topic.count}</span>
          </button>`;
        })
        .join('')
    : '<p class="side-note">上传后自动生成</p>';

  const categories = stats?.categories?.length
    ? stats.categories
    : CATEGORIES.map((name) => ({ name, count: 0, size: 0 }));

  document.getElementById('categoryNav').innerHTML = categories
    .filter((category) => category.count > 0)
    .map(
      (category) => `<button class="side-item ${state.category === category.name ? 'active' : ''}" type="button" data-category="${esc(
        category.name
      )}">
        <svg class="icon" aria-hidden="true" style="color:${categoryColor(category.name)}"><use href="/icons.svg#i-${categoryIcon(
        category.name
      )}"></use></svg>
        <span>${esc(category.name)}</span>
        <span class="count">${category.count}</span>
      </button>`
    )
    .join('') || '<p class="side-note">暂无文件</p>';

  const tags = (stats?.tags || []).slice(0, 12);
  document.getElementById('tagCloud').innerHTML = tags.length
    ? tags
        .map(
          (tag) => `<button class="tag-chip ${state.tag === tag.name ? 'active' : ''}" type="button" data-tag="${esc(
            tag.name
          )}" title="${tag.count} 个文件">${esc(tag.name)}</button>`
        )
        .join('')
    : '<p class="side-note">暂无标签</p>';

  const totalSize = stats?.totalSize || 0;
  const ratio = Math.min(100, (totalSize / (10 * 1024 * 1024 * 1024)) * 100);
  document.getElementById('storageSize').textContent = formatSize(totalSize);
  document.getElementById('storageBar').style.width = `${Math.max(ratio, totalSize > 0 ? 1.5 : 0)}%`;
  document.getElementById('storageHint').textContent = stats?.total
    ? `${stats.total} 个文件 · 本周新增 ${stats.addedThisWeek}`
    : '把资料拖进来，自动整理';
}

function renderHeader() {
  document.getElementById('pageEyebrow').textContent =
    state.view === 'topic' ? '按主题浏览' : '按类型浏览';
  document.getElementById('pageTitle').textContent = currentTitle();

  const files = visibleFiles();
  if (state.q.trim()) {
    document.getElementById('pageSub').textContent = `搜索“${state.q.trim()}” · 找到 ${files.length} 个文件`;
  } else if (state.stats && state.stats.total === 0) {
    document.getElementById('pageSub').textContent = '拖入文件或文件夹，自动按主题和类型整理';
  } else if (state.topic || state.category || state.tag || state.favorite) {
    document.getElementById('pageSub').textContent = `${
      state.favorite ? '收藏的文件' : '筛选结果'
    } · ${files.length} 个文件`;
  } else {
    document.getElementById('pageSub').textContent = `共 ${files.length} 个文件 · 本周新增 ${
      state.stats?.addedThisWeek ?? 0
    }`;
  }

  document.querySelectorAll('#viewToggle button').forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function renderTopicPanel() {
  const panel = document.getElementById('topicPanel');
  if (!panel) return;

  if (state.view !== 'topic' || !state.topic) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  const files = state.files.filter((file) => file.topic === state.topic);
  if (!files.length) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  const entry = (state.stats?.topics || []).find((topic) => topic.name === state.topic);
  const summary = entry?.summary || '';
  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const updated = entry?.summaryUpdatedAt ? formatDate(entry.summaryUpdatedAt) : '';

  panel.hidden = false;
  panel.innerHTML = `<div class="topic-panel-head">
      <div class="topic-panel-title">
        <p class="eyebrow">主题概览</p>
        <h2>${esc(state.topic)} <span>${files.length} 个文件 · ${formatSize(totalSize)}</span></h2>
      </div>
      <button class="ai-btn ai-glow" type="button" data-topic-ai="${esc(state.topic)}">
        ${icon('sparkles')}${summary ? '重新总结' : 'AI 总结主题'}
      </button>
    </div>
    <p class="topic-panel-summary ${summary ? '' : 'empty'}">${
      summary ? esc(summary) : '让 AI 读一遍这个主题下的资料，帮你概括重点和复习方向。'
    }</p>
    ${
      updated
        ? `<p class="topic-panel-meta">更新于 ${updated} · 覆盖 ${entry.summaryFileCount || files.length} 个文件</p>`
        : ''
    }`;
}

function renderTopicStrip() {
  const strip = document.getElementById('topicStrip');
  if (state.view !== 'topic') {
    strip.innerHTML = '';
    return;
  }

  const topics = topicSummary();
  if (!topics.length) {
    strip.innerHTML = '';
    return;
  }

  strip.innerHTML = topics
    .map((topic) => {
      const tint = topicColor(topic.name);
      const mix = Object.entries(topic.mix)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      const total = mix.reduce((sum, [, count]) => sum + count, 0) || 1;
      const bars = mix
        .map(
          ([category, count]) =>
            `<i style="flex:${Math.max(count, 0.6)};background:${categoryColor(category)}"></i>`
        )
        .join('');
      return `<button class="topic-card ${state.topic === topic.name ? 'active' : ''}" type="button" data-topic="${esc(
        topic.name
      )}" style="--tint:${tint}">
        <span class="topic-card-name">${esc(topic.name)}</span>
        <span class="topic-card-meta">${topic.count} 个文件 · ${formatSize(topic.size)}</span>
        <span class="topic-mix" aria-hidden="true">${bars || `<i style="flex:1;background:${tint};opacity:.35"></i>`}</span>
      </button>`;
    })
    .join('');
}

function renderChips() {
  const bar = document.getElementById('chipBar');
  if (!state.stats || state.stats.total === 0) {
    bar.innerHTML = '';
    return;
  }

  const categories = state.stats.categories || [];
  const chips = [
    `<button class="chip ${!state.category ? 'active' : ''}" type="button" data-category="">全部 <em>${
      state.stats.total
    }</em></button>`,
    ...categories
      .filter((category) => category.count > 0)
      .map(
        (category) => `<button class="chip ${state.category === category.name ? 'active' : ''}" type="button" data-category="${esc(
          category.name
        )}">
          <svg class="icon" style="color:${
            state.category === category.name ? 'currentColor' : categoryColor(category.name)
          }"><use href="/icons.svg#i-${categoryIcon(category.name)}"></use></svg>
          ${esc(category.name)} <em>${category.count}</em>
        </button>`
      ),
  ];

  if (state.favorite) {
    chips.push(
      `<button class="chip filter-chip" type="button" data-clear="favorite">${icon('star-filled')}收藏 ${
        icon('close')
      }</button>`
    );
  }
  if (state.topic) {
    chips.push(
      `<button class="chip filter-chip" type="button" data-clear="topic">${icon('folder')}${esc(
        state.topic
      )} ${icon('close')}</button>`
    );
  }
  if (state.tag) {
    chips.push(
      `<button class="chip filter-chip" type="button" data-clear="tag">${icon('tag')}${esc(state.tag)} ${icon(
        'close'
      )}</button>`
    );
  }
  if (state.q.trim()) {
    chips.push(
      `<button class="chip filter-chip" type="button" data-clear="q">${icon('search')}${esc(
        state.q.trim()
      )} ${icon('close')}</button>`
    );
  }

  bar.innerHTML = chips.join('');
}

function renderFiles() {
  const area = document.getElementById('fileArea');
  area.className = `file-area layout-${state.layout}`;

  if (state.loading) {
    area.innerHTML = Array.from({ length: 9 }, () => '<div class="skeleton-card"></div>').join('');
    return;
  }

  const files = visibleFiles();
  if (!files.length) {
    area.innerHTML = emptyState();
    return;
  }

  const selectedIds = new Set(state.selected || []);
  area.innerHTML =
    state.layout === 'list'
      ? files
          .map((file, index) =>
            listRow(file, index, { selecting: state.selecting, selected: selectedIds.has(file.id) })
          )
          .join('')
      : files
          .map((file, index) =>
            fileCard(file, index, { selecting: state.selecting, selected: selectedIds.has(file.id) })
          )
          .join('');
}

export function fileCard(file, index, options = {}) {
  const { token = '', vault = false, selecting = false, selected = false } = options;
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
  const isLink = file.kind === 'link';
  const digest = isLink ? file.aiSummary || file.summary : file.summary;
  const tint = isLink ? '#0e7c66' : categoryColor(file.category);
  const isImage = !isLink && IMAGE_EXTS.has(String(file.ext || '').toLowerCase());
  const thumb = isLink
    ? file.coverPath
      ? `<img class="thumb-img" src="${api.coverUrl(file.id)}${suffix}" alt="" loading="lazy" decoding="async">`
      : `<span class="thumb-icon">${icon('link')}</span>`
    : isImage
      ? `<img class="thumb-img" src="${api.rawUrl(file.id)}${suffix}" alt="" loading="lazy" decoding="async">`
      : `<span class="thumb-icon">${icon(categoryIcon(file.category))}</span>`;
  const tags = (file.tags || []).slice(0, 3);
  const badge = isLink ? file.platform || '链接' : file.ext ? file.ext.toUpperCase() : 'FILE';

  const actions = vault || selecting
    ? ''
    : `<button class="star-btn ${file.favorite ? 'on' : ''}" type="button" data-star="${file.id}" aria-label="${
        file.favorite ? '取消收藏' : '收藏'
      }">${icon(file.favorite ? 'star-filled' : 'star')}</button>
      <button class="more-btn" type="button" data-more="${file.id}" aria-label="更多操作">${icon('more')}</button>`;
  const picker = selecting
    ? `<span class="pick-dot ${selected ? 'on' : ''}" aria-hidden="true">${selected ? icon('check') : ''}</span>`
    : '';

  return `<article class="file-card ${isLink ? 'is-link' : ''} ${vault ? 'is-vault' : ''} ${
    selecting ? 'select-mode' : ''
  } ${selected ? 'is-selected' : ''}" data-id="${file.id}" tabindex="0" role="button" aria-label="${esc(
    file.title
  )}" aria-pressed="${selected ? 'true' : 'false'}" style="--i:${index};--tint:${tint}">
    <div class="file-thumb">
      ${thumb}
      ${picker}
      <span class="type-badge">${esc(badge)}</span>
      ${!vault && isCached(file.id) ? `<span class="cached-badge">${icon('check')}已缓存</span>` : ''}
      ${actions}
    </div>
    <div class="file-body">
      <h3 class="file-title">${esc(file.title)}</h3>
      ${digest ? `<p class="file-summary">${esc(digest)}</p>` : ''}
      <div class="file-tags">${tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>
      <div class="file-meta">
        <span class="topic-pill">${esc(file.topic)}</span>
        <span>${isLink ? '网页' : formatSize(file.size)}</span>
        <span>${formatDate(file.createdAt)}</span>
      </div>
    </div>
  </article>`;
}

export function listRow(file, index, options = {}) {
  const { vault = false, selecting = false, selected = false } = options;
  const isLink = file.kind === 'link';
  const digest = isLink ? file.aiSummary || file.summary : file.summary;
  const tint = isLink ? '#0e7c66' : categoryColor(file.category);
  const tags = (file.tags || []).slice(0, 2).join('、');
  const actions = vault || selecting
    ? ''
    : `<button class="icon-btn ${file.favorite ? 'on' : ''}" type="button" data-star="${file.id}" aria-label="${
        file.favorite ? '取消收藏' : '收藏'
      }">${icon(file.favorite ? 'star-filled' : 'star')}</button>
      <button class="icon-btn" type="button" data-more="${file.id}" aria-label="更多操作">${icon('more')}</button>`;
  const picker = selecting
    ? `<span class="pick-dot ${selected ? 'on' : ''}" aria-hidden="true">${selected ? icon('check') : ''}</span>`
    : '';

  return `<article class="file-row ${isLink ? 'is-link' : ''} ${vault ? 'is-vault' : ''} ${
    selecting ? 'select-mode' : ''
  } ${selected ? 'is-selected' : ''}" data-id="${file.id}" tabindex="0" role="button" aria-label="${esc(
    file.title
  )}" aria-pressed="${selected ? 'true' : 'false'}" style="--i:${index};--tint:${tint}">
    ${picker}
    <span class="row-icon">${icon(isLink ? 'link' : categoryIcon(file.category))}</span>
    <div class="row-main">
      <h3>${esc(file.title)}</h3>
      <p>${
        !vault && isCached(file.id)
          ? `<span class="cached-pill">${icon('check')}已缓存</span><span class="dot">·</span>`
          : ''
      }${esc(file.topic)}${tags ? `<span class="dot">·</span>${esc(tags)}` : ''}${
        digest ? `<span class="dot">·</span>${esc(digest)}` : ''
      }</p>
    </div>
    <div class="row-meta">
      <span>${isLink ? '网页' : formatSize(file.size)}</span>
      <span>${formatDate(file.createdAt)}</span>
      <span class="badge">${esc(isLink ? file.platform || '链接' : file.ext ? file.ext.toUpperCase() : 'FILE')}</span>
    </div>
    <div class="row-actions">${actions}</div>
  </article>`;
}

function emptyState() {
  if (hasFilters()) {
    return `<div class="empty-state">
      <span class="empty-art">${icon('search')}</span>
      <h2>没有匹配的文件</h2>
      <p>换一个关键词，或清除筛选条件再看看。</p>
      <div class="empty-actions">
        <button class="btn ghost" type="button" data-clear-all>${icon('refresh')}清除筛选</button>
      </div>
    </div>`;
  }

  return `<div class="empty-state">
    <span class="empty-art">${icon('folder')}</span>
    <h2>把资料丢进来，自动整理</h2>
    <p>拖入文件或整个文件夹，系统会按主题和类型归类，并自动打上标签。</p>
    <div class="empty-actions">
      <button class="btn primary" type="button" data-upload="files">${icon('upload')}上传文件</button>
      <button class="btn ghost" type="button" data-upload="folder">${icon('folder')}选择文件夹</button>
    </div>
  </div>`;
}

function renderToolbar() {
  const layoutButton = document.getElementById('layoutBtn');
  if (layoutButton) {
    layoutButton.innerHTML = icon(state.layout === 'grid' ? 'list' : 'grid');
    layoutButton.title = state.layout === 'grid' ? '切换为列表' : '切换为网格';
  }
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect && sortSelect.value !== state.sort) sortSelect.value = state.sort;
}
