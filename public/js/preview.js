import { api } from './api.js';
import { state, getFile, visibleFiles, setState } from './store.js';
import { icon, esc, formatSize, formatDate } from './render.js';
import { toast } from './toast.js';
import { markViewed } from './offline.js';
import { openEdit, toggleFavorite } from './edit.js';

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'yml', 'yaml', 'xml', 'ini', 'conf', 'log',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs',
  'php', 'rb', 'sh', 'bat', 'ps1', 'sql', 'html', 'htm', 'css', 'scss', 'ipynb', 'r', 'lua', 'kt', 'swift', 'dart',
]);

let currentId = null;
let lastFocused = null;

export function initPreview() {
  document.addEventListener('keydown', (event) => {
    if (!currentId) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePreview();
      return;
    }
    const tag = String(event.target?.tagName || '').toUpperCase();
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigate(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigate(1);
    }
  });
}

export function openPreview(id) {
  const file = getFile(id);
  if (!file) return;
  if (!currentId) lastFocused = document.activeElement;
  currentId = id;
  markViewed(id);
  document.body.classList.add('modal-open');
  renderPreview();
  if (TEXT_EXTS.has(String(file.ext || '').toLowerCase())) loadText(file);
  document.querySelector('.preview-panel')?.focus({ preventScroll: true });
}

export function closePreview(options = {}) {
  const root = document.getElementById('modalRoot');
  const panel = root?.querySelector('.preview-panel');
  if (!currentId && !panel) return;

  currentId = null;

  const immediate =
    options === true ||
    options.immediate ||
    !panel ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (immediate) {
    finishClose(panel);
    return;
  }

  const backdrop = root.querySelector('.modal-backdrop');
  backdrop?.classList.add('is-closing');
  panel.classList.add('is-closing');

  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    finishClose(panel);
  };
  panel.addEventListener('animationend', end, { once: true });
  setTimeout(end, 400);
}

function finishClose(panel) {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  // 已被新的弹层（编辑面板 / 另一条预览）接管，不要清空它
  if (panel && root.querySelector('.preview-panel') !== panel) return;

  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  if (lastFocused && lastFocused.isConnected) lastFocused.focus({ preventScroll: true });
  lastFocused = null;
}

function navigate(step) {
  if (!currentId) return;
  const list = visibleFiles();
  if (list.length < 2) return;
  const index = list.findIndex((file) => file.id === currentId);
  if (index === -1) return;
  const next = list[(index + step + list.length) % list.length];
  openPreview(next.id);
}

function mediaHtml(file) {
  const src = api.rawUrl(file.id);
  const ext = String(file.ext || '').toLowerCase();

  if (file.kind === 'link') {
    return `<div class="pv-link">
      ${
        file.coverPath
          ? `<img class="pv-link-cover" src="${api.coverUrl(file.id)}" alt="">`
          : `<span class="pv-link-art">${icon('link')}</span>`
      }
      <div class="pv-link-info">
        <span class="pv-platform">${esc(file.platform || '网页')}</span>
        <p>${esc(file.summary || '收藏的网页链接，打开原文查看完整内容。')}</p>
        <div class="pv-link-url">${esc(file.url || '')}</div>
        <a class="btn primary" href="${esc(file.url || '#')}" target="_blank" rel="noopener noreferrer">${icon(
          'arrow-right'
        )}打开原文</a>
      </div>
    </div>`;
  }

  if (file.category === '图片') {
    return `<img class="pv-image" src="${src}" alt="${esc(file.title)}">`;
  }
  if (ext === 'pdf') {
    return `<iframe class="pv-frame" src="${src}" title="${esc(file.title)}"></iframe>`;
  }
  if (file.category === '视频') {
    return `<video class="pv-video" src="${src}" controls playsinline preload="metadata"></video>`;
  }
  if (file.category === '音频') {
    return `<div class="pv-audio">
      <span class="pv-audio-art">${icon('audio')}</span>
      <audio src="${src}" controls preload="metadata"></audio>
    </div>`;
  }
  if (TEXT_EXTS.has(ext)) {
    return `<pre class="pv-text" id="pvText" tabindex="0">正在读取…</pre>`;
  }
  return `<div class="pv-unknown">
    ${icon('file')}
    <p>该格式暂不支持在线预览，可下载后查看</p>
    <a class="btn primary" href="${api.downloadUrl(file.id)}" download>${icon('download')}下载文件</a>
  </div>`;
}

