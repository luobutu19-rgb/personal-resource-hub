const state = {
  items: [],
  eras: [],
  stats: { total: 0, eras: 0, learned: 0, reviewedToday: 0 },
  q: '',
  era: 'all',
  editingId: null,
  review: null,
};

const ERAS = ['中国古代史', '中国近代史', '中国现代史', '世界史'];

const $ = (selector) => document.querySelector(selector);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后再试');
  return data;
}

function toast(message, type = '') {
  const stack = $('#toastStack');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => node.remove(), 2400);
}

function formatYear(year) {
  if (!year) return '时间未定';
  return year < 0 ? `公元前${Math.abs(year)}` : `${year}`;
}

function eraLabel(item) {
  return item.era || '未分期';
}

async function load() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.era !== 'all') params.set('era', state.era);
  try {
    const data = await api(`/api/history?${params.toString()}`);
    state.items = data.items || [];
    state.eras = data.eras || [];
    state.stats = data.stats || state.stats;
    renderStats();
    renderEras();
    renderTimeline();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderStats() {
  const stats = state.stats;
  $('#statRow').innerHTML = `
    <span class="stat-pill">事件 <b>${stats.total || 0}</b></span>
    <span class="stat-pill">时期 <b>${stats.eras || 0}</b></span>
    <span class="stat-pill">已掌握 <b>${stats.learned || 0}</b></span>
    <span class="stat-pill">今日复习 <b>${stats.reviewedToday || 0}</b></span>
  `;
}

function renderEras() {
  const select = $('#eraSelect');
  const current = state.era;
  select.innerHTML =
    '<option value="all">全部时期</option>' +
    state.eras
      .map((era) => `<option value="${esc(era.name)}">${esc(era.name)} · ${era.count}</option>`)
      .join('');
  select.value = state.eras.some((era) => era.name === current) ? current : 'all';
  if (select.value !== current) state.era = select.value;
}

function reviewBadge(item) {
  const review = item.review || {};
  if (review.lastResult === 'good') return '<span class="tl-review">已掌握</span>';
  if (review.lastResult === 'hard') return '<span class="tl-review">有点模糊</span>';
  if (review.lastResult === 'again') return '<span class="tl-review warn">需要再看</span>';
  return '<span class="tl-review warn">未复习</span>';
}

function renderTimeline() {
  const timeline = $('#timeline');
  if (!state.items.length) {
    timeline.innerHTML = `
      <div class="empty-state">
        <b>${state.q || state.era !== 'all' ? '没有找到匹配的事件' : '还没有记录历史大事'}</b>
        ${state.q || state.era !== 'all' ? '换个关键词或时期试试' : '点右上角「记录大事」，把时间和事件记下来，时间轴会自动排好顺序'}
      </div>`;
    return;
  }

  let lastYear = null;
  timeline.innerHTML = state.items
    .map((item) => {
      const yearBlock =
        item.year !== lastYear
          ? `<div class="tl-year">${esc(formatYear(item.year))}</div>`
          : '';
      lastYear = item.year;
      return `${yearBlock}
        <article class="tl-item" data-id="${esc(item.id)}">
          <div class="tl-card">
            <span class="tl-time">${esc(item.time)}</span>
            <h3>${esc(item.title)}</h3>
            ${item.detail ? `<p>${esc(item.detail)}</p>` : ''}
            <div class="tl-foot">
              <span class="tl-era">${esc(eraLabel(item))}</span>
              ${reviewBadge(item)}
              <span class="tl-tools">
                <button type="button" data-act="edit" data-id="${esc(item.id)}" aria-label="编辑" title="编辑">
                  <svg class="icon"><use href="/icons.svg#i-edit"></use></svg>
                </button>
                <button type="button" data-act="delete" data-id="${esc(item.id)}" aria-label="删除" title="删除">
                  <svg class="icon"><use href="/icons.svg#i-trash"></use></svg>
                </button>
              </span>
            </div>
          </div>
        </article>`;
    })
    .join('');
}

function findItem(id) {
  return state.items.find((item) => item.id === id) || null;
}

/* ---------- 编辑 / 新增 ---------- */

function openEditor(item = null) {
  state.editingId = item?.id || null;
  const eras = [...new Set([...ERAS, ...state.eras.map((era) => era.name)])];
  $('#sheetRoot').innerHTML = `
    <div class="sheet-wrap" id="sheetWrap" role="dialog" aria-modal="true" aria-label="${item ? '编辑历史事件' : '记录历史大事'}">
      <form class="sheet" id="historyForm">
        <h2>${item ? '编辑历史事件' : '记录历史大事'}</h2>
        <label class="field">
          <span>时间</span>
          <input id="evTime" type="text" maxlength="24" placeholder="1840年6月" value="${esc(item?.time || '')}" required>
          <p class="hint">支持「1840年6月」「1840-06」「公元前221年」，时间轴按年份自动排序</p>
        </label>
        <label class="field">
          <span>历史事件</span>
          <input id="evTitle" type="text" maxlength="60" placeholder="鸦片战争爆发" value="${esc(item?.title || '')}" required>
        </label>
        <label class="field">
          <span>说明（可选）</span>
          <textarea id="evDetail" maxlength="1200" placeholder="原因、经过、影响，或一句记忆提示">${esc(item?.detail || '')}</textarea>
        </label>
        <label class="field">
          <span>时期（可选）</span>
          <input id="evEra" type="text" maxlength="20" list="eraOptions" placeholder="中国近代史" value="${esc(item?.era || '')}">
          <datalist id="eraOptions">
            ${eras.map((era) => `<option value="${esc(era)}"></option>`).join('')}
          </datalist>
        </label>
        <div class="sheet-actions">
          <button class="btn ghost" type="button" id="sheetCancel">取消</button>
          <span class="spacer"></span>
          <button class="btn primary" type="submit">保存</button>
        </div>
      </form>
    </div>`;

  const wrap = $('#sheetWrap');
  wrap.addEventListener('click', (event) => {
    if (event.target === wrap) closeEditor();
  });
  $('#sheetCancel').addEventListener('click', closeEditor);
  $('#historyForm').addEventListener('submit', saveEvent);
  $('#evTime').focus();
}

function closeEditor() {
  state.editingId = null;
  $('#sheetRoot').innerHTML = '';
}

async function saveEvent(event) {
  event.preventDefault();
  const time = $('#evTime').value.trim();
  const title = $('#evTitle').value.trim();
  if (!time) return toast('先填写时间，例如 1840年6月', 'error');
  if (!/\d{3,4}/.test(time)) return toast('时间里需要有年份，例如 1840年6月', 'error');
  if (!title) return toast('填写一下这段时间发生了什么', 'error');

  const payload = {
    time,
    title,
    detail: $('#evDetail').value,
    era: $('#evEra').value,
  };

  const isEdit = Boolean(state.editingId);
  const submit = event.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    if (isEdit) {
      await api(`/api/history/${state.editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/api/history', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeEditor();
    await load();
    toast(isEdit ? '已更新' : '已记录到时间轴');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
}

async function deleteEvent(item) {
  if (!item) return;
  if (!window.confirm(`删除「${item.title}」？`)) return;
  try {
    await api(`/api/history/${item.id}`, { method: 'DELETE' });
    await load();
    toast('已删除');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ---------- 小卡复习 ---------- */

function startReview() {
  if (!state.items.length) {
    toast('先记录几条历史大事，再来复习', 'error');
    return;
  }
  const pending = state.items.filter((item) => item.review?.lastResult !== 'good');
  const queue = (pending.length ? pending : state.items).slice().sort((a, b) => a.sort - b.sort);
  state.review = {
    queue,
    index: 0,
    flipped: false,
    reviewed: new Set(),
    total: queue.length,
  };
  renderReview();
}

function currentCard() {
  const review = state.review;
  return review ? review.queue[review.index] || null : null;
}

function renderReview() {
  const root = $('#reviewRoot');
  const review = state.review;
  if (!review) {
    root.innerHTML = '';
    return;
  }

  if (review.index >= review.queue.length) {
    const learned = review.reviewed.size;
    root.innerHTML = `
      <div class="review-shell" role="dialog" aria-modal="true" aria-label="复习完成">
        <div class="review-empty">
          <h2>这一轮过完了</h2>
          <p>共复习 ${review.total} 张，记住 ${learned} 张${review.total - learned > 0 ? `，${review.total - learned} 张还需要再看` : ''}。</p>
          <div class="review-actions">
            <button class="btn ghost" type="button" data-act="close-review">返回时间轴</button>
            <button class="btn primary" type="button" data-act="restart-review">再来一轮</button>
          </div>
        </div>
      </div>`;
    return;
  }

  const item = review.queue[review.index];
  const progress = Math.round((review.reviewed.size / Math.max(1, review.total)) * 100);
  root.innerHTML = `
    <div class="review-shell" role="dialog" aria-modal="true" aria-label="小卡复习">
      <div class="review-top">
        <span class="review-progress">${review.index + 1} / ${review.queue.length}</span>
        <span class="review-bar"><i style="width:${progress}%"></i></span>
        <button class="review-close" type="button" data-act="close-review" aria-label="退出复习">
          <svg class="icon"><use href="/icons.svg#i-close"></use></svg>
        </button>
      </div>
      <div class="rev-wrap">
        <div class="rev-card ${review.flipped ? 'is-flipped' : ''}" id="revCard">
          <div class="rev-face rev-front">
            <span class="rev-time">${esc(item.time)}</span>
            <span class="rev-prompt">这段时间发生了什么？</span>
            <button class="rev-flip" type="button" data-act="flip">点击卡片翻面</button>
          </div>
          <div class="rev-face rev-back">
            <h3>${esc(item.title)}</h3>
            ${item.detail ? `<p class="rev-detail">${esc(item.detail)}</p>` : ''}
            <span class="rev-era">${esc(eraLabel(item))}</span>
          </div>
        </div>
      </div>
      <div class="review-actions">
        ${
          review.flipped
            ? `<button class="btn ghost grade-again" type="button" data-act="grade" data-result="again">忘记了</button>
               <button class="btn ghost grade-hard" type="button" data-act="grade" data-result="hard">有点模糊</button>
               <button class="btn ghost grade-good" type="button" data-act="grade" data-result="good">记住了</button>`
            : '<button class="btn primary" type="button" data-act="flip">看答案</button>'
        }
      </div>
    </div>`;
}

function flipCard() {
  if (!state.review) return;
  state.review.flipped = !state.review.flipped;
  renderReview();
}

async function gradeCard(result) {
  const review = state.review;
  const item = currentCard();
  if (!review || !item) return;

  try {
    const data = await api(`/api/history/${item.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ result }),
    });
    item.review = data.item.review;
    state.stats = data.stats || state.stats;
    renderStats();

    if (result === 'again') {
      review.queue.push(item);
    } else {
      review.reviewed.add(item.id);
    }
    review.index += 1;
    review.flipped = false;
    renderTimeline();
    renderReview();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function closeReview() {
  state.review = null;
  $('#reviewRoot').innerHTML = '';
  renderTimeline();
}

/* ---------- 事件绑定 ---------- */

$('#addBtn').addEventListener('click', () => openEditor());
$('#reviewBtn').addEventListener('click', startReview);

let searchTimer = 0;
$('#searchInput').addEventListener('input', (event) => {
  const value = event.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = value;
    load();
  }, 260);
});

$('#eraSelect').addEventListener('change', (event) => {
  state.era = event.target.value;
  load();
});

$('#timeline').addEventListener('click', (event) => {
  const action = event.target.closest?.('[data-act]');
  if (!action) return;
  const item = findItem(action.dataset.id);
  if (!item) return;
  if (action.dataset.act === 'edit') openEditor(item);
  if (action.dataset.act === 'delete') deleteEvent(item);
});

$('#reviewRoot').addEventListener('click', (event) => {
  const action = event.target.closest?.('[data-act]');
  if (!action) return;
  const act = action.dataset.act;
  if (act === 'close-review') closeReview();
  if (act === 'restart-review') {
    state.review = { ...state.review, index: 0, flipped: false, reviewed: new Set() };
    renderReview();
  }
  if (act === 'flip') flipCard();
  if (act === 'grade') gradeCard(action.dataset.result);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.review) closeReview();
    else if (state.editingId) closeEditor();
    return;
  }
  if (!state.review || state.editingId) return;
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    flipCard();
  }
  if (!state.review.flipped) return;
  if (event.key === '1') gradeCard('again');
  if (event.key === '2') gradeCard('hard');
  if (event.key === '3') gradeCard('good');
});

load();
