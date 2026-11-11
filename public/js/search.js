import { api } from './api.js';
import { state } from './store.js';
import { icon, esc, formatSize, categoryIcon, categoryColor } from './render.js';
import { openPreview } from './preview.js';
import { openVaultFile } from './vault.js';
import { toast } from './toast.js';

let results = [];
let activeIndex = 0;
let aiMode = false;
let busy = false;
let lastFocused = null;
let searchTimer = null;
let aiToken = 0;

const isOpen = () => Boolean(document.getElementById('spotlightRoot')?.innerHTML.trim());

// 隐私文件的索引（只含标题等信息，查看内容仍需密码）
let hiddenIndex = [];
let hiddenLoadedAt = 0;

async function loadHiddenIndex() {
  if (Date.now() - hiddenLoadedAt < 15000) return;
  try {
    const data = await api.searchIndex();
    hiddenIndex = (data.items || []).filter((item) => item.hidden);
    hiddenLoadedAt = Date.now();
  } catch {
    hiddenIndex = [];
  }
}

function sortedByNewest(files) {
  return files.slice().sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}

function localSearch(query) {
  const q = String(query || '').trim().toLowerCase();
  const pool = [...state.files, ...hiddenIndex];
  if (!q) return sortedByNewest(pool).slice(0, 8);

  return pool
    .map((file) => {
      const title = String(file.title || '').toLowerCase();
      const tags = (file.tags || []).join(' ').toLowerCase();
      const topic = String(file.topic || '').toLowerCase();
      const summary = String(file.summary || '').toLowerCase();
      const original = String(file.originalName || '').toLowerCase();
      let score = 0;
      if (title.includes(q)) score += 6;
      if (tags.includes(q)) score += 4;
      if (topic.includes(q)) score += 4;
      if (original.includes(q)) score += 3;
      if (summary.includes(q)) score += 2;
      return { file, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (Date.parse(b.file.createdAt) || 0) - (Date.parse(a.file.createdAt) || 0))
    .slice(0, 12)
    .map((item) => item.file);
}

function setStatus(text) {
  const status = document.getElementById('spotlightStatus');
  if (status) status.textContent = text;
}

function rowMarkup(file, index) {
  const tint = categoryColor(file.category);
  const tags = (file.tags || []).slice(0, 2).join('、');

  return `<button class="spotlight-item ${index === activeIndex ? 'active' : ''}" type="button" data-spotlight-id="${file.id}">
    <span class="spotlight-icon" style="--tint:${tint}">${icon(file.hidden ? 'lock' : categoryIcon(file.category))}</span>
    <span class="spotlight-main">
      <span class="spotlight-title">${esc(file.title)}</span>
      <span class="spotlight-meta">${file.hidden ? '<span class="spotlight-lock">隐私</span>' : ''}${esc(file.topic)} · ${esc(
        file.category
      )}${tags ? ` · ${esc(tags)}` : ''} · ${formatSize(file.size)}</span>
      ${file.reason ? `<span class="ai-reason">${icon('sparkles')}${esc(file.reason)}</span>` : ''}
    </span>
    <span class="spotlight-arrow">${icon(file.hidden ? 'lock' : 'arrow-right')}</span>
  </button>`;
}

function renderBody(statusText) {
  const body = document.getElementById('spotlightBody');
  if (!body) return;

  setStatus(statusText);

  if (busy) {
    body.innerHTML = `<div class="spotlight-loading">
      <span class="ai-spinner"></span>
      <div><strong>AI 正在查找资料</strong><span>会结合标题、标签和摘要一起判断</span></div>
    </div>`;
    return;
  }

  if (!results.length) {
    const noFiles = state.files.length === 0;
    body.innerHTML = `<div class="spotlight-empty">
      ${icon('search')}
      <p>${noFiles ? '还没有文件' : aiMode ? 'AI 没有找到相关资源' : '没有匹配的资源'}</p>
      <span>${
        noFiles ? '先上传一些资料，再用聚焦搜索' : '换个关键词，或点「AI 帮我找」用一句话描述'
      }</span>
    </div>`;
    return;
  }

  body.innerHTML = results.map((file, index) => rowMarkup(file, index)).join('');
}

function setActive(nextIndex) {
  if (!results.length) return;
  activeIndex = (nextIndex + results.length) % results.length;
  const root = document.getElementById('spotlightRoot');
  root.querySelectorAll('.spotlight-item').forEach((element, index) => {
    element.classList.toggle('active', index === activeIndex);
  });
  root.querySelector('.spotlight-item.active')?.scrollIntoView({ block: 'nearest' });
}

function openResult(id) {
  if (hiddenIndex.some((file) => file.id === id)) {
    closeSpotlight();
    openVaultFile(id);
    return;
  }
  if (!state.files.some((file) => file.id === id)) {
    toast('找不到该文件，请刷新页面后重试', { type: 'error' });
    return;
  }
  closeSpotlight();
  openPreview(id);
}

async function runAiSearch() {
  const input = document.getElementById('spotlightInput');
  const button = document.getElementById('spotlightAi');
  if (!input || !button || busy) return;

  const query = input.value.trim();
  if (!query) {
    input.focus();
    toast('先输入你想找的内容', { type: 'info' });
    return;
  }

  const original = button.innerHTML;
  const token = ++aiToken;
  busy = true;
  aiMode = true;
  activeIndex = 0;
  button.disabled = true;
  button.innerHTML = `${icon('sparkles')}检索中…`;
  renderBody('AI 正在检索…');

  try {
    const data = await api.aiSearch(query);
    if (token !== aiToken) return;
    const items = (data.items || []).slice(0, 8);
    busy = false;

    if (items.length) {
      results = items;
      aiMode = true;
      renderBody(`AI 找到 ${items.length} 个相关资源`);
    } else {
      const local = localSearch(query);
      if (local.length) {
        results = local;
        aiMode = false;
        renderBody(`AI 没有找到，本地匹配 ${local.length} 个`);
      } else {
        results = [];
        renderBody('AI 没有找到相关资源');
      }
    }
  } catch (error) {
    if (token !== aiToken) return;
    busy = false;
    aiMode = false;
    results = localSearch(query);
    renderBody(`AI 暂不可用，已显示本地匹配 ${results.length} 个`);
    toast(error.message, { type: 'error', duration: 5000 });
  } finally {
    if (token === aiToken) {
      busy = false;
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }
}

export function closeSpotlight() {
  const root = document.getElementById('spotlightRoot');
  if (!root || !root.innerHTML.trim()) return;

  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  if (lastFocused && lastFocused.isConnected) lastFocused.focus({ preventScroll: true });
  lastFocused = null;
  aiToken += 1;
  results = [];
  activeIndex = 0;
  aiMode = false;
  busy = false;
  clearTimeout(searchTimer);
}

export function openSpotlight(prefill = '') {
  if (isOpen()) return;
  if (document.getElementById('modalRoot')?.innerHTML.trim()) return;
  if (document.getElementById('drawerRoot')?.innerHTML.trim()) return;

  const root = document.getElementById('spotlightRoot');
  lastFocused = document.activeElement;

  const hints = [
    ...new Set([
      ...(state.stats?.topics || []).slice(0, 2).map((topic) => topic.name),
      ...(state.stats?.tags || []).slice(0, 2).map((tag) => tag.name),
    ]),
  ].slice(0, 4);

  root.innerHTML = `<div class="spotlight-backdrop">
    <div class="spotlight" role="dialog" aria-modal="true" aria-label="聚焦搜索">
      <div class="spotlight-search">
        ${icon('search')}
        <input id="spotlightInput" type="text" value="${esc(prefill)}" placeholder="描述你要找的资源，例如：第三章极限的笔记" autocomplete="off" spellcheck="false">
        <kbd>Esc</kbd>
      </div>
      ${
        hints.length
          ? `<div class="spotlight-hints">${hints
              .map((hint) => `<button class="spotlight-hint" type="button" data-hint="${esc(hint)}">${esc(hint)}</button>`)
              .join('')}</div>`
          : ''
      }
      <div class="spotlight-body" id="spotlightBody"></div>
      <div class="spotlight-foot">
        <span id="spotlightStatus">输入关键词即时筛选</span>
        <button class="ai-btn ai-glow" id="spotlightAi" type="button">${icon('sparkles')}AI 帮我找</button>
      </div>
    </div>
  </div>`;

  document.body.classList.add('modal-open');
  results = localSearch('');
  activeIndex = 0;
  aiMode = false;
  renderBody(state.files.length ? `最近上传 · ${results.length} 个` : '还没有文件，先上传一些资料吧');

  // 把隐私文件的标题也纳入搜索（内容仍需密码）
  loadHiddenIndex().then(() => {
    if (!isOpen()) return;
    const value = document.getElementById('spotlightInput')?.value || '';
    if (busy) return;
    results = localSearch(value);
    activeIndex = 0;
    renderBody(value.trim() ? `匹配 ${results.length} 个` : `最近上传 · ${results.length} 个`);
  });

  const input = root.querySelector('#spotlightInput');
  const backdrop = root.querySelector('.spotlight-backdrop');
  const panel = root.querySelector('.spotlight');

  setTimeout(() => {
    input.focus();
    if (prefill) input.select();
  }, 30);

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeSpotlight();
  });

  panel.addEventListener('click', (event) => {
    const item = event.target.closest('[data-spotlight-id]');
    if (item) {
      openResult(item.dataset.spotlightId);
      return;
    }
    const hint = event.target.closest('[data-hint]');
    if (hint) {
      input.value = hint.dataset.hint;
      results = localSearch(input.value);
      activeIndex = 0;
      renderBody(`本地匹配 ${results.length} 个`);
      input.focus();
    }
  });

  root.querySelector('#spotlightAi').addEventListener('click', runAiSearch);

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    aiToken += 1;
    busy = false;
    aiMode = false;
    const aiButton = document.getElementById('spotlightAi');
    if (aiButton && aiButton.disabled) {
      aiButton.disabled = false;
      aiButton.innerHTML = `${icon('sparkles')}AI 帮我找`;
    }
    searchTimer = setTimeout(() => {
      results = localSearch(input.value);
      activeIndex = 0;
      renderBody(input.value.trim() ? `本地匹配 ${results.length} 个` : '输入关键词即时筛选');
    }, 130);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSpotlight();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(activeIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        runAiSearch();
        return;
      }
      if (results.length) openResult(results[Math.max(activeIndex, 0)].id);
      else runAiSearch();
    }
  });
}

export function initSpotlight() {
  document.getElementById('aiSearchBtn')?.addEventListener('click', () => openSpotlight());

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      if (document.getElementById('modalRoot')?.innerHTML.trim()) return;
      if (document.getElementById('drawerRoot')?.innerHTML.trim()) return;
      event.preventDefault();
      if (isOpen()) closeSpotlight();
      else openSpotlight();
      return;
    }
    if (event.key === 'Escape' && isOpen() && !document.activeElement?.closest('.spotlight')) {
      closeSpotlight();
    }
  });
}
