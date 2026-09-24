/**
 * The OTK input box: a large, clearly framed composer with a status footer
 * (current model, credits or free-session time).
 *
 * Falls back to a minimal line reader when stdin is not a TTY so the CLI can
 * still be scripted.
 */

import readline from 'node:readline';
import { columns, isInteractive, stdin, write } from './out.js';
import { padEnd, repeat, truncateStyled, visibleWidth } from '../util/ansi.js';
import { borders, dim, faint, neon } from './theme.js';
import {
  createEditorState,
  editorBackspace,
  editorClear,
  editorDeleteForward,
  editorDeleteWord,
  editorHistory,
  editorInsert,
  editorKillToLineEnd,
  editorKillToLineStart,
  editorMove,
  isMultiline,
  layoutInput,
  pushHistory,
} from './editor.js';
import { scrollKeyDelta } from './scroller.js';

const INDENT = '  ';
const GLYPH = '› ';
const MAX_ROWS = 4;

function boxWidth() {
  return Math.max(28, (columns() || 80) - INDENT.length - 2);
}

export class BoxedPrompt {
  constructor(options = {}) {
    this.indent = options.indent ?? INDENT;
    this.placeholder = options.placeholder ?? 'Ask Toeky anything…';
    this.status = options.status ?? (() => '');
    this.history = options.history ?? [];
    this.scroller = options.scroller ?? null;
    this.state = createEditorState('');
    this.height = 0;
    this.cursorFromTop = 0;
    this.listening = false;
    this.hint = '';
    this.lastRows = [];
    this.viewportRows = 0;
    this.lastLayoutKey = '';
  }

  #handler = (str, key = {}) => this.#onKey(str, key);

