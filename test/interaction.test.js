import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';

const { BoxedPrompt } = await import('../src/ui/prompt.js');
const { selectModel } = await import('../src/ui/select.js');
const { stripAnsi } = await import('../src/util/ansi.js');

const MODEL_A = {
  id: 'agnes-3.0-flash',
  inputPricePerMTok: 0.05,
  outputPricePerMTok: 0.15,
  free: false,
  usesSessions: false,
  note: null,
  warning: null,
};
const MODEL_B = {
  id: 'stealth/union-alpha',
  inputPricePerMTok: 0,
  outputPricePerMTok: 0,
  free: true,
  usesSessions: true,
  note: null,
  warning: 'Temporary model.',
};

/** Pretend the process owns a terminal and capture everything written. */
function fakeTerminal({ columns = 80, rows = 24 } = {}) {
  const output = [];
  const restoreFns = [];
  const define = (target, key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    restoreFns.push(() => {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    });
    Object.defineProperty(target, key, { value, writable: true, configurable: true });
  };
  for (const stream of [process.stdout, process.stdin]) {
    define(stream, 'isTTY', true);
  }
  define(process.stdout, 'columns', columns);
  define(process.stdout, 'rows', rows);
  define(process.stdin, 'setRawMode', () => {});
  define(process.stdin, 'resume', () => {});
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output.push(String(chunk));
    return true;
  };
  return {
    output,
    text: () => stripAnsi(output.join('')),
    raw: () => output.join(''),
    restore() {
      process.stdout.write = originalWrite;
      for (const undo of restoreFns.reverse()) undo();
    },
  };
}

const press = (name, extra = {}) =>
  process.stdin.emit('keypress', extra.sequence ?? null, { name, ctrl: false, meta: false, shift: false, ...extra });
const type = (text) => process.stdin.emit('keypress', text, { name: undefined });

test('typing and pressing Enter submits the composer', async () => {
  const terminal = fakeTerminal();
  try {
    const prompt = new BoxedPrompt({ status: () => 'Agnes 3.0 Flash' });
    const pending = prompt.read();
    type('hello world');
    press('return', { sequence: '\r' });
    const result = await pending;
    assert.deepEqual(result, { type: 'submit', text: 'hello world' });
    assert.ok(terminal.text().includes('hello world'));
    assert.ok(terminal.raw().includes('\u001b['), 'the box is repainted in place');
    assert.equal(prompt.height, 0, 'the composer is erased once submitted');
  } finally {
    terminal.restore();
  }
});

test('editing keys move the caret and delete text', async () => {
  const terminal = fakeTerminal();
  try {
    const prompt = new BoxedPrompt();
    const pending = prompt.read();
    type('helo');
    press('left');
    press('left');
    type('l');
    assert.equal(prompt.state.text, 'hello');
    assert.equal(prompt.state.cursor, 3);
    press('backspace');
    assert.equal(prompt.state.text, 'helo');
    press('end');
    type('!');
    prompt.refresh();
    assert.equal(prompt.state.text, 'helo!');
    press('home');
    assert.equal(prompt.state.cursor, 0);
    press('delete');
    assert.equal(prompt.state.text, 'elo!');
    press('return', { sequence: '\r' });
    assert.deepEqual(await pending, { type: 'submit', text: 'elo!' });
  } finally {
    terminal.restore();
  }
});

test('Ctrl+J and Alt+Enter insert newlines instead of sending', async () => {
  const terminal = fakeTerminal();
  try {
    const prompt = new BoxedPrompt();
    const pending = prompt.read();
    type('first line');
    press('enter', { sequence: '\n' });
    type('second line');
    press('return', { meta: true, sequence: '\u001b\r' });
    type('third');
    assert.equal(prompt.state.text, 'first line\nsecond line\nthird');
    press('return', { sequence: '\r' });
    assert.deepEqual(await pending, { type: 'submit', text: 'first line\nsecond line\nthird' });
  } finally {
    terminal.restore();
  }
});

test('the up arrow recalls previous submissions', async () => {
  const terminal = fakeTerminal();
  try {
    const prompt = new BoxedPrompt();
    let pending = prompt.read();
    type('first message');
    press('return', { sequence: '\r' });
    await pending;

    pending = prompt.read();
    type('second message');
    press('return', { sequence: '\r' });
    await pending;

    pending = prompt.read();
    press('up');
    assert.equal(prompt.state.text, 'second message');
    press('up');
    assert.equal(prompt.state.text, 'first message');
    press('down');
    assert.equal(prompt.state.text, 'second message');
    press('escape');
    assert.equal(prompt.state.text, '');
    press('return', { sequence: '\r' });
    assert.deepEqual(await pending, { type: 'submit', text: '' });
  } finally {
    terminal.restore();
  }
});

test('Ctrl+C clears the composer first and exits when empty', async () => {
  const terminal = fakeTerminal();
  try {
    const prompt = new BoxedPrompt();
    const pending = prompt.read();
    type('unsent draft');
    press('c', { ctrl: true, sequence: '\u0003' });
    assert.equal(prompt.state.text, '');
    assert.ok(terminal.text().includes('Ctrl+C again to exit'));
    press('c', { ctrl: true, sequence: '\u0003' });
    assert.deepEqual(await pending, { type: 'exit', text: '' });
    assert.equal(prompt.height, 0);
  } finally {
    terminal.restore();
  }
});

test('the model selector confirms with Enter and cancels with Esc', async () => {
  const terminal = fakeTerminal();
  try {
    let selection = selectModel({ models: [MODEL_A, MODEL_B], preferredId: MODEL_A.id });
    press('down');
    press('return', { sequence: '\r' });
    assert.equal((await selection).id, MODEL_B.id);

    selection = selectModel({ models: [MODEL_A, MODEL_B], currentId: MODEL_A.id });
    press('escape');
    assert.equal(await selection, null);

    selection = selectModel({ models: [MODEL_A, MODEL_B], currentId: MODEL_A.id });
    press('2', { sequence: '2' });
    assert.equal((await selection).id, MODEL_B.id);

    assert.ok(terminal.text().includes('Choose a model'));
    assert.ok(terminal.text().includes('Union Alpha'));
  } finally {
    terminal.restore();
  }
});

test('a single model cannot be escaped away', async () => {
  const terminal = fakeTerminal();
  try {
    const selection = selectModel({ models: [MODEL_A] });
    press('escape');
    assert.equal((await selection).id, MODEL_A.id);
  } finally {
    terminal.restore();
  }
});
