import { toast } from './toast.js';
import { api } from './api.js';
import { state, setState, subscribe, setView, setLayout, boot } from './store.js';
import { renderAll, icon } from './render.js';
import { initUpload } from './upload.js';
import { initPreview, openPreview } from './preview.js';
import { initSpotlight } from './search.js';
import { initCollect } from './collect.js';
import { initOffline, loadSnapshot, supportsOffline, scanCached, autoCache } from './offline.js';
import { initPending, syncPending } from './pending.js';
import { openEdit, openTopicManager, toggleFavorite } from './edit.js';
import { openSettings } from './settings.js';
import { initTheme, toggleTheme } from './theme.js';
import { initRipple } from './ripple.js';
import { initVault } from './vault.js';
import { initPixelBoard } from './pixelboard.js';
import { initSelection, toggleSelected, renderBar } from './selection.js';

initTheme();
initRipple();
subscribe(renderAll);
subscribe(renderBar);
renderAll();
renderBar();
window.addEventListener('rh:cache-changed', () => renderAll());
initUpload();
initPreview();
initSpotlight();
initCollect();
initOffline();
initPending();
initVault();
initSelection();
initPixelBoard();

const searchInput = document.getElementById('searchInput');
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('sidebarScrim');
const menu = document.getElementById('uploadMenu');
const topbar = document.querySelector('.topbar');

function openSidebar() {
  sidebar.classList.add('open');
  scrim.hidden = false;
}

function closeSidebar() {
  sidebar.classList.remove('open');
  scrim.hidden = true;
}

function isMobile() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function resetFilters() {
  searchInput.value = '';
  syncSearchClear();
  setState({ topic: null, category: null, tag: null, favorite: false, q: '' });
}

// 搜索（防抖）
let searchTimer = null;
const searchClear = document.getElementById('searchClear');
function syncSearchClear() {
  if (searchClear) searchClear.hidden = !searchInput.value;
}
searchInput.addEventListener('input', () => {
  syncSearchClear();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setState({ q: searchInput.value }), 180);
});
searchInput.addEventListener('search', () => {
  syncSearchClear();
  setState({ q: searchInput.value });
});
searchClear?.addEventListener('click', () => {
  searchInput.value = '';
  syncSearchClear();
  setState({ q: '' });
  searchInput.focus();
});

// 排序与布局
document.getElementById('sortSelect').addEventListener('change', (event) => {
  setState({ sort: event.target.value });
});

document.getElementById('layoutBtn').addEventListener('click', () => {
  setLayout(state.layout === 'grid' ? 'list' : 'grid');
});

// 浏览方式
document.getElementById('viewToggle').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  const view = button.dataset.view;
  setView(view);
  if (view === 'category') setState({ topic: null });
});

// 侧栏筛选
sidebar.addEventListener('click', (event) => {
  const target = event.target.closest('[data-topic],[data-category],[data-filter],[data-tag]');
  if (!target) return;

  if (target.dataset.filter === 'all') {
    resetFilters();
  } else if (target.dataset.filter === 'favorite') {
    setState({ favorite: true, topic: null, category: null, tag: null });
  } else if (target.dataset.topic) {
    setView('topic');
    setState({ topic: target.dataset.topic, category: null, tag: null, favorite: false });
  } else if (target.dataset.category) {
    setState({ category: target.dataset.category, tag: null, favorite: false });
  } else if (target.dataset.tag) {
    setState({ tag: state.tag === target.dataset.tag ? null : target.dataset.tag });
  }

  if (isMobile()) closeSidebar();
});

// 主题卡片
document.getElementById('topicStrip').addEventListener('click', (event) => {
  const card = event.target.closest('[data-topic]');
  if (!card) return;
  const name = card.dataset.topic;
  setView('topic');
  setState({ topic: state.topic === name ? null : name, category: null, tag: null, favorite: false });
});

// 筛选 chips
document.getElementById('chipBar').addEventListener('click', (event) => {
  const clear = event.target.closest('[data-clear]');
  if (clear) {
    const key = clear.dataset.clear;
    if (key === 'q') {
      searchInput.value = '';
      setState({ q: '' });
    } else if (key === 'favorite') {
      setState({ favorite: false });
    } else {
      setState({ [key]: null });
    }
    return;
  }

  const category = event.target.closest('[data-category]');
  if (category) {
    const name = category.dataset.category || null;
    setState({ category: state.category === name ? null : name });
  }
});

// 文件卡片
const fileArea = document.getElementById('fileArea');

fileArea.addEventListener('click', async (event) => {
  if (state.selecting) {
    const card = event.target.closest('[data-id]');
    if (card) {
      event.preventDefault();
      toggleSelected(card.dataset.id);
    }
    return;
  }

  const star = event.target.closest('[data-star]');
  if (star) {
    event.stopPropagation();
    await toggleFavorite(star.dataset.star);
    return;
  }

  const more = event.target.closest('[data-more]');
  if (more) {
    event.stopPropagation();
    openEdit(more.dataset.more);
    return;
  }

  const card = event.target.closest('[data-id]');
  if (card) openPreview(card.dataset.id);
});

