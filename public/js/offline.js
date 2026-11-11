import { api } from './api.js';

const DB_NAME = 'rh-offline';
const DB_VERSION = 2;
const STORE = 'kv';
const PENDING_STORE = 'pending';
const SNAPSHOT_KEY = 'snapshot';
const RECENT_KEY = 'rh.recent';
const AUTO_KEY = 'rh.autocache';
const AUTO_AT_KEY = 'rh.autocache.at';
const MEDIA_CACHE = 'rh-media-v1';
const MAX_RECENT = 30;
const MAX_PREFETCH_FILES = 20;
const MAX_PREFETCH_BYTES = 150 * 1024 * 1024;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const AUTO_MAX_FILES = 80;
const AUTO_BUDGET_BYTES = 120 * 1024 * 1024;
const AUTO_INTERVAL_MS = 20 * 60 * 1000;

const cachedIds = new Set();

function notifyCacheChanged() {
  window.dispatchEvent(new CustomEvent('rh:cache-changed'));
}

function mediaUrlOf(file) {
  if (!file) return '';
  if (file.kind === 'link') return file.coverPath ? api.coverUrl(file.id) : '';
  return api.rawUrl(file.id);
}

export function getCachedIds() {
  return cachedIds;
}

export function isCached(id) {
  return cachedIds.has(id);
}

export function isAutoCacheEnabled() {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoCacheEnabled(enabled) {
  try {
    localStorage.setItem(AUTO_KEY, enabled ? '1' : '0');
  } catch {
    // 隐私模式下忽略
  }
}

export async function scanCached(files) {
  if (!('caches' in window) || !Array.isArray(files) || !files.length) return cachedIds.size;
  let cache;
  try {
    cache = await caches.open(MEDIA_CACHE);
  } catch {
    return cachedIds.size;
  }

  const next = new Set();
  for (const file of files) {
    const url = mediaUrlOf(file);
    if (!url) continue;
    try {
      if (await cache.match(url)) next.add(file.id);
    } catch {
      // 单个文件检查失败不影响其他
    }
  }

  const changed =
    next.size !== cachedIds.size || [...next].some((id) => !cachedIds.has(id));
  if (changed) {
    cachedIds.clear();
    for (const id of next) cachedIds.add(id);
    notifyCacheChanged();
  }
  return cachedIds.size;
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持离线存储'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSnapshot(files, stats) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ files, stats, savedAt: Date.now() }, SNAPSHOT_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 离线存储不可用时不影响在线使用
  }
}

export async function loadSnapshot() {
  try {
    const db = await openDB();
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value && Array.isArray(value.files) ? value : null;
  } catch {
    return null;
  }
}

export async function addPendingItem(item) {
  try {
    const db = await openDB();
    const record = {
      ...item,
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: item.createdAt || new Date().toISOString(),
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, 'readwrite');
      tx.objectStore(PENDING_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}

export async function listPendingItems() {
  try {
    const db = await openDB();
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, 'readonly');
      const request = tx.objectStore(PENDING_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  } catch {
    return [];
  }
}

export async function deletePendingItem(id) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, 'readwrite');
      tx.objectStore(PENDING_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export function supportsOffline() {
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  return 'serviceWorker' in navigator && secure;
}

export function isOfflineReady() {
  return Boolean(navigator.serviceWorker?.controller);
}

export async function initOffline() {
  if (!supportsOffline()) return false;
  try {
    await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    return true;
  } catch {
    return false;
  }
}

export function getRecentIds() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function markViewed(id) {
  try {
    const list = getRecentIds().filter((item) => item !== id);
    list.unshift(id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // 忽略隐私模式下的存储失败
  }
}

export async function prefetchOffline(
  files,
  { includeAll = false, maxFiles = MAX_PREFETCH_FILES, budgetBytes = MAX_PREFETCH_BYTES } = {}
) {
  if (!('caches' in window) || !navigator.onLine) return 0;

  const recent = new Set(getRecentIds());
  const ordered = [];
  const seen = new Set();
  const push = (file) => {
    if (!file || seen.has(file.id)) return;
    seen.add(file.id);
    ordered.push(file);
  };

  const sorted = files
    .slice()
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  for (const file of sorted) if (file.favorite || recent.has(file.id)) push(file);
  if (includeAll) for (const file of sorted) push(file);

  if (!ordered.length) return 0;

  let cache;
  try {
    cache = await caches.open(MEDIA_CACHE);
  } catch {
    return 0;
  }

  let count = 0;
  let used = 0;
  const before = cachedIds.size;
  for (const file of ordered.slice(0, maxFiles)) {
    const url = mediaUrlOf(file);
    if (!url) continue;

    const size = Number(file.size) || 0;
    if (file.kind !== 'link' && size > MAX_FILE_BYTES) continue;

    try {
      const cached = await cache.match(url);
      if (cached) {
        cachedIds.add(file.id);
        continue;
      }
      if (budgetBytes && used + size > budgetBytes) continue;

      const response = await fetch(url);
      if (response.ok && response.status === 200) {
        await cache.put(url, response.clone());
        used += size;
        count += 1;
        cachedIds.add(file.id);
      }
    } catch {
      // 单个文件失败不影响其他缓存
    }
  }

  if (count || cachedIds.size !== before) notifyCacheChanged();
  return count;
}

export function shouldAutoCache() {
  if (!isAutoCacheEnabled() || !navigator.onLine || !('caches' in window)) return false;
  try {
    const last = Number(localStorage.getItem(AUTO_AT_KEY) || 0);
    return !last || Date.now() - last > AUTO_INTERVAL_MS;
  } catch {
    return true;
  }
}

export async function autoCache(files, { force = false } = {}) {
  if (!supportsOffline() || !navigator.onLine || !isAutoCacheEnabled()) return 0;
  if (!Array.isArray(files) || !files.length) return 0;

  if (!force && !shouldAutoCache()) {
    await scanCached(files);
    return 0;
  }

  const added = await prefetchOffline(files, {
    includeAll: true,
    maxFiles: AUTO_MAX_FILES,
    budgetBytes: AUTO_BUDGET_BYTES,
  });

  try {
    localStorage.setItem(AUTO_AT_KEY, String(Date.now()));
  } catch {
    // 忽略存储失败
  }
  return added;
}
