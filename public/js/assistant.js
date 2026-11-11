import { icon, esc, formatSize } from './render.js';
import { toast } from './toast.js';

const chatScroll = document.getElementById('chatScroll');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const sugList = document.getElementById('sugList');
const companionLine = document.getElementById('companionLine');
const companionMeta = document.getElementById('companionMeta');
const statRow = document.getElementById('statRow');
const aiBadge = document.getElementById('aiBadge');
const chatQuick = document.getElementById('chatQuick');
const refBar = document.getElementById('refBar');
const refBtn = document.getElementById('refBtn');
const refPickerRoot = document.getElementById('refPickerRoot');

const MAX_REFS = 3;
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const READABLE_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'yml', 'yaml', 'xml', 'ini', 'conf', 'log',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs',
  'php', 'rb', 'sh', 'bat', 'ps1', 'sql', 'html', 'htm', 'css', 'scss', 'ipynb', 'r', 'lua', 'kt', 'swift', 'dart',
  'pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods',
]);

const messages = [];
let context = null;
let busy = false;
let companionTimer = null;
let selectedFiles = [];
let pickerOpen = false;

const QUICK_PROMPTS = ['今天先复习什么？', '帮我讲一道错题', '总结一下最近的资料', '我该怎么安排这周', '陪我聊两句'];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '这么晚还没睡';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function addMessage(role, content, refs = []) {
  messages.push({ role, content });
  const node = document.createElement('div');
  node.className = `msg ${role === 'user' ? 'user' : 'ai'}`;
  node.innerHTML = `<span class="msg-avatar">${icon(role === 'user' ? 'sparkles' : 'logo')}</span>
    <div class="msg-body">
      <div class="msg-name">${role === 'user' ? '我' : '小陪'}</div>
      <div class="msg-text">${esc(content)}</div>
    </div>`;
  if (refs.length) {
    const box = document.createElement('div');
    box.className = 'msg-refs';
    box.innerHTML = refs
      .map((file) => `<span>${icon('file')}${esc(file.title)}</span>`)
      .join('');
    node.querySelector('.msg-body').appendChild(box);
  }
  chatScroll.appendChild(node);
  chatScroll.scrollTop = chatScroll.scrollHeight;
  return node;
}

function addTyping() {
  const node = document.createElement('div');
  node.className = 'msg ai typing';
  node.innerHTML = `<span class="msg-avatar">${icon('logo')}</span>
    <div class="msg-body">
      <div class="msg-name">小陪</div>
      <div class="msg-text"><i></i><i></i><i></i></div>
    </div>`;
  chatScroll.appendChild(node);
  chatScroll.scrollTop = chatScroll.scrollHeight;
  return node;
}

function renderQuick() {
  chatQuick.innerHTML = QUICK_PROMPTS.map(
    (text) => `<button class="quick-chip" type="button" data-quick="${esc(text)}">${esc(text)}</button>`
  ).join('');
}

const VISIBLE_SUGGESTIONS = 4;
const ROTATE_MS = 30000;
const REFRESH_MS = 90000;

let suggestionPool = [];
let suggestionOffset = 0;
let suggestTimer = null;
let refreshTimer = null;

function visibleSuggestions() {
  if (!suggestionPool.length) return [];
  const count = Math.min(VISIBLE_SUGGESTIONS, suggestionPool.length);
  return Array.from({ length: count }, (_, i) => suggestionPool[(suggestionOffset + i) % suggestionPool.length]);
}

function paintSuggestions() {
  const shown = visibleSuggestions();
  if (!shown.length) {
    sugList.innerHTML = '<p class="empty-note">暂时没有建议。多上传一些资料、记录几道错题，我会更懂你。</p>';
    return;
  }

  sugList.innerHTML = shown
    .map(
      (item) => `<article class="sug ${esc(item.tone || '')}">
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.detail)}</p>
        <button class="sug-act" type="button" data-sug="${esc(item.id || '')}">
          ${esc(item.action?.label || '看看')}${icon('arrow-right')}
        </button>
      </article>`
    )
    .join('');

  sugList.querySelectorAll('[data-sug]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = shown.find((entry) => String(entry.id || '') === button.dataset.sug);
      if (!item) return;
      if (item.action?.prompt) {
        send(item.action.prompt);
        return;
      }
      if (item.action?.href) window.location.href = item.action.href;
    });
  });

  sugList.classList.remove('is-swapping');
  void sugList.offsetWidth;
  sugList.classList.add('is-swapping');
}

