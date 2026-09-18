/**
 * Chat transcript scrollback: the alternate screen buffer has no native
 * scroll, so OTK keeps its own transcript journal. The composer forwards
 * Shift+PageUp/Down (and mouse wheel events) here to scroll the conversation
 * viewport in place.
 */

import { columns, isTTY, rows as termRows, write } from './out.js';
import { stripAnsi, truncateStyled } from '../util/ansi.js';
import { dim, faint } from './theme.js';

export class TranscriptScroller {
  constructor({ indent = '  ' } = {}) {
    this.indent = indent;
    this.lines = []; // raw styled lines of the conversation
    this.offset = 0; // 0 = live (bottom); N = scrolled up N lines
    this.height = 0; // viewport height in rows
    this.overlayRows = 0; // composer rows reserved at the bottom
    this.active = false;
  }

  /** Append styled transcript lines (the scroller only counts them). */
  append(styledText) {
    for (const line of String(styledText ?? '').split('\n')) {
      this.lines.push(line);
    }
    if (this.offset > 0 && this.active) {
      // content arrived while the user was reading history: follow the tail
      this.offset = 0;
    }
  }

  /** Erase everything since the last reset (e.g. /clear). */
  reset() {
    this.lines = [];
    this.offset = 0;
  }

  availableHeight() {
    return Math.max(6, termRows() - this.overlayRows);
  }

  maxOffset() {
    return Math.max(0, this.lines.length - this.availableHeight());
  }

  /**
   * Scroll by `delta` lines. Positive delta scrolls DOWN toward the live
   * tail (offset shrinks); negative scrolls UP into history (offset grows).
   */
  scroll(delta) {
    if (this.lines.length === 0) return false;
    if (delta === -Infinity) {
      // jump to the very top of the history
      const before = this.offset;
      this.offset = this.maxOffset();
      this.active = true;
      return this.offset !== before;
    }
    if (delta === Infinity) return this.home();
    const before = this.offset;
    this.offset = Math.max(0, Math.min(this.offset - delta, this.maxOffset()));
    if (this.offset !== before) {
      this.active = this.offset > 0;
      return true;
    }
    return false;
  }

  /** Jump to the bottom (live mode). */
  home() {
    if (this.offset === 0) return false;
    this.offset = 0;
    this.active = false;
    return true;
  }

  get scrolled() {
    return this.offset > 0;
  }

  /**
   * Render the viewport for the current offset. `composerRows` is a callback
   * that renders the prompt box; while scrolled it is hidden in favor of a
   * status bar so the whole viewport is conversation text.
   */
  renderViewport(composerRows) {
    if (!this.scrolled) return composerRows();
    const height = this.availableHeight();
    const width = columns();
    const end = Math.max(0, this.lines.length - this.offset);
    const start = Math.max(0, end - height);
    const visible = this.lines.slice(start, end);

    const viewport = [];
    for (let i = 0; i < height - 1; i += 1) {
      viewport.push(this.indent + (visible[i] ?? ''));
    }
    // status bar pinned to the bottom of the viewport
    const pos = this.offset >= this.maxOffset() ? '(bottom)' : `-${this.offset} lines`;
    const bar = dim(`[ scrollback ${pos} · ↑/↓ or PgUp/PgDn · End or Esc to return to chat ]`);
    viewport.push(' ' + truncateStyled(bar, width - 2));
    return viewport;
  }
}

/** Shift+PageUp / Shift+PageDown key names arriving from keypress events. */
export function scrollKeyDelta(key = {}) {
  const name = key.name || '';
  if (name === 'pageup') return -(termRows() - 4);
  if (name === 'pagedown') return termRows() - 4;
  return null;
}
