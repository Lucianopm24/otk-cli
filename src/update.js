/**
 * Version gating against the backend. `GET /cli/general/version` returns the
 * latest CLI version as plain text (e.g. `1.0.4`). At startup the CLI asks:
 *
 *   local <  latest  ->  mandatory update: the user cannot continue until
 *                        `npm i -g opentokens-cli` ran successfully.
 *   local == latest  ->  normal use.
 *   local >  latest  ->  BETA: warn about possible errors and offer to
 *                        install the stable version instead.
 *
 * A network failure never blocks the CLI: without an answer from the backend
 * the user simply continues on their current version.
 */

import { spawn } from 'node:child_process';
import { API_BASE_URL } from './version.js';

const TIMEOUT_MS = 10_000;

/** Parse `1.2.3-beta.4` into comparable numbers: [major, minor, patch, pre]. */
export function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/i.exec(String(version ?? '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
  };
}

/**
 * Compare two version strings. Returns -1 when `a` is older, 0 when equal,
 * 1 when `a` is newer. Pre-release suffixes (1.0.4-beta.1) sort below the
 * release, matching semver.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.pre !== right.pre) {
    if (left.pre === null) return 1; // release > pre-release
    if (right.pre === null) return -1;
    return left.pre < right.pre ? -1 : 1;
  }
  return 0;
}

/**
 * Ask the backend for the latest CLI version. Returns a trimmed
 * `major.minor.patch` string, or null when the endpoint is unreachable,
 * slow, or returns something unexpected — the CLI then skips the gate.
 */
export async function fetchLatestVersion({ baseUrl = API_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), TIMEOUT_MS);
    if (timer.unref) timer.unref();
    const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/cli/general/version`, {
      method: 'GET',
      headers: { accept: 'text/plain' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return parseVersion(text) ? text.replace(/^v/i, '') : null;
  } catch {
    return null;
  }
}

/**
 * Outcome of the version gate:
 *   'update-required' — local is older; the user must update to continue.
 *   'beta'            — local is newer than the backend's stable.
 *   'ok'              — versions match (or the check could not run).
 */
export function classifyVersion(local, latest) {
  // An unusable answer (missing, garbage, non-version text) never gates.
  if (!latest || !parseVersion(latest) || !parseVersion(local)) return 'ok';
  const order = compareVersions(local, latest);
  if (order < 0) return 'update-required';
  if (order > 0) return 'beta';
  return 'ok';
}

/**
 * Run `npm i -g opentokens-cli` (or `@<version>` when one is given) in a
 * plain child process. Resolves true only when npm exits 0.
 */
export function installVersion(version = null, { onLine = null } = {}) {
  return new Promise((resolve) => {
    const spec = version ? `opentokens-cli@${version}` : 'opentokens-cli';
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    let child;
    try {
      child = spawn(npmCommand, ['i', '-g', spec], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
    } catch {
      resolve(false);
      return;
    }
    let failed = false;
    const forward = (stream) => {
      stream.setEncoding('utf8');
      let buffered = '';
      stream.on('data', (chunk) => {
        buffered += chunk;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const text of lines) {
          if (text.trim()) onLine?.(text.trim());
        }
      });
      stream.on('end', () => {
        if (buffered.trim()) onLine?.(buffered.trim());
      });
      stream.on('error', () => {
        failed = true;
      });
    };
    forward(child.stdout);
    forward(child.stderr);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(!failed && code === 0));
  });
}
