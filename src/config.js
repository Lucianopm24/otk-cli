/**
 * Session persistence: `~/.otk/config.json` keeps the CLI token (owner-only
 * permissions) and `~/.otk/prefs.json` keeps UI preferences such as the last
 * model the user picked. The user never copies a token by hand.
 */

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR =
  process.env.OTK_CONFIG_DIR || join(homedir(), '.otk');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const PREFS_PATH = join(CONFIG_DIR, 'prefs.json');

/** Consider a token expired slightly early to avoid races. */
export const EXPIRY_SKEW_MS = 60_000;

function ensureDir() {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(CONFIG_DIR, 0o700);
  } catch {
    /* Windows and some filesystems do not support chmod */
  }
}

function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(path, data, mode = 0o600) {
  ensureDir();
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { mode });
  try {
    chmodSync(path, mode);
  } catch {
    /* ignore */
  }
}

/** @returns {{ token: string, expiresAt: number|null, email: string|null }|null} */
export function loadAuth() {
  const data = readJson(CONFIG_PATH);
  if (!data || typeof data.token !== 'string' || data.token.length === 0) return null;
  return {
    token: data.token,
    expiresAt: Number.isFinite(Number(data.expiresAt)) ? Number(data.expiresAt) : null,
    email: typeof data.email === 'string' ? data.email : null,
  };
}

export function saveAuth({ token, expiresAt = null, email = null }) {
  const previous = loadAuth();
  writeJson(CONFIG_PATH, {
    token,
    expiresAt,
    email: email ?? previous?.email ?? null,
    savedAt: Date.now(),
  });
}

export function clearAuth() {
  try {
    rmSync(CONFIG_PATH, { force: true });
  } catch {
    /* ignore */
  }
}

export function tokenExpired(auth, now = Date.now()) {
  if (!auth || !auth.token) return true;
  if (!auth.expiresAt) return false;
  return now + EXPIRY_SKEW_MS >= auth.expiresAt;
}

export function loadPrefs() {
  const data = readJson(PREFS_PATH);
  return {
    lastModel: typeof data?.lastModel === 'string' ? data.lastModel : null,
    email: typeof data?.email === 'string' ? data.email : null,
  };
}

export function savePrefs(patch) {
  const current = loadPrefs();
  writeJson(PREFS_PATH, { ...current, ...patch });
}

export function configPath() {
  return CONFIG_PATH;
}