function updateSuggestions(suggestions) {
  const next = Array.isArray(suggestions) ? suggestions : [];
  if (JSON.stringify(next) === JSON.stringify(suggestionPool)) return;
  suggestionPool = next;
  if (suggestionOffset >= suggestionPool.length) suggestionOffset = 0;
  paintSuggestions();
}

function rotateSuggestions() {
  if (suggestionPool.length <= VISIBLE_SUGGESTIONS) return;
  suggestionOffset = (suggestionOffset + 1) % suggestionPool.length;
  paintSuggestions();
}

function startSuggestionLoop() {
  if (suggestTimer) clearInterval(suggestTimer);
  suggestTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    rotateSuggestions();
  }, ROTATE_MS);

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    loadBrief({ silent: true });
  }, REFRESH_MS);
}

function refreshSuggestions() {
  suggestionOffset = 0;
  paintSuggestions();
}

function renderStats() {
  const items = [
    { value: context?.exam ? context.exam.daysLeft : '—', label: '距考试(天)' },
    { value: `${context?.todayTasks?.done ?? 0}/${context?.todayTasks?.total ?? 0}`, label: '今日复习' },
    { value: context?.openMistakes ?? 0, label: '待巩固错题' },
  ];
  statRow.innerHTML = items
    .map((item) => `<div class="stat-cell"><b>${esc(String(item.value))}</b><span>${esc(item.label)}</span></div>`)
    .join('');
}

function readableTag(file) {
  const ext = String(file.ext || '').toLowerCase();
  if (IMAGE_EXTS.has(ext)) return { text: '图片', ok: true };
  if (READABLE_EXTS.has(ext)) return { text: '可读', ok: true };
  return { text: '仅文件名', ok: false };
}

function renderRefBar() {
  if (!refBar) return;
  const has = selectedFiles.length > 0;
  refBar.hidden = !has;
  refBtn?.classList.toggle('active', has);
  if (!has) {
    refBar.innerHTML = '';
    return;
  }
  refBar.innerHTML =
    selectedFiles
      .map(
        (file) => `<span class="ref-chip">${icon('file')}<b>${esc(file.title)}</b>
          <button type="button" data-remove="${esc(file.id)}" aria-label="移除 ${esc(file.title)}">${icon('close')}</button>
        </span>`
      )
      .join('') + '<span class="ref-bar-hint">AI 会读这些文件的内容</span>';

  refBar.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedFiles = selectedFiles.filter((file) => String(file.id) !== String(button.dataset.remove));
      renderRefBar();
    });
  });
}

async function loadFileList() {
  const response = await fetch('/api/files?sort=newest');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '读取文件失败');
  return (data.items || []).filter((file) => !file.hidden);
}

function closeFilePicker() {
  pickerOpen = false;
  if (refPickerRoot) refPickerRoot.innerHTML = '';
  document.removeEventListener('keydown', onPickerKey, true);
}

function onPickerKey(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeFilePicker();
  }
}

