import { api } from './api.js';
import { state, getFile, setState, refreshAll } from './store.js';
import { icon, esc } from './render.js';
import { toast } from './toast.js';
import { hideFileFlow } from './vault.js';

const CATEGORIES = ['图片', '文档', '视频', '音频', '压缩包', '代码', '网页', '其他'];

let escapeHandler = null;

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
  root.querySelectorAll('[data-edit-close]').forEach((element) => {
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

export async function toggleFavorite(id) {
  const file = getFile(id);
  if (!file) return null;
  try {
    const updated = await api.patchFile(id, { favorite: !file.favorite });
    setState({ files: state.files.map((item) => (item.id === id ? updated : item)) });
    return Boolean(updated.favorite);
  } catch (error) {
    toast(error.message, { type: 'error' });
    return null;
  }
}

export function openEdit(id) {
  const file = getFile(id);
  if (!file) return;

  const topics = (state.stats?.topics || []).map((topic) => topic.name);
  const categoryOptions = CATEGORIES.map(
    (category) => `<option value="${category}" ${file.category === category ? 'selected' : ''}>${category}</option>`
  ).join('');

  const root = mountModal(`<div class="modal-backdrop">
    <div class="form-panel" role="dialog" aria-modal="true" aria-labelledby="editTitle">
      <div class="form-head">
        <h2 id="editTitle">编辑文件</h2>
        <button class="icon-btn" type="button" data-edit-close aria-label="关闭">${icon('close')}</button>
      </div>
      <form class="form-body" id="editForm">
        <label class="field">
          <span>标题</span>
          <input name="title" maxlength="120" value="${esc(file.title)}" required>
        </label>
        <div class="form-row">
          <label class="field">
            <span>主题</span>
            <input name="topic" list="topicOptions" maxlength="24" value="${esc(file.topic)}">
            <datalist id="topicOptions">${topics.map((topic) => `<option value="${esc(topic)}"></option>`).join('')}</datalist>
          </label>
          <label class="field">
            <span>类型</span>
            <select name="category">${categoryOptions}</select>
          </label>
        </div>
        <label class="field">
          <span>标签</span>
          <input name="tags" value="${esc((file.tags || []).join(', '))}" placeholder="用逗号分隔，如：笔记, 期末">
          <small>标签会显示在卡片上，也可以用来筛选。</small>
        </label>
        <label class="switch-row">
          <input type="checkbox" name="favorite" ${file.favorite ? 'checked' : ''}> 加入收藏
        </label>
        <div class="ai-hint">
          ${icon('sparkles')}
          <span>${
            file.kind === 'link'
              ? 'AI 会重新判断主题、类型与标签，并规范标题；原文链接保持不变。'
              : 'AI 会自动归入合适的主题文件夹，判断类型，并把文件重命名为规范标题；文件名和位置都会同步更新。'
          }</span>
        </div>
        ${
          file.kind === 'link'
            ? `<div class="edit-link-row" title="${esc(file.url || '')}">${icon('link')}<span class="edit-url">${esc(
                file.url || ''
              )}</span></div>`
            : ''
        }
        <div class="form-actions">
          <button class="btn danger-ghost" type="button" data-edit-delete>${icon('trash')}删除</button>
          <button class="btn ghost" type="button" data-edit-vault>${icon('lock')}隐藏</button>
          ${
            file.kind === 'link'
              ? `<a class="btn ghost" href="${esc(file.url || '#')}" target="_blank" rel="noopener noreferrer">${icon(
                  'arrow-right'
                )}打开原文</a>`
              : `<a class="btn ghost" href="${api.downloadUrl(file.id)}" download>${icon('download')}下载</a>`
          }
          <span class="spacer"></span>
          <button class="btn ghost ai-glow" type="button" data-edit-ai>${icon('sparkles')}AI 整理</button>
          <button class="btn primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  </div>`);

  const form = root.querySelector('#editForm');
  const submitButton = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const patch = {
      title: String(data.get('title') || '').trim(),
      topic: String(data.get('topic') || '').trim(),
      category: String(data.get('category') || ''),
      tags: String(data.get('tags') || ''),
      favorite: form.elements.favorite.checked,
    };

    if (!patch.title) {
      toast('标题不能为空', { type: 'error' });
      return;
    }
    if (!patch.topic) {
      toast('主题不能为空', { type: 'error' });
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = '保存中…';
    try {
      await api.patchFile(file.id, patch);
      closeModal();
      await refreshAll();
      toast('已保存修改', { type: 'success' });
    } catch (error) {
      toast(error.message, { type: 'error', duration: 4500 });
      submitButton.disabled = false;
      submitButton.textContent = '保存';
    }
  });

  form.querySelector('[data-edit-delete]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const confirmed = window.confirm(`删除「${file.title}」？文件会从磁盘移除，无法恢复。`);
    if (!confirmed) return;
    button.disabled = true;
    try {
      await api.deleteFile(file.id);
      closeModal();
      await refreshAll();
      toast('文件已删除', { type: 'success' });
    } catch (error) {
      toast(error.message, { type: 'error' });
      button.disabled = false;
    }
  });

  form.querySelector('[data-edit-vault]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const hidden = await hideFileFlow(file.id, file.title);
    button.disabled = false;
    if (hidden) {
      closeModal();
      await refreshAll();
    }
  });

  form.querySelector('[data-edit-ai]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${icon('sparkles')}整理中…`;

    try {
      const result = await api.organizeFile(file.id);
      closeModal();
      await refreshAll();
      toast(
        result.item.kind === 'link'
          ? `已归入「${result.item.topic}」`
          : `已归入「${result.item.topic}」，文件名：${result.item.storedName}`,
        { type: 'success', duration: 5200 }
      );
    } catch (error) {
      toast(error.message, { type: 'error', duration: 4800 });
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  });
}

