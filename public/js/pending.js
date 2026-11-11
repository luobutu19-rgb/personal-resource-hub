import { api } from './api.js';
import { refreshAll } from './store.js';
import { addPendingItem, listPendingItems, deletePendingItem } from './offline.js';
import { icon, esc, formatSize, formatDate, categoryIcon, categoryColor } from './render.js';
import { toast } from './toast.js';

const CATEGORY_BY_EXT = {
  图片: 'jpg jpeg png gif webp svg heic heif bmp avif tiff tif',
  文档: 'pdf doc docx txt md markdown rtf ppt pptx xls xlsx csv numbers pages key odt',
  视频: 'mp4 mov m4v avi mkv webm flv wmv',
  音频: 'mp3 wav m4a aac flac ogg opus',
  压缩包: 'zip rar 7z tar gz bz2 xz',
  代码: 'js mjs cjs ts tsx jsx py java c h cpp hpp cs go rs php rb sh bat ps1 sql html htm css scss json yml yaml xml ipynb',
};

let items = [];
const thumbUrls = new Map();
const previewUrls = [];
let previewEscape = null;
const MAX_PENDING_FILE = 100 * 1024 * 1024;

function extOf(name) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

function categoryOf(name) {
  const ext = extOf(name);
  for (const [category, list] of Object.entries(CATEGORY_BY_EXT)) {
    if (list.split(' ').includes(ext)) return category;
  }
  return '其他';
}

function platformOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (/bilibili\.com|b23\.tv/.test(host)) return '哔哩哔哩';
    if (/xiaohongshu\.com|xhslink\.com/.test(host)) return '小红书';
    if (/weixin\.qq\.com/.test(host)) return '微信';
    if (/instagram\.com|instagr\.am/.test(host)) return 'Instagram';
    return '网页';
  } catch {
    return '网页';
  }
}

function extractUrl(text) {
  const match = /https?:\/\/[^\s"'<>）)】]+/i.exec(String(text || ''));
  return match ? match[0].replace(/[.,;!?，。；！？]+$/g, '') : '';
}

function titleFromText(text, url) {
  const raw = String(text || '').replace(/https?:\/\/\S+/g, ' ');
  for (const line of raw.split(/[\n\r]+/)) {
    let value = line
      .replace(/复制本条信息.*$/i, '')
      .replace(/打开【?小红书】?.*$/i, '')
      .replace(/打开.*App.*$/i, '')
      .replace(/^(分享|推荐|来自)\s*[:：]?\s*/i, '')
      .replace(/[，,。;；\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (value.length >= 4 && value.length <= 120) return value;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return '网页收藏';
  }
}

export async function savePendingLink({ text, note = '' }) {
  const url = extractUrl(text);
  if (!url) return null;
  const platform = platformOf(url);
  const item = await addPendingItem({
    kind: 'link',
    title: titleFromText(text, url),
    url,
    text: String(text || ''),
    note,
    platform,
    category: '其他',
    size: 0,
    tags: ['待同步'],
  });
  if (item) await refreshPending();
  return item;
}

export async function savePendingFiles(entries) {
  let saved = 0;
  for (const entry of entries) {
    const file = entry.file || entry;
    if (!file || file.size > MAX_PENDING_FILE) continue;
    const item = await addPendingItem({
      kind: 'file',
      title: file.name.replace(/\.[^.]+$/, '') || file.name,
      name: file.name,
      mime: file.type || '',
      size: file.size || 0,
      category: categoryOf(file.name),
      tags: ['待同步'],
      blob: file,
    });
    if (item) saved += 1;
  }
  if (saved) await refreshPending();
  return saved;
}

function thumbMarkup(item) {
  if (item.kind === 'file' && item.blob && item.category === '图片') {
    let url = thumbUrls.get(item.id);
    if (!url) {
      url = URL.createObjectURL(item.blob);
      thumbUrls.set(item.id, url);
    }
    return `<img src="${url}" alt="">`;
  }
  const name = item.kind === 'link' ? 'link' : categoryIcon(item.category);
  const tint = item.kind === 'link' ? '#0e7c66' : categoryColor(item.category);
  return `<span style="color:${tint}">${icon(name)}</span>`;
}

function renderPending() {
  const panel = document.getElementById('pendingPanel');
  const list = document.getElementById('pendingList');
  const title = document.getElementById('pendingTitle');
  if (!panel || !list) return;

  for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
  thumbUrls.clear();

  if (!items.length) {
    panel.hidden = true;
    list.innerHTML = '';
    return;
  }

  panel.hidden = false;
  if (title) title.textContent = `${items.length} 项待同步`;
  list.innerHTML = items
    .map((item) => {
      const meta =
        item.kind === 'link'
          ? `${esc(item.platform || '网页')} · 待同步`
          : `${esc(item.category)} · ${formatSize(item.size)} · 待同步`;
      return `<div class="pending-item" data-pending-open="${item.id}" role="button" tabindex="0" aria-label="${esc(
        item.title
      )}">
        <span class="pending-thumb">${thumbMarkup(item)}</span>
        <span class="pending-main">
          <strong>${esc(item.title)}</strong>
          <small>${meta} · ${formatDate(item.createdAt)}</small>
        </span>
        <button class="icon-btn pending-trash" type="button" data-pending-delete="${item.id}" aria-label="删除">
          ${icon('trash')}
        </button>
      </div>`;
    })
    .join('');
}

export async function refreshPending() {
  items = await listPendingItems();
  renderPending();
}

function closePreview() {
  document.getElementById('modalRoot').innerHTML = '';
  document.body.classList.remove('modal-open');
  for (const url of previewUrls.splice(0)) URL.revokeObjectURL(url);
  if (previewEscape) {
    document.removeEventListener('keydown', previewEscape);
    previewEscape = null;
  }
}

async function openPreview(item) {
  const root = document.getElementById('modalRoot');
  let body = '';

  if (item.kind === 'link') {
    body = `<div class="pv-link">
      <span class="pv-link-art">${icon('link')}</span>
      <div class="pv-link-info">
        <span class="pv-platform">${esc(item.platform || '网页')} · 手机暂存</span>
        <p>${esc(item.title)}</p>
        ${item.note ? `<p>${esc(item.note)}</p>` : ''}
        <div class="pv-link-url">${esc(item.url)}</div>
        <a class="btn primary" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${icon(
          'arrow-right'
        )}打开原文</a>
      </div>
    </div>`;
  } else if (item.blob && item.category === '图片') {
    const url = URL.createObjectURL(item.blob);
    previewUrls.push(url);
    body = `<img class="pv-image" src="${url}" alt="${esc(item.title)}">`;
  } else if (item.blob && /^(txt|md|markdown|csv|json|ya?ml|xml|js|ts|py|java|css|html)$/i.test(extOf(item.name))) {
    body = `<pre class="pv-text" id="pendingText">读取中…</pre>`;
  } else {
    body = `<div class="pv-unknown">${icon('file')}<p>文件暂存在手机，联网同步后可在线预览</p></div>`;
  }

  const download = item.blob
    ? (() => {
        const url = URL.createObjectURL(item.blob);
        previewUrls.push(url);
        return `<a class="btn ghost" href="${url}" download="${esc(item.name || item.title)}">${icon(
          'download'
        )}保存到文件</a>`;
      })()
    : '';

  root.innerHTML = `<div class="modal-backdrop">
    <div class="preview-panel" role="dialog" aria-modal="true" aria-label="${esc(item.title)}" tabindex="-1">
      <header class="pv-head">
        <div class="pv-head-main">
          <div class="pv-chip-row">
            <span class="pv-cat">手机暂存</span>
            <span class="pv-topic">待同步</span>
          </div>
          <h2>${esc(item.title)}</h2>
          <p class="pv-meta">${esc(item.kind === 'link' ? item.url : item.name)} · ${formatDate(
            item.createdAt
          )}</p>
        </div>
        <div class="pv-actions">
          <button class="icon-btn" type="button" data-pending-preview-close aria-label="关闭">${icon('close')}</button>
        </div>
      </header>
      <div class="pv-body">${body}</div>
      <footer class="pv-foot">
        <div class="pv-summary">
          <div class="pv-summary-head"><span>说明</span></div>
          <p>这项内容目前只保存在手机。电脑开机并联网后会自动同步到资源站。</p>
        </div>
        <div class="pv-nav">${download}</div>
      </footer>
    </div>
  </div>`;

  document.body.classList.add('modal-open');
  const backdrop = root.querySelector('.modal-backdrop');
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closePreview();
  });
  root.querySelector('[data-pending-preview-close]')?.addEventListener('click', closePreview);

  previewEscape = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePreview();
    }
  };
  document.addEventListener('keydown', previewEscape);

  const pre = document.getElementById('pendingText');
  if (pre && item.blob) {
    try {
      const text = await item.blob.text();
      if (pre.isConnected) pre.textContent = text.slice(0, 300000);
    } catch {
      if (pre.isConnected) pre.textContent = '无法读取文件内容';
    }
  }
}

