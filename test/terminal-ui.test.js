import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';

const { visibleWidth, stripAnsi } = await import('../src/util/ansi.js');
const { BoxedPrompt } = await import('../src/ui/prompt.js');
const { LiveMarkdown } = await import('../src/ui/live.js');
const { renderSelectorFrame } = await import('../src/ui/select.js');
const { modelDetailCard, chatModelCard } = await import('../src/screens/modelCards.js');

/**
 * Tiny terminal emulator: applies cursor moves and erases so tests can assert
 * what the user would actually see after all the repainting.
 */
function screenFrom(output) {
  const buffer = [''];
  let row = 0;
  let col = 0;
  const ensure = (target) => {
    while (buffer.length <= target) buffer.push('');
  };
  let i = 0;
  while (i < output.length) {
    const ch = output[i];
    if (ch === '\u001b') {
      const match = /^\u001b\[([0-9;?]*)([A-Za-z])/.exec(output.slice(i));
      if (match) {
        const params = match[1];
        const command = match[2];
        const amount = Number(params) || 1;
        if (command === 'A') row = Math.max(0, row - amount);
        else if (command === 'B') row += amount;
        else if (command === 'C') col += amount;
        else if (command === 'D') col = Math.max(0, col - amount);
        else if (command === 'J') {
          if (params === '2') {
            buffer.length = 0;
            buffer.push('');
            row = 0;
            col = 0;
          } else {
            ensure(row);
            buffer[row] = buffer[row].slice(0, col);
            buffer.length = row + 1;
          }
        } else if (command === 'K' && params === '2') {
          ensure(row);
          buffer[row] = '';
          col = 0;
        }
        i += match[0].length;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row += 1;
      col = 0;
      ensure(row);
      i += 1;
      continue;
    }
    if (ch === '\r') {
      col = 0;
      i += 1;
      continue;
    }
    ensure(row);
    const line = buffer[row];
    buffer[row] = line.padEnd(col, ' ').slice(0, col) + ch + line.slice(col + 1);
    col += 1;
    i += 1;
  }
  return { rows: buffer.map(stripAnsi), row, col };
}

/** Capture stdout while pretending to be a TTY of a fixed size. */
function captureTty({ columns = 80, rows = 24 } = {}, run) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const chunks = [];
  const restore = [];
  const define = (key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, key);
    restore.push(() => {
      if (descriptor) Object.defineProperty(process.stdout, key, descriptor);
      else delete process.stdout[key];
    });
    Object.defineProperty(process.stdout, key, { value, configurable: true });
  };
  define('isTTY', true);
  define('columns', columns);
  define('rows', rows);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    run(chunks);
  } finally {
    process.stdout.write = originalWrite;
    for (const undo of restore) undo();
  }
  return chunks.join('');
}

test('the composer draws a framed input box with the status footer', () => {
  const prompt = new BoxedPrompt({
    placeholder: 'Ask Toeky anything…',
    status: () => '◉ Agnes 3.0 Flash',
  });
  prompt.state.text = 'hello world';
  prompt.state.cursor = prompt.state.text.length;
  const output = captureTty({ columns: 80, rows: 24 }, () => prompt.draw());
  const rows = output.split('\n').filter((row) => row.length > 0);
  const boxRows = rows.filter((row) => /[╭│╰]/.test(row));
  assert.ok(boxRows.length >= 4);
  const widths = new Set(boxRows.map((row) => visibleWidth(row)));
  assert.equal(widths.size, 1, 'every composer row shares one width');
  assert.ok(rows.some((row) => stripAnsi(row).includes('Ask Toeky') === false));
  assert.ok(rows.some((row) => stripAnsi(row).includes('hello world')));
  assert.ok(rows.some((row) => stripAnsi(row).includes('Agnes 3.0 Flash')));
  assert.ok(output.includes('\u001b['), 'the caret is repositioned with ANSI moves');
});

