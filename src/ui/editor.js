/**
 * Pure input editing: no I/O, no rendering. `prompt.js` owns the terminal,
 * this file owns the text, the caret and the history. Keeping it pure makes
 * the editing behaviour testable without a terminal.
 */

import { wrapPlain } from '../util/ansi.js';

export function createEditorState(initialText = '') {
  return {
    text: initialText,
    cursor: initialText.length,
    history: [],
    historyIndex: -1,
    draft: '',
  };
}

export function isMultiline(state) {
  return state.text.includes('\n');
}

export function editorInsert(state, chunk) {
  const clean = String(chunk).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  if (!clean) return state;
  state.historyIndex = -1;
  state.text = state.text.slice(0, state.cursor) + clean + state.text.slice(state.cursor);
  state.cursor += clean.length;
  return state;
}

export function editorBackspace(state) {
  if (state.cursor === 0) return state;
  state.text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
  state.cursor -= 1;
  return state;
}

export function editorDeleteForward(state) {
  if (state.cursor >= state.text.length) return state;
  state.text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1);
  return state;
}

export function editorSetCursor(state, index) {
  state.cursor = Math.max(0, Math.min(index, state.text.length));
  return state;
}

export function editorClear(state) {
  state.text = '';
  state.cursor = 0;
  state.historyIndex = -1;
  return state;
}

/** Delete from the caret back to the beginning of the current text line. */
export function editorKillToLineStart(state) {
  const start = state.text.lastIndexOf('\n', Math.max(0, state.cursor - 1)) + 1;
  if (start >= state.cursor) {
    state.text = state.text.slice(0, start) + state.text.slice(state.cursor);
    state.cursor = start;
    return state;
  }
  state.text = state.text.slice(0, start) + state.text.slice(state.cursor);
  state.cursor = start;
  return state;
}

export function editorKillToLineEnd(state) {
  const index = state.text.indexOf('\n', state.cursor);
  const end = index === -1 ? state.text.length : index;
  state.text = state.text.slice(0, state.cursor) + state.text.slice(end);
  return state;
}

export function editorDeleteWord(state) {
  const start = wordBoundaryLeft(state.text, state.cursor);
  state.text = state.text.slice(0, start) + state.text.slice(state.cursor);
  state.cursor = start;
  return state;
}

export function wordBoundaryLeft(text, index) {
  let i = index;
  while (i > 0 && /\s/.test(text[i - 1])) i -= 1;
  while (i > 0 && !/\s/.test(text[i - 1])) i -= 1;
  return i;
}

export function wordBoundaryRight(text, index) {
  let i = index;
  while (i < text.length && !/\s/.test(text[i])) i += 1;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

export function editorMove(state, where) {
  switch (where) {
    case 'left':
      if (state.cursor > 0) state.cursor -= 1;
      break;
    case 'right':
      if (state.cursor < state.text.length) state.cursor += 1;
      break;
    case 'wordLeft':
      state.cursor = wordBoundaryLeft(state.text, state.cursor);
      break;
    case 'wordRight':
      state.cursor = wordBoundaryRight(state.text, state.cursor);
      break;
    case 'lineStart': {
      const start = state.text.lastIndexOf('\n', Math.max(0, state.cursor - 1)) + 1;
      state.cursor = start;
      break;
    }
    case 'lineEnd': {
      const index = state.text.indexOf('\n', state.cursor);
      state.cursor = index === -1 ? state.text.length : index;
      break;
    }
    case 'up':
    case 'down':
      state.cursor = moveVertical(state.text, state.cursor, where === 'up' ? -1 : 1);
      break;
    default:
      break;
  }
  return state;
}

export function moveVertical(text, cursor, direction) {
  const lines = text.split('\n');
  let offset = 0;
  let row = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (offset + lines[i].length >= cursor) {
      row = i;
      break;
    }
    offset += lines[i].length + 1;
  }
  const column = cursor - offset;
  const target = row + direction;
  if (target < 0 || target >= lines.length) return cursor;
  let targetOffset = 0;
  for (let i = 0; i < target; i += 1) targetOffset += lines[i].length + 1;
  return targetOffset + Math.min(column, lines[target].length);
}

export function editorHistory(state, direction, history = state.history) {
  if (history.length === 0) return state;
  if (direction === 'prev') {
    if (state.historyIndex === -1) {
      state.draft = state.text;
      state.historyIndex = history.length - 1;
    } else if (state.historyIndex > 0) {
      state.historyIndex -= 1;
    }
    state.text = history[state.historyIndex] ?? '';
    state.cursor = state.text.length;
    return state;
  }
  if (state.historyIndex === -1) return state;
  if (state.historyIndex < history.length - 1) {
    state.historyIndex += 1;
    state.text = history[state.historyIndex] ?? '';
  } else {
    state.historyIndex = -1;
    state.text = state.draft;
  }
  state.cursor = state.text.length;
  return state;
}

export function pushHistory(history, text, limit = 100) {
  const trimmed = text.trim();
  if (!trimmed) return history;
  const next = history.filter((entry) => entry !== trimmed);
  next.push(trimmed);
  return next.slice(-limit);
}

/**
 * Wrap the input for display and report where the caret lands.
 * @returns {{ rows: {text: string, start: number}[], cursorRow: number, cursorCol: number, first: number, visible: {text: string, start: number}[] }}
 */
export function layoutInput(text, cursor, contentWidth, maxRows = 4) {
  const width = Math.max(4, contentWidth);
  const rows = wrapPlain(text === '' ? ' ' : text, width, true);
  if (text === '') rows[0] = { text: '', start: 0 };
  let cursorRow = 0;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].start <= cursor) cursorRow = i;
  }
  const cursorCol = Math.max(0, Math.min(cursor - rows[cursorRow].start, width));
  let first = 0;
  if (rows.length > maxRows) {
    first = Math.min(Math.max(cursorRow - maxRows + 1, 0), rows.length - maxRows);
  }
  return {
    rows,
    cursorRow,
    cursorCol,
    first,
    visible: rows.slice(first, first + maxRows),
  };
}
