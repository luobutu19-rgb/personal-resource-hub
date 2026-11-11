import { toast } from './toast.js';
import { initRipple } from './ripple.js';

const DEFAULT_DECK = '默认';

const state = {
  cards: [],
  decks: [],
  stats: { total: 0, due: 0, learned: 0, fresh: 0 },
  deck: 'all',
  q: '',
  filter: 'all',
  review: null,
};

const els = {
  statDue: document.getElementById('statDue'),
  statTotal: document.getElementById('statTotal'),
  statLearned: document.getElementById('statLearned'),
  deckList: document.getElementById('deckList'),
  deckSelect: document.getElementById('deckSelect'),
  deckTotal: document.getElementById('deckTotal'),
  listTitle: document.getElementById('listTitle'),
  listCount: document.getElementById('listCount'),
  cardList: document.getElementById('cardList'),
  sourceText: document.getElementById('sourceText'),
  generateBtn: document.getElementById('generateBtn'),
  manualBtn: document.getElementById('manualBtn'),
  reviewBtn: document.getElementById('reviewBtn'),
  searchInput: document.getElementById('searchInput'),
  filterSelect: document.getElementById('filterSelect'),
  aiHint: document.getElementById('aiHint'),
  editorRoot: document.getElementById('editorRoot'),
  reviewRoot: document.getElementById('reviewRoot'),
  themeBtn: document.getElementById('themeBtnCards'),
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="/icons.svg#i-${name}"></use></svg>`;
}

function isDue(card) {
  return (Date.parse(card.review?.due || 0) || 0) <= Date.now();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  let payload = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `请求失败（${response.status}）`);
  return payload;
}

async function loadData() {
  try {
    const data = await api('/api/cards');
    state.cards = Array.isArray(data.items) ? data.items : [];
    state.decks = Array.isArray(data.decks) ? data.decks : [];
    state.stats = data.stats || state.stats;
    renderAll();
  } catch (error) {
    els.cardList.innerHTML = `<div class="list-empty">${icon('file')}<p>读取卡片失败：${esc(
      error.message
    )}</p></div>`;
    toast(`读取卡片失败：${error.message}`, { type: 'error', duration: 5000 });
  }
}

function renderAll() {
  renderStats();
  renderDecks();
  renderDeckSelect();
  renderList();
}

function renderStats() {
  els.statDue.textContent = state.stats.due ?? 0;
  els.statTotal.textContent = state.stats.total ?? state.cards.length;
  els.statLearned.textContent = state.stats.learned ?? 0;
}

function renderDecks() {
  const total = state.cards.length;
  els.deckTotal.textContent = `${state.decks.length} 组`;
  const items = [
    { name: 'all', label: '全部卡片', count: total, due: state.stats.due || 0 },
    ...state.decks.map((deck) => ({ name: deck.name, label: deck.name, count: deck.count, due: deck.due })),
  ];

  els.deckList.innerHTML = items
    .map(
      (item) => `<button class="deck-item ${state.deck === item.name ? 'active' : ''}" type="button" data-deck="${esc(
        item.name
      )}">
        ${item.due ? '<span class="deck-due" aria-hidden="true"></span>' : ''}
        <span class="deck-name">${esc(item.label)}</span>
        <span class="deck-count">${item.count}</span>
      </button>`
    )
    .join('');
}

function renderDeckSelect() {
  const names = [...new Set([DEFAULT_DECK, ...state.decks.map((deck) => deck.name)])];
  const current = els.deckSelect.value;
  els.deckSelect.innerHTML = names
    .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`)
    .join('');
  const active = state.deck !== 'all' ? state.deck : current || DEFAULT_DECK;
  els.deckSelect.value = names.includes(active) ? active : DEFAULT_DECK;
}

