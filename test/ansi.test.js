import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';

const {
  center,
  padEnd,
  padStart,
  stripAnsi,
  truncateStyled,
  visibleWidth,
  wrapPlain,
  wrapStyled,
} = await import('../src/util/ansi.js');

test('visibleWidth ignores ANSI codes and counts wide characters', () => {
  assert.equal(visibleWidth('\u001b[32mhello\u001b[0m'), 5);
  assert.equal(visibleWidth('日本語'), 6);
  assert.equal(visibleWidth('a\u0301b'), 2);
});

test('wrapStyled never exceeds the width and keeps every word', () => {
  const rows = wrapStyled('the quick brown fox jumps over the lazy dog', 10);
  for (const row of rows) assert.ok(visibleWidth(row) <= 10, row);
  assert.equal(rows.map(stripAnsi).join(' '), 'the quick brown fox jumps over the lazy dog');
});

test('wrapStyled hard-breaks words that are longer than the width', () => {
  const rows = wrapStyled('https://example.com/very/long/path', 8);
  for (const row of rows) assert.ok(visibleWidth(row) <= 8, row);
  assert.equal(rows.map(stripAnsi).join(''), 'https://example.com/very/long/path');
});

test('wrapStyled keeps colour open across a line break', () => {
  const rows = wrapStyled('\u001b[32malpha beta gamma\u001b[0m', 6);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.ok(row.startsWith('\u001b[32m'), JSON.stringify(row));
});

test('wrapPlain tracks row start offsets for the caret', () => {
  const rows = wrapPlain('hello world again', 6, true);
  assert.deepEqual(
    rows.map((row) => row.text),
    ['hello', 'world', 'again'],
  );
  assert.deepEqual(
    rows.map((row) => row.start),
    [0, 6, 12],
  );
});

test('truncateStyled cuts on visible width and keeps styles closed', () => {
  const cut = truncateStyled('\u001b[32mabcdefgh\u001b[0m', 5);
  assert.equal(visibleWidth(cut), 5);
  assert.ok(stripAnsi(cut).endsWith('…'));
});

test('padding and centering are ANSI aware', () => {
  assert.equal(visibleWidth(padEnd('\u001b[32mab\u001b[0m', 6)), 6);
  assert.equal(visibleWidth(padStart('ab', 6)), 6);
  assert.equal(visibleWidth(center('ab', 7)), 7);
});
