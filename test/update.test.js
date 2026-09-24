import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyVersion, compareVersions, parseVersion } from '../src/update.js';

test('parseVersion understands plain and pre-release versions', () => {
  assert.deepEqual(parseVersion('1.0.4'), { major: 1, minor: 0, patch: 4, pre: null });
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: null });
  assert.deepEqual(parseVersion('1.2.3-beta.4'), { major: 1, minor: 2, patch: 3, pre: 'beta.4' });
  assert.equal(parseVersion('oops'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
});

test('compareVersions orders releases and pre-releases like semver', () => {
  assert.equal(compareVersions('1.0.4', '1.0.4'), 0);
  assert.equal(compareVersions('1.0.3', '1.0.4'), -1);
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1); // numeric, not lexicographic
  assert.equal(compareVersions('1.1.0', '1.0.99'), 1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.4-beta.1', '1.0.4'), -1); // pre < release
  assert.equal(compareVersions('1.0.4', '1.0.4-beta.1'), 1);
  assert.equal(compareVersions('1.0.4-beta.1', '1.0.4-beta.2'), -1);
});

test('classifyVersion gates older, equal and newer locals', () => {
  assert.equal(classifyVersion('1.0.3', '1.0.4'), 'update-required');
  assert.equal(classifyVersion('1.0.4', '1.0.4'), 'ok');
  assert.equal(classifyVersion('1.0.5', '1.0.4'), 'beta');
  assert.equal(classifyVersion('2.0.0-beta.1', '1.9.9'), 'beta');
});

test('classifyVersion never gates without a backend answer', () => {
  assert.equal(classifyVersion('1.0.3', null), 'ok');
  assert.equal(classifyVersion('1.0.3', ''), 'ok');
  assert.equal(classifyVersion('1.0.3', 'garbage'), 'ok');
});
