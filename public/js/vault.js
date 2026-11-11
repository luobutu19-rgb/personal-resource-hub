import { api, setVaultToken, getVaultToken } from './api.js';
import { icon, esc, fileCard, listRow } from './render.js';
import { toast } from './toast.js';

const CATEGORY_ICONS = {
  图片: 'image',
  视频: 'video',
  音频: 'audio',
  代码: 'code',
  文档: 'doc',
  压缩包: 'archive',
  网页: 'link',
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg']);
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'yml', 'yaml', 'xml', 'ini', 'conf', 'log',
  'js', 'ts', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bat', 'sql',
  'html', 'htm', 'css', 'ipynb', 'r', 'lua',
]);

let escapeHandler = null;

// 隐藏文件的 raw/cover 需要带令牌
function authUrl(id, kind = 'raw') {
  const base = kind === 'cover' ? api.coverUrl(id) : api.rawUrl(id);
  const token = getVaultToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function mountModal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = html;
  document.body.classList.add('modal-open');

  const backdrop = root.querySelector('.modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeModal();
    });
  }
  root.querySelectorAll('[data-vault-close]').forEach((element) => {
    element.addEventListener('click', closeModal);
  });

  if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
  escapeHandler = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeModal();
    }
  };
  document.addEventListener('keydown', escapeHandler);
  return root;
}

function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
  document.body.classList.remove('modal-open');
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  }
}

function formatSize(size) {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

// 统一的隐私空间面板外壳
function shell({ iconName, tone = 'lock', title, subtitle, body, footer }) {
  return `<div class="modal-backdrop">
    <section class="vault-panel vault-${tone}" role="dialog" aria-modal="true" aria-labelledby="vaultTitle">
      <button class="vault-close" type="button" data-vault-close aria-label="关闭">${icon('close')}</button>
      <header class="vault-hero">
        <span class="vault-hero-glyph">${icon(iconName)}</span>
        <h2 id="vaultTitle">${esc(title)}</h2>
        ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
      </header>
      <div class="vault-body">${body}</div>
      ${footer ? `<footer class="vault-foot">${footer}</footer>` : ''}
    </section>
  </div>`;
}

// 带图标 + 显隐切换的密码输入
function passwordField({ name, label, hint = '', autofocus = false, autocomplete = 'current-password' }) {
  return `<label class="vault-field">
    <span class="vault-label">${esc(label)}</span>
    <span class="vault-input">
      ${icon('lock')}
      <input type="password" name="${name}" maxlength="32" required
        ${autofocus ? 'autofocus' : ''} autocomplete="${autocomplete}" placeholder="请输入密码">
      <button class="vault-eye" type="button" data-vault-eye aria-label="显示密码">${icon('eye')}</button>
    </span>
    ${hint ? `<small class="vault-hint">${esc(hint)}</small>` : ''}
  </label>`;
}

function bindEye(root) {
  root.querySelectorAll('[data-vault-eye]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.innerHTML = icon(show ? 'eye-off' : 'eye');
      button.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
      input.focus();
    });
  });
}

function shake(root) {
  const panel = root.querySelector('.vault-panel');
  if (!panel) return;
  panel.classList.remove('is-shaking');
  void panel.offsetWidth; // 重新触发动画
  panel.classList.add('is-shaking');
  panel.addEventListener('animationend', () => panel.classList.remove('is-shaking'), { once: true });
}

async function refreshBadge() {
  try {
    const st = await api.vaultStatus();
    const count = document.getElementById('vaultCount');
    if (count) {
      count.textContent = st.hiddenCount;
      count.hidden = !st.hiddenCount;
    }
    const use = document.querySelector('#vaultBtn .icon use');
    if (use) use.setAttribute('href', `/icons.svg#${st.unlocked ? 'i-unlock' : 'i-lock'}`);
    return st;
  } catch {
    return null;
  }
}

export function isVaultUnlocked() {
  return Boolean(getVaultToken());
}

/* ---------------- 设置密码 ---------------- */