async function openFilePicker() {
  if (pickerOpen || !refPickerRoot) return;
  pickerOpen = true;
  refPickerRoot.innerHTML = `<div class="refp">
    <div class="refp-card" role="dialog" aria-modal="true" aria-label="引用文件">
      <div class="refp-head">
        <div>
          <strong>引用文件</strong>
          <p>最多选 ${MAX_REFS} 份，AI 会先读内容再回答</p>
        </div>
        <button class="refp-x" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>
      <label class="refp-search">
        ${icon('search')}
        <input id="refpSearch" type="search" placeholder="搜索文件名、主题或类型…" autocomplete="off" aria-label="搜索文件">
      </label>
      <div class="refp-list" id="refpList"></div>
      <div class="refp-foot">
        <span id="refpCount">已选 0/${MAX_REFS}</span>
        <button class="btn primary" type="button" id="refpDone">确定</button>
      </div>
    </div>
  </div>`;

  const root = refPickerRoot.firstElementChild;
  const listEl = root.querySelector('#refpList');
  const searchEl = root.querySelector('#refpSearch');
  const countEl = root.querySelector('#refpCount');

  let files = [];
  let picked = selectedFiles.map((file) => String(file.id));

  const paint = () => {
    const query = searchEl.value.trim().toLowerCase();
    const shown = files.filter((file) => {
      if (!query) return true;
      const haystack = `${file.title || ''} ${file.topic || ''} ${file.category || ''} ${file.ext || ''}`;
      return haystack.toLowerCase().includes(query);
    });

    countEl.textContent = `已选 ${picked.length}/${MAX_REFS}`;

    if (!shown.length) {
      listEl.innerHTML = `<p class="empty-note" style="padding:12px">${
        files.length ? '没有匹配的文件' : '资料库还是空的，先回主页上传文件'
      }</p>`;
      return;
    }

    listEl.innerHTML = shown
      .map((file) => {
        const tag = readableTag(file);
        const on = picked.includes(String(file.id));
        const meta = [file.category, file.ext ? String(file.ext).toUpperCase() : '', file.size ? formatSize(file.size) : '']
          .filter(Boolean)
          .join(' · ');
        return `<button class="refp-row" type="button" data-id="${esc(file.id)}" aria-pressed="${on}">
          <span class="refp-tick">${icon('check')}</span>
          <span class="refp-main"><b>${esc(file.title)}</b><span>${esc(meta)}</span></span>
          <span class="refp-tag ${tag.ok ? 'ok' : ''}">${esc(tag.text)}</span>
        </button>`;
      })
      .join('');
  };

  listEl.addEventListener('click', (event) => {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    const id = String(row.dataset.id);
    if (picked.includes(id)) {
      picked = picked.filter((value) => value !== id);
    } else if (picked.length >= MAX_REFS) {
      toast(`最多引用 ${MAX_REFS} 份文件`);
      return;
    } else {
      picked.push(id);
    }
    paint();
  });

  searchEl.addEventListener('input', paint);
  root.querySelector('[data-close]').addEventListener('click', closeFilePicker);
  root.addEventListener('click', (event) => {
    if (event.target === root) closeFilePicker();
  });
  document.addEventListener('keydown', onPickerKey, true);

  root.querySelector('#refpDone').addEventListener('click', () => {
    selectedFiles = files.filter((file) => picked.includes(String(file.id)));
    renderRefBar();
    closeFilePicker();
    chatInput.focus();
  });

  listEl.innerHTML = '<p class="empty-note" style="padding:12px">正在读取文件…</p>';
  searchEl.focus();

  try {
    files = await loadFileList();
    paint();
  } catch (error) {
    listEl.innerHTML = `<p class="empty-note" style="padding:12px">${esc(error.message)}</p>`;
  }
}

function companionLines() {
  const lines = [];
  if (context?.exam) {
    lines.push(`距${context.exam.name}还有 ${context.exam.daysLeft} 天，节奏别乱，稳住就行。`);
  }
  if (context?.todayTasks?.total) {
    const left = context.todayTasks.total - context.todayTasks.done;
    lines.push(left > 0 ? `今天还有 ${left} 项没勾，先做最短的那项。` : '今天的复习都完成了，可以早点休息。');
  }
  if (context?.openMistakes) lines.push(`有 ${context.openMistakes} 道错题在等你，要不要挑一道让我讲？`);
  if (context?.topics?.length) lines.push(`「${context.topics[0].name}」的资料最多，我可以帮你总结重点。`);
  lines.push('我一直在这儿，有问题随时问我。');
  return lines;
}

