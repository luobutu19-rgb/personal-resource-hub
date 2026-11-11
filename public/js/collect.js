import { api } from './api.js';
import { refreshAll, setState } from './store.js';
import { savePendingLink } from './pending.js';
import { icon } from './render.js';
import { toast } from './toast.js';

let escapeHandler = null;

function closeCollect() {
  document.getElementById('modalRoot').innerHTML = '';
  document.body.classList.remove('modal-open');
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  }
}

export function openCollect() {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop">
    <div class="form-panel collect-panel" role="dialog" aria-modal="true" aria-labelledby="collectTitle">
      <div class="form-head">
        <h2 id="collectTitle">收藏链接</h2>
        <button class="icon-btn" type="button" data-collect-close aria-label="关闭">${icon('close')}</button>
      </div>
      <form class="form-body" id="collectForm">
        <label class="field">
          <span>链接或分享文字</span>
          <textarea name="text" rows="3" placeholder="粘贴链接，或直接粘贴小红书 / B站 / 微信 / Instagram 的分享文字" required></textarea>
          <small>会自动识别其中的链接，抓取标题、简介和封面；粘贴 MP3 / 音频直链会把文件下载进资料库，可直接播放。</small>
        </label>
        <label class="field">
          <span>备注（可选）</span>
          <input name="note" maxlength="200" placeholder="为什么收藏它，例如：期末复习用">
        </label>
        <div class="form-actions">
          <span class="spacer"></span>
          <button class="btn ghost" type="button" data-collect-close>取消</button>
          <button class="btn primary" type="submit">收藏</button>
        </div>
        <p class="settings-note">支持哔哩哔哩、小红书、微信公众号文章、Instagram。手机端可配合 iOS 快捷指令一键收藏，配置方法见设置页。</p>
      </form>
    </div>
  </div>`;

  document.body.classList.add('modal-open');
  const form = root.querySelector('#collectForm');
  const textarea = form.elements.text;

  root.querySelectorAll('[data-collect-close]').forEach((element) => {
    element.addEventListener('click', closeCollect);
  });
  root.querySelector('.modal-backdrop').addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-backdrop')) closeCollect();
  });

  escapeHandler = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeCollect();
    }
  };
  document.addEventListener('keydown', escapeHandler);
  setTimeout(() => textarea.focus(), 40);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    const note = String(form.elements.note.value || '').trim();
    if (!text) {
      toast('先粘贴链接或分享文字', { type: 'error' });
      textarea.focus();
      return;
    }

    const offlineMode = !navigator.onLine || document.getElementById('offlineBanner')?.hidden === false;
    if (offlineMode) {
      const saved = await savePendingLink({ text, note });
      if (saved) {
        closeCollect();
        toast('电脑未连接，已存到手机；开机后会自动同步', { type: 'success', duration: 5200 });
        return;
      }
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '处理中…';

    try {
      const result = await api.collectLink({ text, note });
      closeCollect();
      await refreshAll();
      setState({ topic: null, category: null, tag: null, favorite: false, q: '' });
      const search = document.getElementById('searchInput');
      if (search) search.value = '';

      if (result.duplicate) {
        toast(`已经收藏过了：${result.item.title}`, { type: 'info', duration: 4200 });
      } else if (result.media) {
        toast(`已下载到资料库：${result.item.title}`, { type: 'success', duration: 4200 });
      } else {
        toast(`已收藏「${result.item.title}」`, { type: 'success', duration: 4200 });
      }
    } catch (error) {
      const networkIssue =
        !navigator.onLine || /超时|Failed to fetch|Load failed|NetworkError|网络连接/.test(error.message);
      if (networkIssue) {
        const saved = await savePendingLink({ text, note });
        if (saved) {
          closeCollect();
          toast('电脑未连接，已存到手机；开机后会自动同步', { type: 'success', duration: 5200 });
          return;
        }
      }
      toast(error.message, { type: 'error', duration: 5200 });
      button.disabled = false;
      button.textContent = '收藏';
    }
  });
}

export function initCollect() {
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-collect]')) return;
    event.preventDefault();
    const menu = document.getElementById('uploadMenu');
    if (menu) menu.hidden = true;
    openCollect();
  });
}