function openSetPassword() {
  const root = mountModal(
    shell({
      iconName: 'shield',
      tone: 'setup',
      title: '创建隐私空间',
      subtitle: '隐藏的文件会从主页、搜索和统计中消失',
      body: `<form class="vault-form" id="vaultSetForm">
        ${passwordField({
          name: 'next',
          label: '设置密码',
          hint: '至少 4 位，请牢记，忘记后无法找回隐藏内容',
          autocomplete: 'new-password',
          autofocus: true,
        })}
        ${passwordField({
          name: 'confirm',
          label: '确认密码',
          autocomplete: 'new-password',
        })}
        <div class="vault-actions">
          <button class="vault-btn ghost" type="button" data-vault-close>取消</button>
          <button class="vault-btn primary" type="submit">${icon('check')}创建隐私空间</button>
        </div>
      </form>`,
    })
  );

  bindEye(root);

  root.querySelector('#vaultSetForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const next = form.elements.next.value;
    if (next !== form.elements.confirm.value) {
      toast('两次输入的密码不一致', { type: 'error' });
      shake(root);
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '创建中…';
    try {
      await api.vaultSetPassword('', next);
      const result = await api.vaultUnlock(next);
      setVaultToken(result.token);
      toast('隐私空间已创建', { type: 'success' });
      await openVaultList();
    } catch (error) {
      toast(error.message, { type: 'error', duration: 4500 });
      shake(root);
      button.disabled = false;
      button.innerHTML = `${icon('check')}创建隐私空间`;
    }
  });
}

/* ---------------- 解锁 ---------------- */

function openUnlock(note, { openList = true } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      resolve(value);
    };

    const root = mountModal(
      shell({
        iconName: 'lock',
        tone: 'unlock',
        title: '解锁隐私空间',
        subtitle: note || '输入密码查看隐藏的文件',
        body: `<form class="vault-form" id="vaultUnlockForm">
          ${passwordField({ name: 'password', label: '密码', autofocus: true })}
          <div class="vault-actions">
            <button class="vault-btn ghost" type="button" data-vault-close>取消</button>
            <button class="vault-btn primary" type="submit">${icon('unlock')}解锁</button>
          </div>
        </form>`,
      })
    );

    bindEye(root);

    const observer = new MutationObserver(() => {
      if (!document.body.classList.contains('modal-open')) finish(false);
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    root.querySelector('#vaultUnlockForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = '解锁中…';
      try {
        const result = await api.vaultUnlock(form.elements.password.value);
        setVaultToken(result.token);
        finish(true);
        await refreshBadge();
        if (openList) await openVaultList();
      } catch (error) {
        toast(error.message, { type: 'error', duration: 4500 });
        shake(root);
        button.disabled = false;
        button.innerHTML = `${icon('unlock')}解锁`;
        form.elements.password.select();
      }
    });
  });
}

/* ---------------- 文件预览（与主页一致） ---------------- */

// 预览弹层：关闭后回到列表
function mountPreviewModal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = html;
  document.body.classList.add('modal-open');

  const backdrop = root.querySelector('.modal-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) openVaultList();
  });

  if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
  escapeHandler = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      openVaultList();
    }
  };
  document.addEventListener('keydown', escapeHandler);
  return root;
}

function vaultMediaHtml(file) {
  const ext = String(file.ext || '').toLowerCase();

  if (file.kind === 'link') {
    return `<div class="pv-link">
      ${
        file.coverPath
          ? `<img class="pv-link-cover" src="${authUrl(file.id, 'cover')}" alt="">`
          : `<span class="pv-link-art">${icon('link')}</span>`
      }
      <div class="pv-link-info">
        <span class="pv-platform">${esc(file.platform || '网页')}</span>
        <p>${esc(file.summary || '收藏的网页链接，打开原文查看完整内容。')}</p>
        <div class="pv-link-url">${esc(file.url || '')}</div>
        <a class="btn primary" href="${esc(file.url || '#')}" target="_blank" rel="noopener noreferrer">${icon('arrow-right')}打开原文</a>
      </div>
    </div>`;
  }

  if (file.category === '图片') {
    return `<img class="pv-image" src="${authUrl(file.id)}" alt="${esc(file.title)}">`;
  }
  if (ext === 'pdf') {
    return `<iframe class="pv-frame" src="${authUrl(file.id)}" title="${esc(file.title)}"></iframe>`;
  }
  if (file.category === '视频') {
    return `<video class="pv-video" src="${authUrl(file.id)}" controls playsinline preload="metadata"></video>`;
  }
  if (file.category === '音频') {
    return `<div class="pv-audio">
      <span class="pv-audio-art">${icon('audio')}</span>
      <audio src="${authUrl(file.id)}" controls preload="metadata"></audio>
    </div>`;
  }
  if (TEXT_EXTS.has(ext)) {
    return `<pre class="pv-text" id="vaultPvText" tabindex="0">正在读取…</pre>`;
  }
  return `<div class="pv-unknown">
    ${icon('file')}
    <p>该格式暂不支持在线预览，可下载后查看</p>
    <a class="btn primary" href="${authUrl(file.id)}" download>${icon('download')}下载文件</a>
  </div>`;
}