function renderPreview() {
  const root = document.getElementById('modalRoot');
  if (!currentId) return;
  const file = getFile(currentId);
  if (!file) {
    closePreview();
    return;
  }

  const list = visibleFiles();
  const index = Math.max(0, list.findIndex((item) => item.id === file.id));
  const isLink = file.kind === 'link';

  root.innerHTML = `<div class="modal-backdrop">
    <div class="preview-panel" role="dialog" aria-modal="true" aria-label="${esc(file.title)}" tabindex="-1">
      <header class="pv-head">
        <div class="pv-head-main">
          <div class="pv-chip-row">
            <span class="pv-cat">${esc(isLink ? file.platform || '网页' : file.category)}</span>
            <span class="pv-topic">${esc(file.topic)}</span>
          </div>
          <h2>${esc(file.title)}</h2>
          <p class="pv-meta">${
            isLink
              ? `${esc(file.originalName)} · 收藏于 ${formatDate(file.createdAt)}`
              : `${esc(file.originalName)} · ${formatSize(file.size)} · ${formatDate(file.createdAt)}`
          }</p>
        </div>
        <div class="pv-actions">
          <button class="icon-btn ${file.favorite ? 'on' : ''}" type="button" data-pv-star aria-label="${
            file.favorite ? '取消收藏' : '收藏'
          }" title="收藏">${icon(file.favorite ? 'star-filled' : 'star')}</button>
          ${
            isLink
              ? `<a class="icon-btn" href="${esc(file.url || '#')}" target="_blank" rel="noopener noreferrer" aria-label="打开原文" title="打开原文">${icon(
                  'arrow-right'
                )}</a>`
              : `<a class="icon-btn" href="${api.downloadUrl(file.id)}" download aria-label="下载" title="下载">${icon(
                  'download'
                )}</a>`
          }
          <button class="icon-btn" type="button" data-pv-edit aria-label="编辑" title="编辑">${icon('edit')}</button>
          <button class="icon-btn" type="button" data-pv-close aria-label="关闭" title="关闭">${icon('close')}</button>
        </div>
      </header>

      <div class="pv-body">${mediaHtml(file)}</div>

      <footer class="pv-foot">
        ${
          isLink
            ? `<div class="pv-summary">
                <div class="pv-summary-head"><span>简介</span></div>
                <p>${file.summary ? esc(file.summary) : '收藏的网页链接，打开原文查看完整内容。'}</p>
              </div>
              <div class="pv-summary">
                <div class="pv-summary-head">
                  <span>AI 摘要</span>
                  <button class="ai-btn ai-glow" type="button" data-pv-ai>${icon('sparkles')}${
                    file.aiSummary ? '重新总结' : 'AI 总结'
                  }</button>
                </div>
                <p id="pvSummary" class="${file.aiSummary ? '' : 'empty'}">${
                  file.aiSummary
                    ? esc(file.aiSummary)
                    : '暂无摘要。点击「AI 总结」会抓取网页正文并生成摘要。'
                }</p>
              </div>`
            : `<div class="pv-summary">
                <div class="pv-summary-head">
                  <span>AI 摘要</span>
                  <button class="ai-btn ai-glow" type="button" data-pv-ai>${icon('sparkles')}${
                    file.summary ? '重新总结' : 'AI 总结'
                  }</button>
                </div>
                <p id="pvSummary" class="${file.summary ? '' : 'empty'}">${
                  file.summary
                    ? esc(file.summary)
                    : '暂无摘要。支持文本、PDF、Word/PPT/Excel 与图片（图片需模型支持视觉）。'
                }</p>
              </div>`
        }
        <div class="pv-nav">
          <button type="button" data-pv-prev aria-label="上一个" ${list.length < 2 ? 'disabled' : ''}>${icon(
            'chevron-left'
          )}</button>
          <span>${index + 1} / ${list.length || 1}</span>
          <button type="button" data-pv-next aria-label="下一个" ${list.length < 2 ? 'disabled' : ''}>${icon(
            'chevron-right'
          )}</button>
        </div>
      </footer>
    </div>
  </div>`;

  const backdrop = root.querySelector('.modal-backdrop');
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closePreview();
  });
  root.querySelectorAll('[data-pv-close]').forEach((element) => {
    element.addEventListener('click', closePreview);
  });
  root.querySelector('[data-pv-star]')?.addEventListener('click', () => handleStar(file.id));
  root.querySelector('[data-pv-edit]')?.addEventListener('click', () => {
    const id = file.id;
    closePreview(true);
    openEdit(id);
  });
  root.querySelector('[data-pv-prev]')?.addEventListener('click', () => navigate(-1));
  root.querySelector('[data-pv-next]')?.addEventListener('click', () => navigate(1));
  root.querySelector('[data-pv-ai]')?.addEventListener('click', () => runSummary(file.id));

  const image = root.querySelector('.pv-image');
  image?.addEventListener(
    'error',
    () => {
      const body = root.querySelector('.pv-body');
      if (!body) return;
      body.innerHTML = `<div class="pv-unknown">
        ${icon('image')}
        <p>浏览器无法直接显示这种图片格式（例如 HEIC），请下载后查看</p>
        <a class="btn primary" href="${api.downloadUrl(file.id)}" download>${icon('download')}下载文件</a>
      </div>`;
    },
    { once: true }
  );
}

async function handleStar(id) {
  const favorite = await toggleFavorite(id);
  if (favorite === null) return;
  const button = document.querySelector('[data-pv-star]');
  if (!button) return;
  button.classList.toggle('on', favorite);
  button.innerHTML = icon(favorite ? 'star-filled' : 'star');
  button.setAttribute('aria-label', favorite ? '取消收藏' : '收藏');
}

async function runSummary(id) {
  const button = document.querySelector('[data-pv-ai]');
  if (!button) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon('sparkles')}总结中…`;

  try {
    const result = await api.aiSummary(id);
    if (currentId !== id) return;

    const file = getFile(id);
    if (file) {
      if (file.kind === 'link') file.aiSummary = result.summary;
      else file.summary = result.summary;
    }
    setState({ files: state.files.slice() });

    const summary = document.getElementById('pvSummary');
    if (summary) {
      summary.textContent = result.summary;
      summary.classList.remove('empty');
    }
    toast('AI 总结完成', { type: 'success' });
  } catch (error) {
    toast(error.message, { type: 'error', duration: 4800 });
  } finally {
    if (currentId === id) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

async function loadText(file) {
  const initial = document.getElementById('pvText');
  if (!initial) return;
  try {
    const response = await fetch(api.rawUrl(file.id));
    if (!response.ok) throw new Error('读取失败');
    const text = await response.text();
    if (currentId !== file.id) return;
    const pre = document.getElementById('pvText');
    if (pre) pre.textContent = text.slice(0, 300000);
  } catch {
    const pre = document.getElementById('pvText');
    if (pre && currentId === file.id) pre.textContent = '无法读取文件内容';
  }
}