fileArea.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('[data-id]');
  if (!card || event.target !== card) return;
  event.preventDefault();
  if (state.selecting) toggleSelected(card.dataset.id);
  else openPreview(card.dataset.id);
});

// 空状态里的清除筛选
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-clear-all]')) resetFilters();
});

// 主题 AI 总结
document.getElementById('topicPanel').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-topic-ai]');
  if (!button) return;

  const topic = button.dataset.topicAi;
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon('sparkles')}总结中…`;

  try {
    const result = await api.topicSummary(topic);
    const entry = (state.stats?.topics || []).find((item) => item.name === topic);
    if (entry) {
      entry.summary = result.summary;
      entry.summaryUpdatedAt = result.updatedAt;
      entry.summaryFileCount = result.fileCount;
    }
    setState({ stats: state.stats });
    toast(`「${topic}」主题总结已生成`, { type: 'success' });
  } catch (error) {
    toast(error.message, { type: 'error', duration: 4800 });
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
});

// 设置 / 主题 / 主题重命名
for (const id of ['settingsBtn', 'settingsBtnSide']) {
  document.getElementById(id)?.addEventListener('click', () => openSettings());
}
for (const id of ['themeBtn', 'themeBtnSide']) {
  document.getElementById(id)?.addEventListener('click', () => toggleTheme());
}
document.getElementById('manageTopics').addEventListener('click', () => openTopicManager());

// 移动端侧栏
document.getElementById('menuBtn').addEventListener('click', openSidebar);
document.getElementById('closeSidebar').addEventListener('click', closeSidebar);
scrim.addEventListener('click', closeSidebar);

// 顶栏滚动阴影
window.addEventListener(
  'scroll',
  () => {
    topbar.classList.toggle('is-stuck', window.scrollY > 6);
  },
  { passive: true }
);

// 键盘快捷键
document.addEventListener('keydown', (event) => {
  const tag = String(event.target?.tagName || '').toUpperCase();
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target?.isContentEditable;

  if (event.key === '/' && !typing) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }

  if (event.key === 'Escape') {
    if (!menu.hidden) menu.hidden = true;
    if (!scrim.hidden) closeSidebar();
  }
});

// 启动
function setOfflineBanner(text) {
  const banner = document.getElementById('offlineBanner');
  const label = document.getElementById('offlineText');
  if (!banner || !label) return;
  if (text) {
    label.textContent = text;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function openFileFromQuery() {
  const id = new URLSearchParams(location.search).get('file');
  if (!id) return;
  history.replaceState(null, '', location.pathname);
  if (state.files.some((file) => file.id === id)) openPreview(id);
}

async function startApp() {
  if (!navigator.onLine) {
    const snapshot = await loadSnapshot();
    if (snapshot) {
      setState({ files: snapshot.files, stats: snapshot.stats, loading: false });
      scanCached(snapshot.files).catch(() => {});
      const time = snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleString('zh-CN') : '';
      setOfflineBanner(
        `离线模式 · 显示 ${snapshot.files.length} 个已同步资源${time ? ` · 同步于 ${time}` : ''}`
      );
      openFileFromQuery();
      return;
    }
  }

  try {
    await boot();
    setOfflineBanner('');
    if (supportsOffline()) {
      scanCached(state.files).catch(() => {});
      autoCache(state.files).catch(() => {});
    }
    syncPending({ silent: true }).catch(() => {});
    openFileFromQuery();
  } catch (error) {
    const snapshot = await loadSnapshot();
    if (snapshot) {
      setState({ files: snapshot.files, stats: snapshot.stats, loading: false });
      scanCached(snapshot.files).catch(() => {});
      const time = snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleString('zh-CN') : '';
      setOfflineBanner(
        `离线模式 · 显示 ${snapshot.files.length} 个已同步资源${time ? ` · 同步于 ${time}` : ''}`
      );
      openFileFromQuery();
    } else {
      toast(`无法连接服务：${error.message}`, { type: 'error', duration: 6000 });
    }
  }
}

window.addEventListener('offline', () => {
  setOfflineBanner('离线模式 · 显示已缓存的资源');
});

window.addEventListener('online', async () => {
  try {
    await boot();
    setOfflineBanner('');
    await syncPending({ silent: true });
    const count = supportsOffline() ? await autoCache(state.files, { force: true }) : 0;
    toast(`已恢复连接，数据已同步${count ? `，并缓存了 ${count} 个文件` : ''}`, {
      type: 'success',
      duration: 4000,
    });
  } catch {
    // 保持离线状态
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') autoCache(state.files).catch(() => {});
});

startApp();