async function loadVaultText(file) {
  try {
    const response = await fetch(authUrl(file.id));
    if (!response.ok) throw new Error('读取失败');
    const text = await response.text();
    const pre = document.getElementById('vaultPvText');
    if (pre) pre.textContent = text.slice(0, 300000);
  } catch {
    const pre = document.getElementById('vaultPvText');
    if (pre) pre.textContent = '无法读取文件内容';
  }
}

function openVaultPreview(id, items) {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    openVaultList();
    return;
  }
  const file = items[index];
  const isLink = file.kind === 'link';
  const primary = isLink
    ? `<a class="icon-btn" href="${esc(file.url || '#')}" target="_blank" rel="noopener noreferrer" aria-label="打开原文" title="打开原文">${icon('arrow-right')}</a>`
    : `<a class="icon-btn" href="${authUrl(file.id)}" download aria-label="下载" title="下载">${icon('download')}</a>`;

  const root = mountPreviewModal(`<div class="modal-backdrop">
    <div class="preview-panel vault-preview" role="dialog" aria-modal="true" aria-label="${esc(file.title)}" tabindex="-1">
      <header class="pv-head">
        <div class="pv-head-main">
          <div class="pv-chip-row">
            <span class="pv-cat">${esc(isLink ? file.platform || '网页' : file.category)}</span>
            <span class="pv-topic">${esc(file.topic)}</span>
            <span class="pv-topic">隐私空间</span>
          </div>
          <h2>${esc(file.title)}</h2>
          <p class="pv-meta">${esc(file.originalName)} · ${formatSize(file.size)} · ${formatDate(file.createdAt)}</p>
        </div>
        <div class="pv-actions">
          ${primary}
          <button class="icon-btn" type="button" data-vp-restore aria-label="移出隐私空间" title="移出隐私空间">${icon('upload')}</button>
          <button class="icon-btn" type="button" data-vp-close aria-label="关闭" title="关闭">${icon('close')}</button>
        </div>
      </header>
      <div class="pv-body">${vaultMediaHtml(file)}</div>
      <footer class="pv-foot">
        ${
          file.summary
            ? `<div class="pv-summary"><div class="pv-summary-head"><span>简介</span></div><p>${esc(file.summary)}</p></div>`
            : ''
        }
        <div class="pv-nav">
          <button type="button" data-vp-prev aria-label="上一个" ${items.length < 2 ? 'disabled' : ''}>${icon('chevron-left')}</button>
          <span>${index + 1} / ${items.length}</span>
          <button type="button" data-vp-next aria-label="下一个" ${items.length < 2 ? 'disabled' : ''}>${icon('chevron-right')}</button>
        </div>
      </footer>
    </div>
  </div>`);

  root.querySelector('[data-vp-close]').addEventListener('click', () => openVaultList());
  root.querySelector('[data-vp-prev]')?.addEventListener('click', () => openVaultPreview(items[(index - 1 + items.length) % items.length].id, items));
  root.querySelector('[data-vp-next]')?.addEventListener('click', () => openVaultPreview(items[(index + 1) % items.length].id, items));
  root.querySelector('[data-vp-restore]').addEventListener('click', async () => {
    try {
      await api.patchFile(file.id, { hidden: false });
      toast('已移出隐私空间', { type: 'success' });
      await refreshBadge();
      await openVaultList();
    } catch (error) {
      toast(error.message, { type: 'error' });
    }
  });

  const image = root.querySelector('.pv-image');
  image?.addEventListener(
    'error',
    () => {
      const body = root.querySelector('.pv-body');
      if (!body) return;
      body.innerHTML = `<div class="pv-unknown">
        ${icon('image')}
        <p>浏览器无法直接显示这种图片格式（例如 HEIC），请下载后查看</p>
        <a class="btn primary" href="${authUrl(file.id)}" download>${icon('download')}下载文件</a>
      </div>`;
    },
    { once: true }
  );

  if (!isLink && TEXT_EXTS.has(String(file.ext || '').toLowerCase())) loadVaultText(file);
  root.querySelector('.preview-panel')?.focus({ preventScroll: true });
}

/* ---------------- 文件列表（与资源中心一致） ---------------- */

let vaultItems = [];
let vaultView = { category: '', topic: '', q: '', sort: 'newest', layout: 'grid' };
let vaultSelecting = false;
let vaultSelected = new Set();

