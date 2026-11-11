const JSON_HEADERS = { 'Content-Type': 'application/json' };

const VAULT_TOKEN_KEY = 'rh.vaultToken';
let vaultToken = '';
try {
  vaultToken = sessionStorage.getItem(VAULT_TOKEN_KEY) || '';
} catch {}

export function setVaultToken(token) {
  vaultToken = String(token || '');
  try {
    if (vaultToken) sessionStorage.setItem(VAULT_TOKEN_KEY, vaultToken);
    else sessionStorage.removeItem(VAULT_TOKEN_KEY);
  } catch {}
}

export function getVaultToken() {
  return vaultToken;
}

async function request(url, { timeout = 12000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = { ...(options.headers || {}) };
  if (vaultToken) headers['x-vault-token'] = vaultToken;
  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      const message =
        (payload && payload.error) ||
        (typeof payload === 'string' && payload.trim()) ||
        `请求失败（${response.status}）`;
      throw new Error(message);
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请检查网络连接');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, value === true ? '1' : value);
  }
  return search.toString();
}

export const api = {
  files(params = {}) {
    const qs = toQuery(params);
    return request(`/api/files${qs ? `?${qs}` : ''}`);
  },
  stats: () => request('/api/stats'),
  serverInfo: () => request('/api/server-info'),
  rules: () => request('/api/rules'),
  settings: () => request('/api/settings'),
  saveSettings: (patch) =>
    request('/api/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) }),
  testAI: () => request('/api/settings/ai/test', { method: 'POST', timeout: 40000 }),
  patchFile: (id, patch) =>
    request(`/api/files/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    }),
  deleteFile: (id) => request(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  batchPatchFiles: (ids, patch) =>
    request('/api/files/batch', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ids, patch }),
    }),
  batchDeleteFiles: (ids) =>
    request('/api/files/batch-delete', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ids }),
    }),
  renameTopic: (from, to) =>
    request('/api/topics/rename', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ from, to }) }),
  aiSummary: (id) =>
    request(`/api/files/${encodeURIComponent(id)}/ai/summary`, { method: 'POST', timeout: 120000 }),
  aiSuggest: (id) =>
    request(`/api/files/${encodeURIComponent(id)}/ai/suggest`, { method: 'POST', timeout: 120000 }),
  organizeFile: (id) =>
    request(`/api/files/${encodeURIComponent(id)}/ai/organize`, { method: 'POST', timeout: 120000 }),
  classifyUnfiled: () => request('/api/ai/classify-unfiled', { method: 'POST', timeout: 180000 }),
  aiSearch: (query) =>
    request('/api/ai/search', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ query }),
      timeout: 90000,
    }),
  topicSummary: (topic) =>
    request('/api/topics/summary', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ topic }),
      timeout: 90000,
    }),
  collectLink: (payload) =>
    request('/api/collect', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      timeout: 300000,
    }),
  collectPing: () => request('/api/collect/ping'),
  searchIndex: () => request('/api/search/index'),
  vaultStatus: () => request('/api/vault'),
  vaultUnlock: (password) =>
    request('/api/vault/unlock', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ password }) }),
  vaultLock: () => request('/api/vault/lock', { method: 'POST' }),
  vaultSetPassword: (current, next) =>
    request('/api/vault/password', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ current, next }),
    }),
  coverUrl: (id) => `/api/files/${encodeURIComponent(id)}/cover`,
  rawUrl: (id) => `/api/files/${encodeURIComponent(id)}/raw`,
  downloadUrl: (id) => `/api/files/${encodeURIComponent(id)}/download`,
};
