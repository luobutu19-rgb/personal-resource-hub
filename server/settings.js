import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.js';

const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  ai: {
    enabled: false,
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
    autoSummaryOnUpload: false,
    autoClassifyOnUpload: true,
  },
};

let cache = null;

function merge(base, patch) {
  const next = structuredClone(base);
  if (patch && typeof patch === 'object') {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'ai' && value && typeof value === 'object') {
        next.ai = { ...next.ai, ...value };
      } else if (value !== undefined) {
        next[key] = value;
      }
    }
  }
  return next;
}

export function getSettings() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    cache = merge(DEFAULTS, raw);
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  return cache;
}

export function updateSettings(patch) {
  const current = getSettings();
  const incoming = patch && typeof patch === 'object' ? patch : {};
  const aiPatch = incoming.ai && typeof incoming.ai === 'object' ? { ...incoming.ai } : null;

  if (aiPatch && 'apiKey' in aiPatch) {
    if (aiPatch.apiKey === null) aiPatch.apiKey = '';
    else if (String(aiPatch.apiKey).trim() === '') delete aiPatch.apiKey;
  }

  const next = merge(current, aiPatch ? { ...incoming, ai: aiPatch } : incoming);
  next.ai.baseURL = String(next.ai.baseURL || DEFAULTS.ai.baseURL).trim().replace(/\/+$/, '');
  next.ai.model = String(next.ai.model || DEFAULTS.ai.model).trim() || DEFAULTS.ai.model;
  next.ai.apiKey = String(next.ai.apiKey || '').trim();
  next.ai.enabled = Boolean(next.ai.enabled);
  next.ai.autoSummaryOnUpload = Boolean(next.ai.autoSummaryOnUpload);
  next.ai.autoClassifyOnUpload = Boolean(next.ai.autoClassifyOnUpload);

  cache = next;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function publicSettings() {
  const settings = getSettings();
  const key = settings.ai.apiKey;
  return {
    ai: { ...settings.ai, apiKey: key ? `••••${key.slice(-4)}` : '' },
    hasApiKey: Boolean(key),
  };
}
