/**
 * Live markdown region: renders streamed text progressively.
 *
 * Finished blocks are committed to the scrollback permanently, while the
 * block currently being written is repainted in place. That means streaming
 * feels smooth without ever duplicating text.
 */

import { columns, hideCursor, isTTY, showCursor, write } from './out.js';
import { renderMarkdownEx } from './markdown.js';

export class LiveMarkdown {
  constructor(options = {}) {
    this.indent = options.indent ?? '  ';
    this.width = options.width ?? columns();
    this.maxLive =
      options.maxLive ?? Math.max(3, Math.min((process.stdout.rows || 24) - 8, 60));
    this.rendered = [];
    this.committed = 0;
    this.liveCount = 0;
    this.cursorHidden = false;
    this.text = '';
  }

  get active() {
    return this.liveCount > 0;
  }

  #eraseLive() {
    if (this.liveCount === 0) return;
    write(`\u001b[${this.liveCount}A\u001b[J`);
    this.liveCount = 0;
  }

  #printLine(line) {
    write(line + '\n');
  }

  #render(text, { forceCommit = false } = {}) {
    const width = columns();
    this.width = width;
    const { lines, stableCount } = renderMarkdownEx(text, {
      width,
      indent: this.indent,
    });
    let commitTarget = stableCount;
    const overflow = lines.length - commitTarget;
    if (overflow > this.maxLive) {
      // Very long unfinished block (giant code fence): keep repainting only
      // the tail so the erase window stays small and predictable.
      commitTarget = lines.length - 1;
    }
    if (forceCommit) commitTarget = lines.length;

    if (this.liveCount > 0) {
      // Differential repaint: walk up into the live region and overwrite only
      // the lines that actually changed. Finished text stays pixel-stable,
      // so streaming is easy to read instead of flashing on every token.
      write(`\u001b[${this.liveCount}A\r`);
      let cursorRow = this.committed;
      for (let i = this.committed; i < lines.length; i += 1) {
        const next = lines[i] ?? '';
        if (i < this.committed + this.liveCount) {
          // row already on screen: rewrite it only if it changed
          if (this.rendered[i] !== next) write('\r\u001b[2K' + next);
          if (i < lines.length - 1) {
            write('\u001b[B');
            cursorRow = i + 1;
          }
        } else {
          // brand-new row: print it for good
          write('\r\u001b[2K' + next + '\n');
          cursorRow = i + 1;
        }
      }
      if (cursorRow < lines.length) write('\n');
      // drop any stale rows left over if the text shrank mid-stream
      write('\r\u001b[J');
      this.committed = commitTarget;
      this.liveCount = Math.max(0, lines.length - commitTarget);
      if (commitTarget < lines.length && !this.cursorHidden) {
        hideCursor();
        this.cursorHidden = true;
      }
      this.rendered = lines;
      this.text = text;
      return;
    }

    for (let i = this.committed; i < commitTarget; i += 1) {
      this.#printLine(lines[i] ?? '');
    }
    this.committed = commitTarget;
    if (commitTarget < lines.length && !this.cursorHidden) {
      // keep the terminal caret out of the way while text is being repainted
      hideCursor();
      this.cursorHidden = true;
    }
    for (let i = commitTarget; i < lines.length; i += 1) {
      this.#printLine(lines[i] ?? '');
      this.liveCount += 1;
    }
    this.rendered = lines;
    this.text = text;
  }

  /** Feed the accumulated assistant text. */
  update(text) {
    if (!isTTY()) {
      // Plain mode: only flush blocks that will never change again.
      const { lines, stableCount } = renderMarkdownEx(text, {
        width: columns(),
        indent: this.indent,
      });
      for (let i = this.committed; i < stableCount; i += 1) this.#printLine(lines[i] ?? '');
      this.committed = Math.max(this.committed, stableCount);
      this.rendered = lines;
      this.text = text;
      return;
    }
    this.#render(text);
  }

  /** Commit everything that is left and close the region. */
  finish(text) {
    const finalText = text === undefined ? this.text : text;
    if (!isTTY()) {
      const { lines } = renderMarkdownEx(finalText, { width: columns(), indent: this.indent });
      for (let i = this.committed; i < lines.length; i += 1) this.#printLine(lines[i] ?? '');
      this.committed = lines.length;
      this.rendered = lines;
      this.text = finalText;
      return;
    }
    this.#render(finalText, { forceCommit: true });
    this.#eraseLive();
    this.committed = this.rendered.length;
    this.#restoreCursor();
  }

  #restoreCursor() {
    if (!this.cursorHidden) return;
    this.cursorHidden = false;
    showCursor();
  }

  /** Drop the pending live region without printing it again (used on abort). */
  discard() {
    this.#eraseLive();
    this.#restoreCursor();
  }
}

export function createLiveMarkdown(options) {
  return new LiveMarkdown(options);
}
