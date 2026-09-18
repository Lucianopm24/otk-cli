import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';
const dir = mkdtempSync(join(tmpdir(), 'otk-config-'));
process.env.OTK_CONFIG_DIR = dir;

const config = await import('../src/config.js');

test('authentication round-trips through ~/.otk/config.json', () => {
  assert.equal(config.loadAuth(), null);
  config.saveAuth({ token: 'otk_abc', expiresAt: Date.now() + 60_000, email: 'a@b.c' });
  const loaded = config.loadAuth();
  assert.equal(loaded.token, 'otk_abc');
  assert.equal(loaded.email, 'a@b.c');
  config.clearAuth();
  assert.equal(config.loadAuth(), null);
});

test('the config file is written with owner-only permissions', () => {
  config.saveAuth({ token: 'otk_secret', expiresAt: Date.now() + 60_000 });
  const raw = readFileSync(join(dir, 'config.json'), 'utf8');
  assert.ok(raw.includes('otk_secret'));
  if (process.platform !== 'win32') {
    const mode = statSync(join(dir, 'config.json')).mode & 0o777;
    assert.equal(mode, 0o600);
  }
  config.clearAuth();
});

test('malformed config files never crash the CLI', () => {
  writeFileSync(join(dir, 'config.json'), 'not json at all', 'utf8');
  assert.equal(config.loadAuth(), null);
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ nope: true }), 'utf8');
  assert.equal(config.loadAuth(), null);
  config.clearAuth();
});

test('expired tokens are reported one minute early', () => {
  const now = 1_000_000;
  assert.equal(config.tokenExpired({ token: 't', expiresAt: now + 61_000 }, now), false);
  assert.equal(config.tokenExpired({ token: 't', expiresAt: now + 30_000 }, now), true);
  assert.equal(config.tokenExpired({ token: 't', expiresAt: null }, now), false);
  assert.equal(config.tokenExpired(null, now), true);
});

test('preferences remember the last model', () => {
  config.savePrefs({ lastModel: 'agnes-3.0-flash' });
  assert.equal(config.loadPrefs().lastModel, 'agnes-3.0-flash');
  config.savePrefs({ email: 'x@y.z' });
  assert.equal(config.loadPrefs().lastModel, 'agnes-3.0-flash');
  assert.equal(config.loadPrefs().email, 'x@y.z');
});
