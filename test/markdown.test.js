import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';

const { parseBlocks, renderMarkdown, renderMarkdownEx } = await import('../src/ui/markdown.js');
const { stripAnsi, visibleWidth } = await import('../src/util/ansi.js');

const plain = (rows) => rows.map(stripAnsi);

test('paragraphs wrap to the available width', () => {
  const rows = renderMarkdown('word '.repeat(30), { width: 40, indent: '  ' });
  assert.ok(rows.length > 1);
  for (const row of rows) assert.ok(visibleWidth(row) <= 40);
  for (const row of rows) assert.ok(row.startsWith('  '));
});

test('headings, lists and quotes are rendered structurally', () => {
  const source = ['# Title', '', '- first', '- second', '', '> quoted', '', '1. one', '2. two'].join('\n');
  const rows = plain(renderMarkdown(source, { width: 60 }));
  assert.ok(rows.some((row) => row.includes('▎ Title')));
  assert.ok(rows.some((row) => row.includes('• first')));
  assert.ok(rows.some((row) => row.includes('• second')));
  assert.ok(rows.some((row) => row.includes('▏ quoted')));
  assert.ok(rows.some((row) => row.includes('1. one')));
  assert.ok(rows.some((row) => row.includes('2. two')));
});

test('fenced code blocks render inside a box with the language tag', () => {
  const source = '```js\nconst x = 1;\n```';
  const rows = plain(renderMarkdown(source, { width: 40 }));
  assert.ok(rows[0].includes('js'));
  assert.ok(rows.some((row) => row.includes('const x = 1;')));
  assert.equal(rows.at(-1).trim().startsWith('╰'), true);
  for (const row of rows) assert.ok(visibleWidth(row) <= 40);
});

test('inline markdown is stripped to readable text', () => {
  const rows = plain(renderMarkdown('Use **bold**, *italic* and `code` with [docs](https://x.dev).', { width: 80 }));
  const joined = rows.join(' ');
  assert.ok(joined.includes('bold'));
  assert.ok(joined.includes('code'));
  assert.ok(joined.includes('docs'));
  assert.ok(!joined.includes('**'));
});

test('tables render with aligned separators', () => {
  const source = ['| Model | Price |', '| --- | --- |', '| a | 1 |', '| b | 2 |'].join('\n');
  const rows = plain(renderMarkdown(source, { width: 60 }));
  assert.ok(rows.some((row) => row.includes('Model') && row.includes('Price')));
  assert.ok(rows.some((row) => row.includes('─┼─')));
  assert.ok(rows.some((row) => row.includes('a') && row.includes('1')));
});

test('renderMarkdownEx reports stable lines for streaming', () => {
  const first = renderMarkdownEx('First paragraph.\n\nSecond block is still', { width: 60 });
  assert.equal(first.stableCount, 1);

  const growing = renderMarkdownEx('First paragraph.\n\nSecond block is still being written.', { width: 60 });
  assert.equal(growing.stableCount, 1);
  assert.equal(growing.lines[0], first.lines[0]);

  const closed = renderMarkdownEx('First paragraph.\n\nSecond block is done.\n\n', { width: 60 });
  assert.equal(closed.stableCount, closed.lines.length);
});

test('an unterminated fence is unstable until it closes', () => {
  const open = renderMarkdownEx('```js\nconst a = 1;\n', { width: 60 });
  assert.equal(open.stableCount, 0);
  const closed = renderMarkdownEx('```js\nconst a = 1;\n```', { width: 60 });
  assert.equal(closed.stableCount, closed.lines.length);
});

test('block spacing keeps the reply readable', () => {
  const rows = plain(renderMarkdown('# Title\n\npara\n\n- item\n\n> quote', { width: 60 }));
  assert.deepEqual(
    rows.map((row) => row.trim() === '' ? '' : row.trim()[0]),
    ['▎', 'p', '', '•', '', '▏'],
  );
});

test('replies never reuse the user gutter', () => {
  const source = '# Title\n\n> quote\n\n- item\n\n`code` and **bold**'; 
  for (const row of renderMarkdown(source, { width: 60, indent: '  ' })) {
    assert.ok(!stripAnsi(row).startsWith('  │'), row);
  }
});

test('parseBlocks recognises the main block kinds', () => {
  const blocks = parseBlocks('# h\n\ntext\n\n- a\n- b\n\n```py\nx\n```');
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['heading', 'paragraph', 'list', 'code'],
  );
});
