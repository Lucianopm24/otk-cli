/**
 * Semantic version, read from package.json so the banner, `--version` and
 * `/version` can never drift apart.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FALLBACK = '1.0.4';

function readVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed.version === 'string' ? parsed.version : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export const VERSION = readVersion();
export const APP_NAME = 'OTK CLI';
export const BIN_NAME = 'otk-cli';
export const ASSISTANT_NAME = 'Toeky';
export const PRODUCT_NAME = 'OpenTokens';
export const WEB_BASE_URL =
  process.env.OTK_WEB_BASE_URL || 'https://opentokens.is-so.pro';
export const API_BASE_URL =
  process.env.OTK_API_BASE || 'https://adept-retriever-631.convex.site';