function visibleCards() {
  const query = state.q.trim().toLowerCase();
  return state.cards.filter((card) => {
    if (state.deck !== 'all' && card.deck !== state.deck) return false;
    if (state.filter === 'due' && !isDue(card)) return false;
    if (state.filter === 'new' && card.review?.reps) return false;
    if (query) {
      const text = `${card.title || ''} ${card.front} ${card.back} ${(card.tags || []).join(' ')} ${
        card.deck
      }`.toLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  });
}

function renderList() {
  const cards = visibleCards();
  els.listTitle.textContent = state.deck === 'all' ? '全部卡片' : state.deck;
  els.listCount.textContent = `${cards.length} 张`;

  if (!cards.length) {
    els.cardList.innerHTML = `<div class="list-empty">${icon('cards')}<p>${
      state.cards.length
        ? '没有符合条件的卡片，换个筛选试试'
        : '还没有卡片。把笔记粘到上面的输入框，点「AI 一键制卡」，或手动添加一张。'
    }</p></div>`;
    return;
  }

  els.cardList.innerHTML = cards
    .map((card) => {
      const due = isDue(card);
      const fresh = !card.review?.reps;
      const tags = (card.tags || [])
        .slice(0, 4)
        .map((tag) => `<span class="pill">${esc(tag)}</span>`)
        .join('');
      return `<article class="card-item" data-id="${card.id}">
        <div class="main">
          ${card.title ? `<p class="card-title">${esc(card.title)}</p>` : ''}
          <p class="front">${esc(card.front)}</p>
          <p class="back">${esc(card.back)}</p>
          <div class="meta">
            <span class="pill deck">${esc(card.deck)}</span>
            ${fresh ? '<span class="pill new">新卡</span>' : ''}
            ${due ? '<span class="pill due">待复习</span>' : ''}
            ${fresh ? '' : `<span class="pill">已复习 ${card.review?.reps || 0} 次</span>`}
            ${tags}
          </div>
        </div>
        <div class="card-actions">
          <button class="icon-btn small" type="button" data-edit="${card.id}" aria-label="编辑">${icon('edit')}</button>
          <button class="icon-btn small" type="button" data-delete="${card.id}" aria-label="删除">${icon('trash')}</button>
        </div>
      </article>`;
    })
    .join('');
}

// ---------- 卡片详情 ----------

function formatDay(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function openDetail(card) {
  const due = isDue(card);
  const review = card.review || {};
  const reps = review.reps || 0;
  const interval = review.interval || 0;
  const tags = (card.tags || []).map((tag) => `<span class="pill">${esc(tag)}</span>`).join('');
  const created = formatDay(card.createdAt);
  const nextDue = formatDay(review.due);
  const updated = card.updatedAt && card.updatedAt !== card.createdAt ? formatDay(card.updatedAt) : '';

  els.editorRoot.innerHTML = `<div class="sheet-backdrop">
    <div class="sheet detail-sheet" role="dialog" aria-modal="true" aria-label="卡片详情">
      <header class="detail-head">
        <div>
          ${card.title ? `<p class="detail-kicker">${esc(card.title)}</p>` : ''}
          <div class="detail-meta">
            <span class="pill deck">${esc(card.deck)}</span>
            ${due ? '<span class="pill due">待复习</span>' : `<span class="pill">下次复习 ${esc(nextDue)}</span>`}
            ${reps ? `<span class="pill">已复习 ${reps} 次</span>` : '<span class="pill new">新卡</span>'}
            ${interval ? `<span class="pill">间隔 ${interval} 天</span>` : ''}
            ${created ? `<span class="pill">创建于 ${esc(created)}</span>` : ''}
            ${updated ? `<span class="pill">更新于 ${esc(updated)}</span>` : ''}
            ${tags}
          </div>
        </div>
        <button class="icon-btn" id="detailClose" type="button" aria-label="关闭">${icon('close')}</button>
      </header>
      <div class="detail-body">
        <section class="detail-section">
          <h3>正面 · 问题</h3>
          <p class="detail-text">${esc(card.front)}</p>
        </section>
        <section class="detail-section">
          <h3>背面 · 答案</h3>
          <p class="detail-text">${esc(card.back)}</p>
        </section>
      </div>
      <footer class="detail-actions">
        <button class="btn danger" id="detailDelete" type="button">${icon('trash')}<span>删除</span></button>
        <span class="spacer"></span>
        <button class="btn ghost" id="detailEdit" type="button">${icon('edit')}<span>编辑</span></button>
        <button class="btn primary" id="detailReview" type="button">${icon('cards')}<span>复习这张</span></button>
      </footer>
    </div>
  </div>`;

  document.body.classList.add('modal-open');

  const close = () => {
    document.removeEventListener('keydown', onKey);
    closeEditor();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey);

  const backdrop = els.editorRoot.querySelector('.sheet-backdrop');
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  els.editorRoot.querySelector('#detailClose').addEventListener('click', close);
  els.editorRoot.querySelector('#detailEdit').addEventListener('click', () => {
    close();
    openEditor(card);
  });
  els.editorRoot.querySelector('#detailReview').addEventListener('click', () => {
    close();
    startReview([card]);
  });
  els.editorRoot.querySelector('#detailDelete').addEventListener('click', async (event) => {
    if (!window.confirm(`删除卡片「${card.title || card.front.slice(0, 24)}」？`)) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api(`/api/cards/${encodeURIComponent(card.id)}`, { method: 'DELETE' });
      close();
      toast('卡片已删除', { type: 'info' });
      await loadData();
    } catch (error) {
      toast(error.message, { type: 'error' });
      button.disabled = false;
    }
  });
}

// ---------- 编辑器 ----------

function closeEditor() {
  els.editorRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
}

function openEditor(card = null) {
  const isNew = !card;
  const deckNames = [...new Set([DEFAULT_DECK, ...state.decks.map((item) => item.name)])];
  const deck = card?.deck || (state.deck !== 'all' ? state.deck : els.deckSelect.value) || DEFAULT_DECK;

  els.editorRoot.innerHTML = `<div class="sheet-backdrop">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${isNew ? '新建卡片' : '编辑卡片'}">
      <h2>${isNew ? '新建卡片' : '编辑卡片'}</h2>
      <label class="field"><span>标题（可选）</span>
        <input id="editTitle" maxlength="48" value="${esc(
          card?.title || ''
        )}" placeholder="例如：唯物论 · 物质与意识的辩证关系">
      </label>
      <label class="field"><span>正面（问题 / 提示）</span>
        <textarea class="front-input" id="editFront" maxlength="200" placeholder="例如：勾股定理的表达式是什么？">${esc(
          card?.front || ''
        )}</textarea>
      </label>
      <label class="field"><span>背面（答案 / 解释）</span>
        <textarea class="back-input" id="editBack" maxlength="800" placeholder="例如：a² + b² = c²，其中 c 为斜边。">${esc(
          card?.back || ''
        )}</textarea>
      </label>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label class="field" style="flex:1;min-width:140px"><span>卡组</span>
          <input id="editDeck" list="deckOptions" value="${esc(deck)}" maxlength="20" placeholder="默认">
          <datalist id="deckOptions">${deckNames
            .map((name) => `<option value="${esc(name)}"></option>`)
            .join('')}</datalist>
        </label>
        <label class="field" style="flex:1.4;min-width:160px"><span>标签（空格或逗号分隔）</span>
          <input id="editTags" value="${esc((card?.tags || []).join(' '))}" placeholder="数学 公式">
        </label>
      </div>
      <div class="sheet-actions">
        ${isNew ? '' : '<button class="btn danger" id="editDelete" type="button">删除</button>'}
        <span class="spacer"></span>
        <button class="btn ghost" id="editCancel" type="button">取消</button>
        <button class="btn primary" id="editSave" type="button">保存</button>
      </div>
    </div>
  </div>`;

  document.body.classList.add('modal-open');
  const backdrop = els.editorRoot.querySelector('.sheet-backdrop');
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeEditor();
  });
  els.editorRoot.querySelector('#editCancel').addEventListener('click', closeEditor);
  els.editorRoot.querySelector('#editFront').focus();

  els.editorRoot.querySelector('#editSave').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const front = els.editorRoot.querySelector('#editFront').value.trim();
    const back = els.editorRoot.querySelector('#editBack').value.trim();
    const title = els.editorRoot.querySelector('#editTitle').value.trim();
    const deckName = els.editorRoot.querySelector('#editDeck').value.trim() || DEFAULT_DECK;
    const tags = els.editorRoot.querySelector('#editTags').value;

    if (!front) return toast('请填写卡片正面', { type: 'error' });
    if (!back) return toast('请填写卡片背面', { type: 'error' });

    button.disabled = true;
    button.textContent = '保存中…';
    try {
      if (isNew)
        await api('/api/cards', {
          method: 'POST',
          body: JSON.stringify({ title, front, back, deck: deckName, tags }),
        });
      else
        await api(`/api/cards/${encodeURIComponent(card.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title, front, back, deck: deckName, tags }),
        });

      closeEditor();
      toast(isNew ? '卡片已添加' : '卡片已保存', { type: 'success' });
      state.deck = deckName;
      await loadData();
    } catch (error) {
      toast(error.message, { type: 'error', duration: 5000 });
      button.disabled = false;
      button.textContent = '保存';
    }
  });

  els.editorRoot.querySelector('#editDelete')?.addEventListener('click', async (event) => {
    if (!window.confirm('删除这张卡片？')) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api(`/api/cards/${encodeURIComponent(card.id)}`, { method: 'DELETE' });
      closeEditor();
      toast('卡片已删除', { type: 'info' });
      await loadData();
    } catch (error) {
      toast(error.message, { type: 'error' });
      button.disabled = false;
    }
  });

  const onKey = (event) => {
    if (event.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      closeEditor();
    }
  };
  document.addEventListener('keydown', onKey);
}

// ---------- 复习 ----------

function closeReview() {
  els.reviewRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
  state.review = null;
  document.removeEventListener('keydown', onReviewKey);
}

function reviewCards() {
  const pool = state.cards.filter((card) => state.deck === 'all' || card.deck === state.deck);
  return pool;
}

function startReview(cardsOverride) {
  const pool = Array.isArray(cardsOverride) && cardsOverride.length ? cardsOverride : reviewCards();
  if (!pool.length) {
    toast(state.cards.length ? '这个卡组还没有卡片' : '先添加或生成一些卡片吧', { type: 'info' });
    return;
  }

  const due = pool.filter(isDue);
  const queue = (due.length ? due : pool).slice().sort(() => Math.random() - 0.5);
  state.review = {
    queue,
    index: 0,
    flipped: false,
    total: queue.length,
    reviewed: 0,
    free: !due.length,
  };
  renderReview();
}

function renderReview() {
  const review = state.review;
  if (!review) return;

  if (review.index >= review.queue.length) {
    els.reviewRoot.innerHTML = `<div class="review-overlay">
      <div class="review-done">
        <div>
          <h2>本轮完成</h2>
          <p>复习了 ${review.reviewed} 张卡片${review.free ? '（自由复习）' : ''}，休息一下再来。</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="btn ghost" id="reviewAgain" type="button">再来一轮</button>
            <button class="btn primary" id="reviewExit" type="button">回到列表</button>
          </div>
        </div>
      </div>
    </div>`;
    document.body.classList.add('modal-open');
    els.reviewRoot.querySelector('#reviewAgain').addEventListener('click', () => {
      closeReview();
      startReview();
    });
    els.reviewRoot.querySelector('#reviewExit').addEventListener('click', () => {
      closeReview();
      loadData();
    });
    return;
  }

  const card = review.queue[review.index];
  const progress = Math.round((review.index / Math.max(review.total, 1)) * 100);
  const tags = (card.tags || [])
    .slice(0, 5)
    .map((tag) => `<span class="pill">${esc(tag)}</span>`)
    .join('');

  els.reviewRoot.innerHTML = `<div class="review-overlay">
    <div class="review-top">
      <button class="icon-btn" id="reviewClose" type="button" aria-label="退出复习">${icon('close')}</button>
      <div class="review-progress"><i style="width:${progress}%"></i></div>
      <span class="review-count">${review.index + 1} / ${review.total}${review.free ? ' · 自由复习' : ''}</span>
    </div>
    <div class="review-stage">
      <button class="flip-card ${review.flipped ? 'flipped' : ''}" id="flipCard" type="button" aria-label="点击翻面">
        <span class="flip-inner">
          <span class="flip-face front">
            <span class="face-label">${esc(card.title || '问题')}</span>
            <span class="face-text">${esc(card.front)}</span>
            <span class="face-tags">${tags}</span>
            <span class="flip-hint">点击卡片或按空格翻面</span>
          </span>
          <span class="flip-face back">
            <span class="face-label">答案</span>
            <span class="face-text">${esc(card.back)}</span>
          </span>
        </span>
      </button>
    </div>
    <div class="review-actions">
      <button class="grade-btn" data-grade="again" type="button">忘记<small>10 分钟后再来</small></button>
      <button class="grade-btn" data-grade="hard" type="button">模糊<small>缩短间隔</small></button>
      <button class="grade-btn" data-grade="good" type="button">记住<small>拉长间隔</small></button>
    </div>
  </div>`;

  document.body.classList.add('modal-open');
  const flip = els.reviewRoot.querySelector('#flipCard');
  flip.addEventListener('click', () => {
    if (!state.review) return;
    state.review.flipped = true;
    flip.classList.add('flipped');
  });

  els.reviewRoot.querySelector('#reviewClose').addEventListener('click', () => {
    closeReview();
    loadData();
  });

  els.reviewRoot.querySelectorAll('[data-grade]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      gradeCard(button.dataset.grade);
    });
  });
}

async function gradeCard(result) {
  const review = state.review;
  if (!review || !review.flipped) {
    toast('先翻面看答案，再选择记得程度', { type: 'info' });
    return;
  }

  const card = review.queue[review.index];
  els.reviewRoot.querySelectorAll('[data-grade]').forEach((button) => {
    button.disabled = true;
  });

  try {
    const data = await api(`/api/cards/${encodeURIComponent(card.id)}/review`, {
      method: 'POST',
      body: JSON.stringify({ result }),
    });
    if (data.stats) state.stats = data.stats;
    if (data.decks) state.decks = data.decks;
    renderStats();
    renderDecks();

    review.reviewed += 1;
    if (result === 'again') {
      review.queue.push({ ...card, review: data.item?.review || card.review });
    }

    review.index += 1;
    review.flipped = false;
    renderReview();
  } catch (error) {
    toast(error.message, { type: 'error' });
    els.reviewRoot.querySelectorAll('[data-grade]').forEach((button) => {
      button.disabled = false;
    });
  }
}

function onReviewKey(event) {
  if (!state.review) return;
  if (event.key === 'Escape') {
    closeReview();
    loadData();
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    const flip = els.reviewRoot.querySelector('#flipCard');
    if (flip && !state.review.flipped) {
      state.review.flipped = true;
      flip.classList.add('flipped');
    }
    return;
  }
  if (['1', '2', '3'].includes(event.key) && state.review.flipped) {
    event.preventDefault();
    gradeCard(event.key === '1' ? 'again' : event.key === '2' ? 'hard' : 'good');
  }
}

// ---------- AI 制卡 ----------

async function generate() {
  const text = els.sourceText.value.trim();
  if (text.length < 12) {
    toast('内容太短，至少粘贴 12 个字', { type: 'error' });
    els.sourceText.focus();
    return;
  }

  const deck = els.deckSelect.value || DEFAULT_DECK;
  const count = els.countSelect.value;
  const original = els.generateBtn.innerHTML;
  els.generateBtn.disabled = true;
  els.generateBtn.textContent = 'AI 制卡中…';

  try {
    const data = await api('/api/cards/generate', {
      method: 'POST',
      body: JSON.stringify({ text, deck, count }),
    });
    const created = Array.isArray(data.items) ? data.items : [];
    state.stats = data.stats || state.stats;
    state.decks = data.decks || state.decks;
    state.deck = deck;
    els.sourceText.value = '';
    toast(`已生成 ${created.length} 张卡片`, { type: 'success' });
    await loadData();
  } catch (error) {
    toast(error.message, { type: 'error', duration: 6000 });
  } finally {
    els.generateBtn.disabled = false;
    els.generateBtn.innerHTML = original;
  }
}

// ---------- 事件绑定 ----------

els.deckList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-deck]');
  if (!button) return;
  state.deck = button.dataset.deck;
  renderDecks();
  renderList();
  renderDeckSelect();
});

els.cardList.addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit]');
  if (edit) {
    const card = state.cards.find((item) => item.id === edit.dataset.edit);
    if (card) openEditor(card);
    return;
  }
  const remove = event.target.closest('[data-delete]');
  if (remove) {
    const card = state.cards.find((item) => item.id === remove.dataset.delete);
    if (!card) return;
    if (!window.confirm(`删除卡片「${card.front.slice(0, 24)}」？`)) return;
    api(`/api/cards/${encodeURIComponent(card.id)}`, { method: 'DELETE' })
      .then(() => {
        toast('卡片已删除', { type: 'info' });
        return loadData();
      })
      .catch((error) => toast(error.message, { type: 'error' }));
    return;
  }
  const item = event.target.closest('.card-item');
  if (item) {
    const card = state.cards.find((entry) => entry.id === item.dataset.id);
    if (card) openDetail(card);
  }
});

els.manualBtn.addEventListener('click', () => openEditor(null));
els.generateBtn.addEventListener('click', generate);
els.reviewBtn.addEventListener('click', () => startReview());

els.searchInput.addEventListener('input', () => {
  state.q = els.searchInput.value;
  renderList();
});

els.filterSelect.addEventListener('change', () => {
  state.filter = els.filterSelect.value;
  renderList();
});

document.getElementById('newDeckBtn').addEventListener('click', () => {
  const name = window.prompt('新卡组名称', '');
  if (!name || !name.trim()) return;
  const clean = name.trim().slice(0, 20);
  if (![...els.deckSelect.options].some((option) => option.value === clean)) {
    const option = document.createElement('option');
    option.value = clean;
    option.textContent = clean;
    els.deckSelect.appendChild(option);
  }
  els.deckSelect.value = clean;
  toast(`已选择卡组「${clean}」，添加卡片后生效`, { type: 'info', duration: 3600 });
});

document.addEventListener('keydown', (event) => {
  if (state.review) onReviewKey(event);
});

// 主题：跟随系统 / 浅色 / 深色
const THEME_LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };
function renderThemeBtn() {
  const mode = window.RHTheme?.read() || 'auto';
  els.themeBtn.textContent = THEME_LABELS[mode];
  els.themeBtn.title = `主题：${THEME_LABELS[mode]}（点击切换）`;
}
renderThemeBtn();
document.addEventListener('rh:theme', renderThemeBtn);
els.themeBtn.addEventListener('click', () => {
  window.RHTheme?.cycle();
});

// AI 可用性提示
fetch('/api/settings')
  .then((response) => (response.ok ? response.json() : null))
  .then((settings) => {
    if (!settings) return;
    const enabled = Boolean(settings.ai?.enabled && settings.hasApiKey);
    els.aiHint.innerHTML = enabled
      ? 'AI 已就绪：粘贴的内容会发送到你配置的 AI 服务，请确认隐私与费用。生成后可逐张编辑。'
      : 'AI 还没开启：先到 <a href="/">资源站 → 设置</a> 填写接口、模型和 API Key，再回来一键制卡。手动添加不受影响。';
    if (!enabled) els.generateBtn.title = '需要先在设置里开启 AI';
  })
  .catch(() => {});

initRipple();
loadData();