export async function syncPending({ silent = false } = {}) {
  if (!items.length) return { synced: 0, failed: 0 };
  if (!navigator.onLine) {
    if (!silent) toast('当前离线，联网后会自动同步', { type: 'info' });
    return { synced: 0, failed: 0 };
  }

  const files = items.filter((item) => item.kind === 'file' && item.blob);
  const links = items.filter((item) => item.kind === 'link' && item.url);
  let synced = 0;
  let failed = 0;

  if (files.length) {
    const form = new FormData();
    for (const item of files) form.append('files', item.blob, item.name || item.title);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180000);
      const response = await fetch('/api/files', { method: 'POST', body: form, signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`上传失败（${response.status}）`);
      for (const item of files) await deletePendingItem(item.id);
      synced += files.length;
    } catch {
      failed += files.length;
    }
  }

  for (const item of links) {
    try {
      await api.collectLink({ text: item.text || item.url, note: item.note || '' });
      await deletePendingItem(item.id);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  await refreshPending();
  if (synced) {
    try {
      await refreshAll();
    } catch {}
  }

  if (!silent || synced) {
    const message = failed
      ? `已同步 ${synced} 项，${failed} 项待重试`
      : `已同步 ${synced} 项手机暂存`;
    toast(message, { type: failed ? 'error' : 'success', duration: 4200 });
  }
  return { synced, failed };
}

export async function initPending() {
  document.getElementById('syncPendingBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '同步中…';
    try {
      await syncPending();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });

  const list = document.getElementById('pendingList');
  list?.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-pending-delete]');
    if (deleteButton) {
      event.stopPropagation();
      await deletePendingItem(deleteButton.dataset.pendingDelete);
      await refreshPending();
      toast('已删除手机暂存', { type: 'info' });
      return;
    }
    const row = event.target.closest('[data-pending-open]');
    if (row) {
      const item = items.find((entry) => entry.id === row.dataset.pendingOpen);
      if (item) openPreview(item);
    }
  });

  list?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('[data-pending-open]');
    if (!row || event.target !== row) return;
    event.preventDefault();
    const item = items.find((entry) => entry.id === row.dataset.pendingOpen);
    if (item) openPreview(item);
  });

  await refreshPending();
}
