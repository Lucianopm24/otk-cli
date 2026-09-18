import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';

const {
  createEditorState,
  editorBackspace,
  editorDeleteForward,
  editorDeleteWord,
  editorHistory,
  editorInsert,
  editorKillToLineEnd,
  editorKillToLineStart,
  editorMove,
  layoutInput,
  pushHistory,
} = await import('../src/ui/editor.js');

test('typing, deleting and caret movement behave like a normal input', () => {
  const state = createEditorState();
  editorInsert(state, 'hello');
  assert.equal(state.text, 'hello');
  assert.equal(state.cursor, 5);
  editorMove(state, 'left');
  editorMove(state, 'left');
  editorInsert(state, 'X');
  assert.equal(state.text, 'helXlo');
  editorBackspace(state);
  assert.equal(state.text, 'hello');
  editorMove(state, 'lineStart');
  assert.equal(state.cursor, 0);
  editorDeleteForward(state);
  assert.equal(state.text, 'ello');
});

test('control characters and carriage returns never enter the input', () => {
  const state = createEditorState();
  editorInsert(state, 'a\u0007b\r\nc');
  assert.equal(state.text, 'ab\nc');
});

test('word and line operations work on multi-line input', () => {
  const state = createEditorState('one two\nthree four');
  editorMove(state, 'wordLeft');
  assert.equal(state.cursor, 14);
  editorDeleteWord(state);
  assert.equal(state.text, 'one two\nfour');
  editorInsert(state, 'and ');
  assert.equal(state.text, 'one two\nand four');
  editorKillToLineStart(state);
  assert.equal(state.text, 'one two\nfour');
  editorMove(state, 'lineEnd');
  editorKillToLineStart(state);
  assert.equal(state.text, 'one two\n');

  const other = createEditorState('alpha beta');
  editorMove(other, 'lineStart');
  editorMove(other, 'right');
  editorKillToLineEnd(other);
  assert.equal(other.text, 'a');
});

test('history walks backwards and forwards and keeps the draft', () => {
  const state = createEditorState();
  state.history = ['first', 'second'];
  editorInsert(state, 'draft');
  editorHistory(state, 'prev');
  assert.equal(state.text, 'second');
  editorHistory(state, 'prev');
  assert.equal(state.text, 'first');
  editorHistory(state, 'next');
  assert.equal(state.text, 'second');
  editorHistory(state, 'next');
  assert.equal(state.text, 'draft');
});

test('history ignores blank entries and de-duplicates', () => {
  let history = [];
  history = pushHistory(history, '  ');
  history = pushHistory(history, 'hello');
  history = pushHistory(history, 'world');
  history = pushHistory(history, 'hello');
  assert.deepEqual(history, ['world', 'hello']);
});

test('layout maps the caret onto wrapped rows', () => {
  const layout = layoutInput('hello world again', 6, 6, 4);
  assert.deepEqual(
    layout.rows.map((row) => row.text),
    ['hello', 'world', 'again'],
  );
  assert.equal(layout.cursorRow, 1);
  assert.equal(layout.cursorCol, 0);
  assert.equal(layout.visible.length, 3);
});

test('layout scrolls to keep the caret visible', () => {
  const text = Array.from({ length: 8 }, (_, index) => `line${index}`).join('\n');
  const layout = layoutInput(text, text.length, 20, 3);
  assert.equal(layout.visible.length, 3);
  assert.ok(layout.cursorRow >= layout.first);
  assert.ok(layout.cursorRow < layout.first + 3);
});
