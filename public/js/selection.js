import { api } from './api.js';
import { state, setState, visibleFiles, refreshAll } from './store.js';
import { toast } from './toast.js';
import { ensureVaultUnlocked } from './vault.js';

function bar() {
  return document.getElementById('bulkBar');
}

export function initSelection() {
  document.getElementById('selectBtn')?.addEventListener('click', () => setSelecting(!state.selecting));
  bar()?.addEventListener('click', onBarClick);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selecting) setSelecting(false);
  });
}

export function setSelecting(on) {
  setState({ selecting: Boolean(on), selected: [] });
  document.body.classList.toggle('selecting', Boolean(on));
  renderBar();
}

export function toggleSelected(id) {
  const selected = state.selected.includes(id)
    ? state.selected.filter((item) => item !== id)
    : [...state.selected, id];
  setState({ selected });
  renderBar();
}

export function renderBar() {
  const element = bar();
  if (!element) return;

  element.hidden = !state.selecting;
  document.body.classList.toggle('selecting', state.selecting);
  if (!state.selecting) return;

  const count = state.selected.length;
  const label = document.getElementById('bulkCount');
  if (label) label.textContent = `已选 ${count} 项`;

  const total = visibleFiles().length;
  const allButton = element.querySelector('[data-bulk="all"]');
  if (allButton) allButton.textContent = total > 0 && count === total ? '取消全选' : '全选';

  element.querySelectorAll('button[data-bulk]').forEach((button) => {
    if (button.dataset.bulk === 'all' || button.dataset.bulk === 'cancel') return;
    button.disabled = count === 0;
  });
}

async function onBarClick(event) {
  const button = event.target.closest('[data-bulk]');
  if (!button || button.disabled) return;
  const action = button.dataset.bulk;

  if (action === 'cancel') {
    setSelecting(false);
    return;
  }
  if (action === 'all') {
    const all = visibleFiles().map((file) => file.id);
    const allPicked = all.length > 0 && all.every((id) => state.selected.includes(id));
    setState({ selected: allPicked ? [] : all });
    renderBar();
    return;
  }

  const ids = state.selected.slice();
  if (!ids.length) {
    toast('先选择文件', { type: 'info' });
    return;
  }

  if (action === 'fav' || action === 'unfav') {
    await runBatch(ids, { favorite: action === 'fav' }, action === 'fav' ? '已收藏' : '已取消收藏');
    return;
  }

  if (action === 'move') {
    const current = new Set(ids.map((id) => findFile(id)?.topic).filter(Boolean));
    const suggestion = current.size === 1 ? [...current][0] : '';
    const topic = window.prompt('移动到哪个主题？', suggestion);
    if (topic == null) return;
    const name = topic.trim();
    if (!name) {
      toast('主题名不能为空', { type: 'error' });
      return;
    }
    await runBatch(ids, { topic: name }, `已移动到「${name}」`);
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
    await runBatch(ids, { addTags: tags }, '标签已添加');
    return;
  }

  if (action === 'vault') {
    const unlocked = await ensureVaultUnlocked('批量移入隐私空间前，请先解锁');
    if (!unlocked) return;
    await runBatch(ids, { hidden: true }, '已移入隐私空间');
    return;
  }

  if (action === 'delete') {
    if (!window.confirm(`确定删除选中的 ${ids.length} 个文件？删除后无法恢复。`)) return;
    await runDelete(ids);
  }
}

function findFile(id) {
  return state.files.find((file) => file.id === id) || null;
}

async function runBatch(ids, patch, message) {
  setBusy(true);
  try {
    const result = await api.batchPatchFiles(ids, patch);
    await refreshAll();
    setSelecting(false);
    const skipped = result.skipped ? `，${result.skipped} 个已跳过` : '';
    toast(`${message}（${result.updated} 个${skipped}）`, { type: 'success' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    setBusy(false);
  }
}

async function runDelete(ids) {
  setBusy(true);
  try {
    const result = await api.batchDeleteFiles(ids);
    await refreshAll();
    setSelecting(false);
    const skipped = result.skipped ? `，${result.skipped} 个已跳过` : '';
    toast(`已删除 ${result.deleted} 个文件${skipped}`, { type: 'success' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    setBusy(false);
  }
}

function setBusy(value) {
  const element = bar();
  if (!element) return;
  element.classList.toggle('is-busy', value);
  element.querySelectorAll('button').forEach((button) => {
    button.disabled = value || (button.dataset.bulk !== 'all' && button.dataset.bulk !== 'cancel' && !state.selected.length);
  });
}