test('the composer grows with its content and keeps a fixed frame', () => {
  const prompt = new BoxedPrompt({ status: () => 'model' });
  prompt.state.text = 'a'.repeat(200);
  prompt.state.cursor = prompt.state.text.length;
  const output = captureTty({ columns: 60, rows: 24 }, () => prompt.draw());
  const rows = output.split('\n').filter((row) => /[╭│╰]/.test(row));
  assert.ok(rows.length >= 4);
  for (const row of rows) assert.ok(visibleWidth(row) <= 60, row);
});

test('the status line is present on every drawn row set', () => {
  const prompt = new BoxedPrompt({ status: () => 'Free' });
  const first = captureTty({ columns: 60, rows: 24 }, () => prompt.draw());
  prompt.state.text = 'typing';
  prompt.state.cursor = 6;
  const second = captureTty({ columns: 60, rows: 24 }, () => prompt.draw());
  for (const output of [first, second]) {
    assert.ok(output.split('\n').some((row) => stripAnsi(row).includes('Free')));
  }
});

const MODELS = [
  {
    id: 'agnes-3.0-flash',
    inputPricePerMTok: 0.05,
    outputPricePerMTok: 0.15,
    free: false,
    usesSessions: false,
    note: null,
    warning: null,
  },
  {
    id: 'stealth/union-alpha',
    inputPricePerMTok: 0,
    outputPricePerMTok: 0,
    free: true,
    usesSessions: true,
    note: null,
    warning: 'Union Alpha is temporary and prompts may be retained for research.',
  },
];

test('model cards and the selector frame stay inside the terminal width', () => {
  const detail = modelDetailCard(MODELS[1], { width: 58 });
  for (const row of detail) assert.ok(visibleWidth(row) <= 60, row);
  assert.ok(detail.some((row) => stripAnsi(row).includes('Union Alpha')));
  assert.ok(detail.some((row) => stripAnsi(row).includes('Daily sessions')));
  const detailText = detail.map(stripAnsi).join(' ');
  assert.ok(detailText.includes('retained'));
  assert.ok(detailText.includes('research'));
  assert.ok(detail.some((row) => stripAnsi(row).includes('$0.00') === false));

  const compact = chatModelCard(MODELS[0]);
  assert.ok(compact.some((row) => stripAnsi(row).includes('Agnes 3.0 Flash')));
  assert.ok(compact.some((row) => stripAnsi(row).includes('$0.05 / $0.15 per 1M')));

  const frame = renderSelectorFrame(MODELS, { index: 0, currentId: null, height: 30 });
  for (const row of frame) assert.ok(visibleWidth(row) <= 80, row);
  assert.ok(frame.some((row) => stripAnsi(row).includes('Choose a model')));
});

test('the live renderer prints every line exactly once on screen', () => {
  const live = new LiveMarkdown({ indent: '  ' });
  const chunks = [
    'Hello',
    'Hello there',
    'Hello there friend.\n\nSecond paragraph',
    'Hello there friend.\n\nSecond paragraph done.',
  ];
  const output = captureTty({ columns: 60, rows: 24 }, () => {
    for (const chunk of chunks) live.update(chunk);
    live.finish();
  });
  const { rows } = screenFrom(output);
  const screen = rows.join('\n');
  assert.equal(screen.split('Hello there friend.').length - 1, 1);
  assert.equal(screen.split('Second paragraph done.').length - 1, 1);
  assert.equal(screen.split('Second paragraph').length - 1, 1);
});

test('a streamed code fence never duplicates on screen', () => {
  const live = new LiveMarkdown({ indent: '  ' });
  const output = captureTty({ columns: 60, rows: 24 }, () => {
    live.update('Look:\n\n```js\nconst a = 1;');
    live.update('Look:\n\n```js\nconst a = 1;\nconst b = 2;');
    live.update('Look:\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nThat is all.');
    live.finish();
  });
  const { rows } = screenFrom(output);
  const screen = rows.join('\n');
  assert.equal(screen.split('const a = 1;').length - 1, 1);
  assert.equal(screen.split('const b = 2;').length - 1, 1);
  assert.equal(screen.split('That is all.').length - 1, 1);
  assert.equal(screen.split('Look:').length - 1, 1);
});