function cycleCompanion() {
  let index = 0;
  const paint = () => {
    if (!companionLine) return;
    const lines = companionLines();
    if (!lines.length) return;
    if (!index) index = Math.floor(Math.random() * lines.length);
    companionLine.style.opacity = '0';
    setTimeout(() => {
      companionLine.textContent = lines[index % lines.length];
      companionLine.style.opacity = '1';
      index += 1;
    }, 220);
  };
  paint();
  if (companionTimer) clearInterval(companionTimer);
  companionTimer = setInterval(paint, 14000);
}

async function loadBrief({ silent = false } = {}) {
  try {
    const response = await fetch('/api/assistant/brief');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取失败');
    context = data.context;
    updateSuggestions(data.suggestions);
    renderStats();
    if (!companionTimer) cycleCompanion();

    aiBadge.className = `assist-badge ${context.aiEnabled ? '' : 'off'}`;
    aiBadge.innerHTML = `<i></i>${context.aiEnabled ? 'AI 已就绪' : 'AI 未启用'}`;

    if (context.aiEnabled) {
      chatInput.disabled = false;
      chatInput.placeholder = '问点什么…例如：今天先复习哪科？';
    } else {
      chatInput.disabled = true;
      chatInput.placeholder = '先在设置里填写 AI 接口和 Key';
    }
    if (refBtn) refBtn.disabled = !context.aiEnabled;

    if (context.exam) {
      companionMeta.innerHTML = `<span>${esc(context.exam.name)}</span><span>${esc(context.exam.date)}</span><span>资料 ${context.totalFiles}</span>`;
    } else {
      companionMeta.innerHTML = `<span>资料 ${context.totalFiles}</span><span>还没有考试安排</span>`;
    }
  } catch (error) {
    if (silent) return;
    sugList.innerHTML = `<p class="empty-note">${esc(error.message)}</p>`;
    aiBadge.className = 'assist-badge off';
    aiBadge.innerHTML = '<i></i>连接失败';
  }
}

function greetingMessage() {
  const parts = [greeting()];
  if (context?.exam) parts.push(`距${context.exam.name}还有 ${context.exam.daysLeft} 天`);
  if (context?.todayTasks?.total) {
    const left = context.todayTasks.total - context.todayTasks.done;
    parts.push(left > 0 ? `今天还有 ${left} 项复习` : '今天的复习已经完成');
  }
  if (context?.openMistakes) parts.push(`${context.openMistakes} 道错题待巩固`);
  return `${parts.join('，')}。想先聊哪件？`;
}

async function send(text) {
  const typed = String(text ?? chatInput.value).trim();
  const content = typed || (selectedFiles.length ? '帮我看看引用的文件，说说重点。' : '');
  if (!content || busy) return;
  if (!context?.aiEnabled) {
    toast('AI 还没启用，先去设置里配置', { type: 'info' });
    return;
  }

  const refs = selectedFiles.slice();

  chatInput.value = '';
  chatInput.style.height = 'auto';
  addMessage('user', content, refs);

  busy = true;
  chatSend.disabled = true;
  const typing = addTyping();

  try {
    const response = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.slice(-8), fileIds: refs.map((file) => file.id) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '助手暂时没有回应');
    typing.remove();
    addMessage('assistant', data.reply);
  } catch (error) {
    typing.remove();
    addMessage('assistant', `抱歉，我这边出了点问题：${error.message}`);
  } finally {
    busy = false;
    chatSend.disabled = false;
    chatInput.focus();
  }
}

function bindInput() {
  chatSend.addEventListener('click', () => send());
  refBtn?.addEventListener('click', () => {
    if (!context?.aiEnabled) {
      toast('AI 还没启用，先去设置里配置', { type: 'info' });
      return;
    }
    openFilePicker();
  });
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 132)}px`;
  });
  chatQuick.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-quick]');
    if (chip) send(chip.dataset.quick);
  });
  document.getElementById('refreshBrief').addEventListener('click', async () => {
    await loadBrief();
    refreshSuggestions();
    toast('建议已刷新');
  });
}

async function init() {
  renderQuick();
  bindInput();
  await loadBrief();
  startSuggestionLoop();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadBrief({ silent: true });
  });
  addMessage('assistant', greetingMessage());
}

init();