function vaultFiltered() {
  let list = vaultItems.slice();
  const q = vaultView.q.trim().toLowerCase();
  if (vaultView.category) list = list.filter((file) => file.category === vaultView.category);
  if (vaultView.topic) list = list.filter((file) => file.topic === vaultView.topic);
  if (q) {
    list = list.filter((file) =>
      [file.title, file.topic, file.category, file.originalName, (file.tags || []).join(' '), file.summary]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }
  if (vaultView.sort === 'name') list.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'));
  else if (vaultView.sort === 'size') list.sort((a, b) => (b.size || 0) - (a.size || 0));
  else list.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return list;
}

function vaultChipsHtml() {
  const categories = [...new Set(vaultItems.map((file) => file.category).filter(Boolean))];
  const topics = [...new Set(vaultItems.map((file) => file.topic).filter(Boolean))];
  const chip = (label, value, key, count) =>
    `<button class="chip ${vaultView[key] === value ? 'active' : ''}" type="button" data-vault-chip="${key}" data-vault-value="${esc(
      value
    )}">${esc(label)}${count !== undefined ? ` ${count}` : ''}</button>`;

  return [
    chip('全部', '', 'category', vaultItems.length),
    ...categories.map((name) => chip(name, name, 'category', vaultItems.filter((file) => file.category === name).length)),
    topics.length
      ? `<span class="chip-sep"></span>${topics
          .map((name) => chip(`#${name}`, name, 'topic', vaultItems.filter((file) => file.topic === name).length))
          .join('')}`
      : '',
  ].join('');
}

function paintVault() {
  const sub = document.getElementById('vaultPageSub');
  if (sub) sub.textContent = `已隐藏 ${vaultItems.length} 个文件，只有解锁后能看到`;

  const chips = document.getElementById('vaultChips');
  if (chips) chips.innerHTML = vaultChipsHtml();

  const area = document.getElementById('vaultFiles');
  if (!area) return;
  const token = getVaultToken();
  const list = vaultFiltered();
  area.className = `file-area layout-${vaultView.layout}`;

  if (!list.length) {
    vaultSelected.clear();
    area.innerHTML = vaultItems.length
      ? `<div class="empty-state"><span class="empty-art">${icon('search')}</span><h2>没有匹配的文件</h2><p>换一个关键词或清除筛选条件。</p></div>`
      : `<div class="empty-state"><span class="empty-art">${icon('lock')}</span><h2>隐私空间是空的</h2><p>打开任意文件的编辑弹窗，点「隐藏」就能把它放进这里。</p></div>`;
    paintVaultBulk();
    return;
  }

  area.innerHTML = list
    .map((file, index) =>
      vaultView.layout === 'list'
        ? listRow(file, index, { vault: true, selecting: vaultSelecting, selected: vaultSelected.has(file.id) })
        : fileCard(file, index, {
            vault: true,
            token,
            selecting: vaultSelecting,
            selected: vaultSelected.has(file.id),
          })
    )
    .join('');

  area.querySelectorAll('[data-id]').forEach((element) => {
    element.addEventListener('click', () => {
      if (vaultSelecting) {
        const id = element.dataset.id;
        if (vaultSelected.has(id)) vaultSelected.delete(id);
        else vaultSelected.add(id);
        paintVault();
        return;
      }
      openVaultPreview(element.dataset.id, list);
    });
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target !== element) return;
      event.preventDefault();
      if (vaultSelecting) {
        const id = element.dataset.id;
        if (vaultSelected.has(id)) vaultSelected.delete(id);
        else vaultSelected.add(id);
        paintVault();
        return;
      }
      openVaultPreview(element.dataset.id, list);
    });
  });

  paintVaultBulk();
}

function paintVaultBulk() {
  const bar = document.getElementById('vaultBulkBar');
  if (!bar) return;
  bar.hidden = !vaultSelecting;
  if (!vaultSelecting) return;

  const count = vaultSelected.size;
  const label = document.getElementById('vaultBulkCount');
  if (label) label.textContent = `已选 ${count} 项`;

  const total = vaultFiltered().length;
  const allButton = bar.querySelector('[data-vault-bulk="all"]');
  if (allButton) allButton.textContent = total > 0 && count === total ? '取消全选' : '全选';

  bar.querySelectorAll('button[data-vault-bulk]').forEach((button) => {
    if (button.dataset.vaultBulk === 'all' || button.dataset.vaultBulk === 'cancel') return;
    button.disabled = count === 0;
  });
}

async function reloadVaultItems() {
  try {
    const data = await api.files({ hidden: 1 });
    vaultItems = data.items || [];
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

async function runVaultBatch(patch, message) {
  const ids = [...vaultSelected];
  if (!ids.length) return;
  try {
    const result = await api.batchPatchFiles(ids, patch);
    await reloadVaultItems();
    refreshBadge();
    vaultSelecting = false;
    vaultSelected.clear();
    paintVault();
    toast(`${message}（${result.updated} 个）`, { type: 'success' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

async function openVaultList() {
  let data;
  try {
    data = await api.files({ hidden: 1 });
  } catch (error) {
    toast(error.message, { type: 'error' });
    return;
  }
  vaultItems = data.items || [];
  vaultSelecting = false;
  vaultSelected.clear();

  const root = mountModal(`<div class="modal-backdrop vault-page-backdrop">
    <section class="vault-page" role="dialog" aria-modal="true" aria-labelledby="vaultPageTitle">
      <header class="vault-page-head">
        <div class="vault-page-title">
          <span class="vault-page-glyph">${icon('unlock')}</span>
          <div>
            <h2 id="vaultPageTitle">隐私空间</h2>
            <p id="vaultPageSub">已隐藏 ${vaultItems.length} 个文件</p>
          </div>
        </div>
        <div class="vault-page-tools">
          <div class="search-box vault-search">
            ${icon('search')}
            <input id="vaultSearch" type="search" placeholder="搜索隐藏文件…" autocomplete="off" aria-label="搜索隐藏文件">
          </div>
          <label class="select-wrap">
            <select id="vaultSort" aria-label="排序">
              <option value="newest">最新上传</option>
              <option value="name">名称</option>
              <option value="size">大小</option>
            </select>
          </label>
          <button class="icon-btn" id="vaultLayoutBtn" type="button" title="切换布局" aria-label="切换布局">${icon('list')}</button>
          <button class="btn ghost" type="button" data-vault-select>${icon('check')}选择</button>
          <button class="btn ghost" type="button" data-vault-password>${icon('edit')}修改密码</button>
          <button class="btn primary" type="button" data-vault-lock>${icon('lock')}锁定</button>
          <button class="btn ghost" type="button" data-vault-close>${icon('close')}关闭</button>
        </div>
      </header>
      <div class="chip-bar" id="vaultChips"></div>
      <div class="file-area layout-grid" id="vaultFiles"></div>
      <div class="bulk-bar vault-bulk-bar" id="vaultBulkBar" hidden>
        <span class="bulk-count" id="vaultBulkCount">已选 0 项</span>
        <button type="button" data-vault-bulk="all">全选</button>
        <button type="button" data-vault-bulk="unhide">移出隐私</button>
        <button type="button" data-vault-bulk="tag">加标签</button>
        <button type="button" data-vault-bulk="delete" class="danger">删除</button>
        <button type="button" data-vault-bulk="cancel" class="bulk-close" aria-label="退出多选">×</button>
      </div>
    </section>
  </div>`);

  paintVault();

  root.querySelector('[data-vault-select]').addEventListener('click', (event) => {
    vaultSelecting = !vaultSelecting;
    vaultSelected.clear();
    event.currentTarget.innerHTML = `${icon('check')}${vaultSelecting ? '退出多选' : '选择'}`;
    paintVault();
  });

  root.querySelector('#vaultBulkBar').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-vault-bulk]');
    if (!button || button.disabled) return;
    const action = button.dataset.vaultBulk;

    if (action === 'cancel') {
      vaultSelecting = false;
      vaultSelected.clear();
      paintVault();
      return;
    }
    if (action === 'all') {
      const all = vaultFiltered().map((file) => file.id);
      const pickedAll = all.length > 0 && all.every((id) => vaultSelected.has(id));
      vaultSelected = new Set(pickedAll ? [] : all);
      paintVault();
      return;
    }
    if (!vaultSelected.size) return;

    if (action === 'unhide') {
      await runVaultBatch({ hidden: false }, '已移出隐私空间');
      return;
    }
    if (action === 'tag') {
      const raw = window.prompt('输入要添加的标签，用逗号或空格分隔');
      if (raw == null) return;
      const tags = raw
        .split(/[,，、\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (!tags.length) {
        toast('没有识别到标签', { type: 'error' });
        return;
      }
      await runVaultBatch({ addTags: tags }, '标签已添加');
      return;
    }
    if (action === 'delete') {
      const ids = [...vaultSelected];
      if (!window.confirm(`删除选中的 ${ids.length} 个文件？删除后无法恢复。`)) return;
      try {
        const result = await api.batchDeleteFiles(ids);
        await reloadVaultItems();
        refreshBadge();
        vaultSelecting = false;
        vaultSelected.clear();
        paintVault();
        toast(`已删除 ${result.deleted} 个文件`, { type: 'success' });
      } catch (error) {
        toast(error.message, { type: 'error' });
      }
    }
  });

  const searchInput = root.querySelector('#vaultSearch');
  searchInput.addEventListener('input', () => {
    vaultView.q = searchInput.value;
    vaultSelected.clear();
    paintVault();
  });

  root.querySelector('#vaultSort').addEventListener('change', (event) => {
    vaultView.sort = event.target.value;
    vaultSelected.clear();
    paintVault();
  });

  root.querySelector('#vaultLayoutBtn').addEventListener('click', (event) => {
    vaultView.layout = vaultView.layout === 'grid' ? 'list' : 'grid';
    event.currentTarget.innerHTML = icon(vaultView.layout === 'grid' ? 'list' : 'grid');
    paintVault();
  });

  root.querySelector('#vaultChips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-vault-chip]');
    if (!chip) return;
    const key = chip.dataset.vaultChip;
    const value = chip.dataset.vaultValue;
    vaultView[key] = vaultView[key] === value ? '' : value;
    vaultSelected.clear();
    paintVault();
  });

  root.querySelector('[data-vault-lock]').addEventListener('click', async () => {
    try {
      await api.vaultLock();
    } catch {}
    setVaultToken('');
    closeModal();
    refreshBadge();
    toast('隐私空间已锁定', { type: 'success' });
  });

  root.querySelector('[data-vault-password]').addEventListener('click', () => {
    const current = window.prompt('输入当前密码');
    if (current === null) return;
    const next = window.prompt('输入新密码（至少 4 位）');
    if (next === null) return;
    api
      .vaultSetPassword(current, next)
      .then(() => toast('密码已修改', { type: 'success' }))
      .catch((error) => toast(error.message, { type: 'error' }));
  });
}

/* ---------------- 对外入口 ---------------- */

export async function openVault() {
  let st;
  try {
    st = await api.vaultStatus();
  } catch (error) {
    toast(error.message, { type: 'error' });
    return;
  }
  if (st.unlocked) return openVaultList();
  if (!st.hasPassword) return openSetPassword();
  return openUnlock();
}

// 把文件移入隐私空间；未解锁时先弹解锁框，解锁成功后继续
export async function hideFileFlow(id, title) {
  let st;
  try {
    st = await api.vaultStatus();
  } catch (error) {
    toast(error.message, { type: 'error' });
    return false;
  }
  if (!st.hasPassword) {
    toast('请先设置隐私空间密码', { type: 'info' });
    openSetPassword();
    return false;
  }
  if (!st.unlocked) {
    const unlocked = await openUnlock(`隐藏「${title}」前，请先解锁隐私空间`);
    if (!unlocked) return false;
  }
  try {
    await api.patchFile(id, { hidden: true });
    toast('已移入隐私空间', { type: 'success' });
    refreshBadge();
    return true;
  } catch (error) {
    toast(error.message, { type: 'error' });
    return false;
  }
}

export function initVault() {
  const button = document.getElementById('vaultBtn');
  if (button) button.addEventListener('click', openVault);
  refreshBadge();
}

// 供聚焦搜索使用：需要时先解锁，再打开某条隐藏文件的预览
export async function ensureVaultUnlocked(note) {
  let status = null;
  try {
    status = await api.vaultStatus();
  } catch {
    return false;
  }
  if (status.unlocked) return true;
  if (!status.hasPassword) {
    toast('请先设置隐私空间密码', { type: 'info' });
    openSetPassword();
    return false;
  }
  return openUnlock(note || '这是隐私文件，输入密码后查看', { openList: false });
}

export async function openVaultFile(id) {
  const unlocked = await ensureVaultUnlocked('查看这个隐私文件需要先解锁');
  if (!unlocked) return false;
  try {
    const data = await api.files({ hidden: 1 });
    const items = data.items || [];
    if (!items.some((item) => item.id === id)) {
      toast('这个文件已经不在隐私空间里了', { type: 'info' });
      return false;
    }
    openVaultPreview(id, items);
    return true;
  } catch (error) {
    toast(error.message, { type: 'error' });
    return false;
  }
}
