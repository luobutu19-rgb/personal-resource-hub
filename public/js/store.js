import { api } from './api.js';
import { saveSnapshot, autoCache } from './offline.js';

const VIEW_KEY = 'rh.view';
const LAYOUT_KEY = 'rh.layout';

export const state = {
  files: [],
  stats: null,
  settings: null,
  rules: null,
  loading: true,
  view: localStorage.getItem(VIEW_KEY) === 'category' ? 'category' : 'topic',
  topic: null,
  category: null,
  tag: null,
  favorite: false,
  q: '',
  sort: 'newest',
  layout: localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid',
  selecting: false,
  selected: [],
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener();
}

export function setView(view) {
  localStorage.setItem(VIEW_KEY, view);
  setState({ view });
}

export function setLayout(layout) {
  localStorage.setItem(LAYOUT_KEY, layout);
  setState({ layout });
}

export function getFile(id) {
  return state.files.find((file) => file.id === id) || null;
}

export function hasFilters() {
  return Boolean(state.topic || state.category || state.tag || state.favorite || state.q.trim());
}

export function visibleFiles() {
  const query = state.q.trim().toLowerCase();
  let files = state.files.slice();

  if (state.topic) files = files.filter((file) => file.topic === state.topic);
  if (state.category) files = files.filter((file) => file.category === state.category);
  if (state.tag) files = files.filter((file) => (file.tags || []).includes(state.tag));
  if (state.favorite) files = files.filter((file) => file.favorite);
  if (query) {
    files = files.filter((file) =>
      [file.title, file.originalName, file.summary, file.topic, file.url, file.platform, ...(file.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }

  const sorters = {
    newest: (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
    name: (a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN'),
    size: (a, b) => (b.size || 0) - (a.size || 0),
  };
  return files.sort(sorters[state.sort] || sorters.newest);
}

export function topicSummary() {
  const map = new Map();
  for (const file of state.files) {
    const entry = map.get(file.topic) || {
      name: file.topic,
      count: 0,
      size: 0,
      lastAt: 0,
      mix: {},
    };
    entry.count += 1;
    entry.size += file.size || 0;
    entry.lastAt = Math.max(entry.lastAt, Date.parse(file.createdAt) || 0);
    entry.mix[file.category] = (entry.mix[file.category] || 0) + 1;
    map.set(file.topic, entry);
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt || b.count - a.count);
}

export async function refreshAll() {
  const [filesResult, stats] = await Promise.all([api.files(), api.stats()]);
  const files = filesResult.items || [];
  setState({ files, stats, loading: false });
  saveSnapshot(files, stats);
  autoCache(files, { force: true }).catch(() => {});
}

export async function boot() {
  try {
    const [filesResult, stats, settings, rules] = await Promise.all([
      api.files(),
      api.stats(),
      api.settings(),
      api.rules(),
    ]);
    setState({ files: filesResult.items || [], stats, settings, rules, loading: false });
    saveSnapshot(filesResult.items || [], stats);
  } catch (error) {
    setState({ loading: false });
    throw error;
  }
}
