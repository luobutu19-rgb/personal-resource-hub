import { toast } from './toast.js';
import { refreshAll, setState, state } from './store.js';
import { savePendingFiles } from './pending.js';

const MAX_FILES = 200;
const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.localized']);

function isUsable(name) {
  const lower = String(name || '').toLowerCase();
  return lower && !lower.startsWith('.') && !IGNORED_NAMES.has(lower);
}

function createProgress(label) {
  const element = document.createElement('div');
  element.className = 'upload-progress';
  element.innerHTML =
    '<p><span class="label"></span><span class="pct">0%</span></p><div class="bar"><i></i></div>';
  element.querySelector('.label').textContent = label;
  document.body.appendChild(element);

  const bar = element.querySelector('.bar i');
  const pct = element.querySelector('.pct');

  return {
    set(value) {
      const safe = Math.max(0, Math.min(100, value));
      bar.style.width = `${safe}%`;
      pct.textContent = `${safe}%`;
    },
    label(text) {
      element.querySelector('.label').textContent = text;
      bar.style.width = '100%';
      pct.textContent = '';
    },
    done() {
      element.remove();
    },
  };
}

async function keepOnPhone(items, reason) {
  const saved = await savePendingFiles(items);
  if (saved) {
    toast(`${reason}：${saved} 个文件已存到手机，电脑开机后自动同步`, {
      type: 'success',
      duration: 5600,
    });
  } else {
    toast('无法保存到手机，可能是存储空间不足或文件过大', { type: 'error', duration: 5200 });
  }
}

async function uploadFiles(items) {
  const limited = items.slice(0, MAX_FILES);
  if (items.length > MAX_FILES) {
    toast(`一次最多上传 ${MAX_FILES} 个文件，超出部分未上传`, { type: 'error', duration: 4500 });
  }

  if (!navigator.onLine || document.getElementById('offlineBanner')?.hidden === false) {
    await keepOnPhone(limited, '电脑未连接');
    return;
  }

  const form = new FormData();
  for (const item of limited) form.append('files', item.file, item.path);

  const progress = createProgress(`正在上传 ${limited.length} 个文件…`);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/files');
  xhr.timeout = 180000;
  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable) progress.set(Math.round((event.loaded / event.total) * 100));
  });

  xhr.addEventListener('load', async () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      progress.label('正在整理归类…');
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {}

      try {
        await refreshAll();
        setState({ topic: null, category: null, tag: null, favorite: false, q: '', loading: false });
        const search = document.getElementById('searchInput');
        if (search) search.value = '';

        const created = data.items || [];
        const topicCounts = {};
        for (const item of created) topicCounts[item.topic] = (topicCounts[item.topic] || 0) + 1;
        const detail = Object.entries(topicCounts)
          .map(([topic, count]) => `${topic} ${count}`)
          .join('、');

        let message = `已归类 ${created.length} 个文件${detail ? `（${detail}）` : ''}`;
        if (data.skippedDuplicates) message += `，跳过 ${data.skippedDuplicates} 个重复文件`;

        const autoClassify =
          state.settings?.hasApiKey && state.settings?.ai?.enabled && state.settings.ai.autoClassifyOnUpload;
        if (autoClassify) message += '，AI 正在自动分类';

        toast(message, { type: 'success', duration: 4500 });
        if (autoClassify) setTimeout(() => refreshAll().catch(() => {}), 10000);
      } catch (error) {
        toast(`上传成功，但刷新列表失败：${error.message}`, { type: 'error' });
      }
      progress.done();
      return;
    }

    progress.done();
    if (xhr.status >= 500) {
      await keepOnPhone(limited, '服务暂时不可用');
      return;
    }
    let message = `上传失败（${xhr.status}）`;
    try {
      const parsed = JSON.parse(xhr.responseText || '{}');
      if (parsed.error) message = parsed.error;
    } catch {}
    toast(message, { type: 'error', duration: 5000 });
  });

  xhr.addEventListener('error', async () => {
    progress.done();
    await keepOnPhone(limited, '上传中断');
  });

  xhr.addEventListener('timeout', async () => {
    progress.done();
    await keepOnPhone(limited, '上传超时');
  });

  xhr.send(form);
}

function readDirectory(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

async function walkEntry(entry, prefix, out) {
  if (!entry) return;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    if (isUsable(entry.name)) out.push({ file, path: prefix ? `${prefix}/${entry.name}` : entry.name });
    return;
  }
  if (entry.isDirectory) {
    const children = await readDirectory(entry.createReader());
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    for (const child of children) await walkEntry(child, nextPrefix, out);
  }
}

async function collectFromDataTransfer(transfer) {
  const entries = [];
  if (transfer.items && transfer.items.length) {
    for (const item of transfer.items) {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
  }

  if (entries.length) {
    const out = [];
    for (const entry of entries) await walkEntry(entry, '', out);
    return out;
  }

  return [...(transfer.files || [])]
    .filter((file) => isUsable(file.name))
    .map((file) => ({ file, path: file.name }));
}

export function initUpload() {
  const fileInput = document.getElementById('fileInput');
  const folderInput = document.getElementById('folderInput');
  const imageInput = document.getElementById('imageInput');
  const menu = document.getElementById('uploadMenu');
  const uploadButton = document.getElementById('uploadBtn');
  const fab = document.getElementById('fabUpload');
  const overlay = document.getElementById('dropOverlay');

  const pick = (kind) => {
    menu.hidden = true;
    const target = kind === 'folder' ? folderInput : kind === 'images' ? imageInput : fileInput;
    target.click();
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-upload]');
    if (trigger) {
      event.preventDefault();
      pick(trigger.dataset.upload);
      return;
    }
    if (!event.target.closest('.menu-wrap')) menu.hidden = true;
  });

  uploadButton.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  fab.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const items = [...fileInput.files]
      .filter((file) => isUsable(file.name))
      .map((file) => ({ file, path: file.name }));
    fileInput.value = '';
    if (items.length) uploadFiles(items);
  });

  imageInput.addEventListener('change', () => {
    const items = [...imageInput.files]
      .filter((file) => isUsable(file.name))
      .map((file) => ({ file, path: file.name }));
    imageInput.value = '';
    if (items.length) uploadFiles(items);
  });

  folderInput.addEventListener('change', () => {
    const items = [...folderInput.files]
      .filter((file) => isUsable(file.name))
      .map((file) => ({ file, path: file.webkitRelativePath || file.name }));
    folderInput.value = '';
    if (items.length) uploadFiles(items);
  });

  const hasFiles = (event) => [...((event.dataTransfer && event.dataTransfer.types) || [])].includes('Files');
  let dragDepth = 0;

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    overlay.hidden = false;
  });

  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.hidden = true;
  });

  window.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;

    try {
      const items = await collectFromDataTransfer(event.dataTransfer);
      if (!items.length) {
        toast('没有找到可上传的文件', { type: 'error' });
        return;
      }
      uploadFiles(items);
    } catch {
      toast('读取拖入的文件失败，请改用上传按钮', { type: 'error' });
    }
  });
}