export function openTopicManager() {
  const topics = state.stats?.topics || [];
  if (!topics.length) {
    toast('还没有主题，上传文件后会自动生成', { type: 'info' });
    return;
  }

  const root = mountModal(`<div class="modal-backdrop">
    <div class="form-panel" role="dialog" aria-modal="true" aria-labelledby="topicTitle">
      <div class="form-head">
        <h2 id="topicTitle">重命名主题</h2>
        <button class="icon-btn" type="button" data-edit-close aria-label="关闭">${icon('close')}</button>
      </div>
      <div class="form-body">
        <p class="settings-note">改名后，该主题下的文件会移动到新的主题文件夹。</p>
        <div class="topic-list">
          ${topics
            .map(
              (topic) => `<div class="topic-list-row">
                <input type="text" value="${esc(topic.name)}" maxlength="24" aria-label="主题名称">
                <span class="count">${topic.count}</span>
                <button class="btn ghost" type="button" data-topic-rename="${esc(topic.name)}">重命名</button>
              </div>`
            )
            .join('')}
        </div>
      </div>
    </div>
  </div>`);

  root.querySelectorAll('[data-topic-rename]').forEach((button) => {
    button.addEventListener('click', async () => {
      const from = button.dataset.topicRename;
      const row = button.closest('.topic-list-row');
      const input = row.querySelector('input');
      const to = input.value.trim();

      if (!to) {
        toast('主题名不能为空', { type: 'error' });
        return;
      }
      if (to === from) {
        toast('主题名没有变化', { type: 'info' });
        return;
      }

      button.disabled = true;
      button.textContent = '处理中…';
      try {
        const result = await api.renameTopic(from, to);
        await refreshAll();
        if (state.topic === from) setState({ topic: to });
        toast(`已重命名 ${result.updated} 个文件`, { type: 'success' });
        openTopicManager();
      } catch (error) {
        toast(error.message, { type: 'error', duration: 4500 });
        button.disabled = false;
        button.textContent = '重命名';
      }
    });
  });
}