  #onResize = () => {
    if (!this.listening) return;
    // the terminal reflowed the old frame, so forget it and draw a fresh one
    this.height = 0;
    this.cursorFromTop = 0;
    this.draw();
  };

  width() {
    return boxWidth();
  }

  contentWidth() {
    return this.width() - 6;
  }

  /** Redraw in place (used by the free-session timer). */
  refresh() {
    if (this.listening) this.draw();
  }

  /** Attach the transcript scroller (called once by the chat screen). */
  setScroller(scroller) {
    this.scroller = scroller;
  }

  #onKey(str, key = {}) {
    const state = this.state;
    const name = key.name || '';
    const ctrl = Boolean(key.ctrl);

    if (ctrl && name === 'c') {
      if (state.text.length > 0) {
        editorClear(state);
        this.hint = 'input cleared · Ctrl+C again to exit';
        this.draw();
        return;
      }
      this.#settle();
      this.resolve({ type: 'exit', text: '' });
      return;
    }
    if (ctrl && name === 'd') {
      if (state.text.length === 0) {
        this.#settle();
        this.resolve({ type: 'exit', text: '' });
        return;
      }
      editorDeleteForward(state);
      this.draw();
      return;
    }
    if (name === 'escape') {
      if (this.scroller?.scrolled) {
        // first Esc: leave scrollback mode and return to the live chat
        if (this.scroller.home()) this.draw();
        return;
      }
      if (state.text.length > 0) editorClear(state);
      this.hint = '';
      this.draw();
      return;
    }
    if (name === 'return' || (name === 'enter' && (key.meta || key.shift))) {
      if (key.meta || key.shift) {
        editorInsert(state, '\n');
        this.draw();
        return;
      }
      const text = state.text;
      this.#settle();
      this.resolve({ type: 'submit', text });
      return;
    }
    if (name === 'enter') {
      // Ctrl+J / raw LF pasted inside the composer becomes a soft newline.
      editorInsert(state, '\n');
      this.draw();
      return;
    }
    if (name === 'backspace') {
      editorBackspace(state);
      this.hint = '';
      this.draw();
      return;
    }
    if (name === 'delete') {
      editorDeleteForward(state);
      this.draw();
      return;
    }
    if (name === 'left') {
      editorMove(state, ctrl || key.meta ? 'wordLeft' : 'left');
      this.draw();
      return;
    }
    if (name === 'right') {
      editorMove(state, ctrl || key.meta ? 'wordRight' : 'right');
      this.draw();
      return;
    }
    if (name === 'up' || name === 'down') {
      if (key.shift && this.scroller) {
        // Shift+↑/↓ scrolls the conversation transcript
        if (this.scroller.scroll(name === 'up' ? -1 : 1)) this.draw();
        return;
      }
      if (isMultiline(state)) editorMove(state, name);
      else editorHistory(state, name === 'up' ? 'prev' : 'next', this.history);
      this.draw();
      return;
    }
    if ((name === 'pageup' || name === 'pagedown') && this.scroller) {
      const delta = scrollKeyDelta(key);
      if (delta !== null && this.scroller.scroll(delta)) this.draw();
      return;
    }
    if (name === 'home' && key.shift && this.scroller) {
      if (this.scroller.scroll(-Infinity)) this.draw();
      return;
    }
    if (name === 'home' || (ctrl && name === 'a')) {
      if (key.shift && this.scroller) {
        if (this.scroller.scroll(-Infinity)) this.draw();
        return;
      }
      editorMove(state, 'lineStart');
      this.draw();
      return;
    }
    if (name === 'end' && key.shift && this.scroller) {
      if (this.scroller.home()) this.draw();
      return;
    }
    if (name === 'end' || (ctrl && name === 'e')) {
      editorMove(state, 'lineEnd');
      this.draw();
      return;
    }

    if (ctrl && name === 'u') {
      editorKillToLineStart(state);
      this.draw();
      return;
    }
    if (ctrl && name === 'k') {
      editorKillToLineEnd(state);
      this.draw();
      return;
    }
    if (ctrl && name === 'w') {
      editorDeleteWord(state);
      this.draw();
      return;
    }
    if (ctrl || key.meta) return;
    if (name === 'tab') return;
    if (str) {
      editorInsert(state, str);
      this.hint = '';
      this.draw();
    }
  }

  #settle() {
    this.erase();
    this.listening = false;
    stdin.removeListener('keypress', this.#handler);
    process.stdout.removeListener('resize', this.#onResize);
  }

  /** Remove the composer from the screen, leaving the caret on its first row. */
  erase() {
    if (this.height > 0) {
      const up = this.cursorFromTop;
      if (up > 0) write(`\u001b[${up}A`);
      write('\r\u001b[J');
    }
    this.height = 0;
    this.cursorFromTop = 0;
    this.viewportRows = 0;
    this.lastRows = [];
  }

  draw() {
    // While the user is reading the scrollback, the composer is replaced by
    // the transcript viewport; nothing of the box is drawn then.
    if (this.scroller?.scrolled) {
      this.erase();
      const viewport = this.scroller.renderViewport(() => []);
      // anchor repaints: walk back up to the viewport's first row before
      // overwriting, or each scroll key would stack a copy further down.
      if (this.viewportRows > 0) {
        write(`\u001b[${this.viewportRows - 1}A\r\u001b[J`);
      }
      write(viewport.join('\n'));
      this.viewportRows = viewport.length;
      this.height = 0;
      this.lastRows = [];
      return;
    }
    this.viewportRows = 0;

    const width = this.width();
    const charset = borders.round;
    const maxRows = Math.min(MAX_ROWS, Math.max(1, (process.stdout.rows || 24) - 8));
    const layout = layoutInput(this.state.text, this.state.cursor, this.contentWidth(), maxRows);
    const rows = [];
    rows.push(this.indent + dim(charset.tl + repeat(charset.h, width - 2) + charset.tr));

    layout.visible.forEach((row, index) => {
      const absolute = layout.first + index;
      const glyph = absolute === 0 ? neon(GLYPH) : '  ';
      const isPlaceholder = this.state.text.length === 0 && absolute === 0;
      const body = isPlaceholder ? dim(this.placeholder) : row.text;
      rows.push(
        this.indent +
          dim(charset.v) +
          ' ' +
          glyph +
          padEnd(body, this.contentWidth()) +
          ' ' +
          dim(charset.v),
      );
    });

    rows.push(
      this.indent +
        dim(charset.v) +
        ' ' +
        ' '.repeat(this.contentWidth() + GLYPH.length) +
        ' ' +
        dim(charset.v),
    );

    const right = this.hint ? faint(this.hint) : faint('');
    const status = this.status() || '';
    const footerBudget = width - 6;
    const footerText = right
      ? truncateStyled(status, Math.max(0, footerBudget - visibleWidth(right) - 2))
      : truncateStyled(status, footerBudget);
    const footer = right ? footerText + ' ' + faint('·') + ' ' + right : footerText;
    const fill = repeat(charset.h, Math.max(0, width - 5 - visibleWidth(footer)));
    rows.push(
      this.indent +
        dim(charset.bl + charset.h + ' ') +
        footer +
        dim(' ' + fill + charset.br),
    );

    const targetRow = 1 + (layout.cursorRow - layout.first);

    if (this.height > 0 && this.height === rows.length && this.lastRows.length === rows.length) {
      // Differential repaint: same box geometry, so only overwrite the lines
      // that actually changed. The box never flickers while typing. The
      // footer is always rewritten because the status timer can tick.
      const up = this.cursorFromTop;
      if (up > 0) write(`\u001b[${up}A`);
      for (let i = 0; i < rows.length; i += 1) {
        if (this.lastRows[i] !== rows[i] || i === rows.length - 1) {
          write('\r\u001b[2K' + rows[i]);
        }
        if (i < rows.length - 1) write('\u001b[B');
      }
      // land just below the box, exactly like a fresh draw does
      write('\n');
      this.lastRows = rows;
      this.height = rows.length;
      this.cursorFromTop = targetRow;
      this.#parkCaret(targetRow, layout.cursorCol);
      return;
    }
    // geometry changed: forget the old frame and draw a fresh one
    this.erase();
    write(rows.join('\n') + '\n');
    this.height = rows.length;
    this.lastRows = rows;
    this.cursorFromTop = targetRow;
    this.#parkCaret(targetRow, layout.cursorCol);
  }

  #parkCaret(targetRow, cursorCol) {
    const rowsBelow = this.height - targetRow;
    const column = this.indent.length + 4 + cursorCol;
    if (rowsBelow > 0) write(`\u001b[${rowsBelow}A`);
    write('\r');
    if (column > 0) write(`\u001b[${column}C`);
  }

  /**
   * Show the composer and resolve with the user's intent.
   * @returns {Promise<{type: 'submit'|'exit', text: string}>}
   */
  async read(options = {}) {
    if (options.placeholder) this.placeholder = options.placeholder;
    if (options.status) this.status = options.status;
    if (options.initial !== undefined) {
      this.state = createEditorState(options.initial);
    } else {
      this.state = createEditorState('');
    }
    this.hint = '';
    this.height = 0;
    this.cursorFromTop = 0;
    this.viewportRows = 0;
    readline.emitKeypressEvents(stdin);
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    stdin.resume();
    this.listening = true;
    return new Promise((resolve) => {
      this.resolve = (result) => {
        if (result.type === 'submit') {
          this.history = pushHistory(this.history, result.text);
        }
        resolve(result);
      };
      stdin.on('keypress', this.#handler);
      process.stdout.on('resize', this.#onResize);
      this.draw();
    });
  }
}

/**
 * Line based reader for pipes and scripts. A single interface is reused for
 * the whole session so piped input is never dropped between reads.
 */
export class PlainPrompt {
  constructor(options = {}) {
    this.history = options.history ?? [];
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.interface = null;
  }

  refresh() {}

  erase() {}

  #ensure() {
    if (this.interface || this.closed) return;
    this.interface = readline.createInterface({
      input: stdin,
      terminal: false,
      crlfDelay: Infinity,
    });
    this.interface.on('line', (text) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter({ type: 'submit', text });
      else this.queue.push(text);
    });
    this.interface.on('close', () => {
      this.closed = true;
      while (this.waiters.length > 0) this.waiters.shift()({ type: 'exit', text: '' });
    });
  }

  async read() {
    this.#ensure();
    if (this.queue.length > 0) return { type: 'submit', text: this.queue.shift() };
    if (this.closed) return { type: 'exit', text: '' };
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close() {
    this.interface?.close();
  }
}

export function createPrompt(options = {}) {
  return isInteractive() ? new BoxedPrompt(options) : new PlainPrompt(options);
}
