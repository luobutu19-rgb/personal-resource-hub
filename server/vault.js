import crypto from 'node:crypto';
import { getSettings, updateSettings } from './settings.js';
import { allFiles } from './store.js';

const TOKEN_TTL = 4 * 60 * 60 * 1000; // 解锁后 4 小时内免密
const tokens = new Map(); // token -> expiresAt

function hashPassword(salt, password) {
  return crypto.scryptSync(String(password), String(salt), 32).toString('hex');
}

function privacyState() {
  const privacy = getSettings().privacy;
  return privacy && privacy.salt && privacy.hash ? privacy : null;
}

function cleanExpired() {
  const now = Date.now();
  for (const [token, expiry] of tokens) {
    if (expiry <= now) tokens.delete(token);
  }
}

function tokenFromRequest(req) {
  return String(req.get('x-vault-token') || req.query?.token || '').trim();
}

export function isRequestUnlocked(req) {
  const token = tokenFromRequest(req);
  if (!token || !tokens.has(token)) return false;
  if (tokens.get(token) <= Date.now()) {
    tokens.delete(token);
    return false;
  }
  return true;
}

export function vaultStatus(req) {
  const hasPassword = Boolean(privacyState());
  const unlocked = isRequestUnlocked(req);
  const hiddenCount = allFiles().filter((f) => f.hidden).length;
  return { hasPassword, unlocked, hiddenCount };
}

export function unlockVault(password) {
  const privacy = privacyState();
  if (!privacy) {
    const error = new Error('请先设置隐私空间密码');
    error.status = 400;
    throw error;
  }
  const candidate = hashPassword(privacy.salt, password);
  const ok =
    candidate.length === privacy.hash.length &&
    crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(privacy.hash));
  if (!ok) {
    const error = new Error('密码不正确');
    error.status = 401;
    throw error;
  }
  cleanExpired();
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL);
  return { token, expiresAt: tokens.get(token) };
}

export function lockVault(req) {
  const token = tokenFromRequest(req);
  if (token) tokens.delete(token);
  return { ok: true };
}

export function setVaultPassword({ current, next }) {
  const password = String(next || '').trim();
  if (password.length < 4) {
    const error = new Error('密码至少 4 位');
    error.status = 400;
    throw error;
  }
  const privacy = privacyState();
  if (privacy) {
    const candidate = hashPassword(privacy.salt, current);
    const ok =
      candidate.length === privacy.hash.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(privacy.hash));
    if (!ok) {
      const error = new Error('当前密码不正确');
      error.status = 401;
      throw error;
    }
  }
  const salt = crypto.randomBytes(16).toString('hex');
  updateSettings({ privacy: { salt, hash: hashPassword(salt, password) } });
  tokens.clear(); // 换密码后所有已解锁会话失效
  return { ok: true };
}

export function hiddenCount() {
  return allFiles().filter((f) => f.hidden).length;
}