test('the composer repaints without leaving a second box behind', () => {
  const prompt = new BoxedPrompt({ status: () => 'model' });
  const output = captureTty({ columns: 60, rows: 24 }, () => {
    prompt.draw();
    prompt.state.text = 'typing here';
    prompt.state.cursor = prompt.state.text.length;
    prompt.draw();
    prompt.state.text = 'typing here and more';
    prompt.state.cursor = prompt.state.text.length;
    prompt.draw();
  });
  const { rows, row, col } = screenFrom(output);
  assert.equal(rows.filter((entry) => entry.includes('╭')).length, 1);
  assert.equal(rows.filter((entry) => entry.includes('╰')).length, 1);
  assert.ok(rows.some((entry) => entry.includes('typing here and more')));
  assert.equal(rows.join('\n').split('typing here and more').length - 1, 1);

  const inputRow = rows.findIndex((entry) => entry.includes('typing here and more'));
  assert.equal(row, inputRow, 'the caret sits on the input row');
  assert.equal(col, 2 + 4 + 'typing here and more'.length);
});

test('the composer never drifts up the screen while typing', () => {
  const marks = [];
  const output = captureTty({ columns: 60, rows: 24 }, (chunks) => {
    for (let i = 0; i < 8; i += 1) process.stdout.write(`  transcript line ${i}\n`);
    const prompt = new BoxedPrompt({ status: () => 'model' });
    prompt.state.text = 'typing';
    prompt.state.cursor = 6;
    prompt.draw();
    marks.push(chunks.join('').length);
    for (const letter of [' ', 'm', 'o', 'r', 'e']) {
      prompt.state.text += letter;
      prompt.state.cursor += 1;
      prompt.draw();
    }
  });

  const first = screenFrom(output.slice(0, marks[0]));
  const last = screenFrom(output);
  for (let i = 0; i < 8; i += 1) {
    assert.ok(
      last.rows.some((row) => row.includes(`transcript line ${i}`)),
      `transcript line ${i} must survive a repaint`,
    );
  }
  assert.equal(
    last.rows.findIndex((row) => row.includes('╭')),
    first.rows.findIndex((row) => row.includes('╭')),
    'the composer stays on the same row',
  );
  assert.equal(last.rows.filter((row) => row.includes('╭')).length, 1);
  assert.ok(last.rows.some((row) => row.includes('typing more')));
});

test('erasing the composer keeps the caret math consistent after a status refresh', () => {
  let status = 'Agnes 3.0 Flash';
  const marks = [];
  const output = captureTty({ columns: 70, rows: 24 }, (chunks) => {
    for (let i = 0; i < 5; i += 1) process.stdout.write(`  earlier output ${i}\n`);
    const prompt = new BoxedPrompt({ status: () => status });
    prompt.listening = true;
    prompt.draw();
    marks.push(chunks.join('').length);
    status = 'Agnes 3.0 Flash · 58:59';
    prompt.refresh();
  });
  const first = screenFrom(output.slice(0, marks[0]));
  const last = screenFrom(output);
  assert.equal(last.rows.filter((row) => row.includes('╭')).length, 1);
  assert.equal(
    last.rows.findIndex((row) => row.includes('╭')),
    first.rows.findIndex((row) => row.includes('╭')),
  );
  assert.ok(last.rows.some((row) => row.includes('58:59')));
  assert.ok(last.rows.some((row) => row.includes('earlier output 0')));
});

test('the caret stays inside the box for long wrapped input', () => {
  const prompt = new BoxedPrompt({ status: () => 'model' });
  const text = 'a'.repeat(300);
  const output = captureTty({ columns: 60, rows: 24 }, () => {
    prompt.state.text = text;
    prompt.state.cursor = text.length;
    prompt.draw();
  });
  const { rows, col } = screenFrom(output);
  const boxWidth = visibleWidth(rows.find((entry) => entry.includes('╭')));
  assert.ok(col >= 2 && col < boxWidth, `caret column ${col} inside box of ${boxWidth}`);
  assert.equal(rows.filter((entry) => entry.includes('╭')).length, 1);
});
