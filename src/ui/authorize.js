/**
 * Authorization popup for agent tools: shows a preview of what the tool
 * would do and waits for the user to allow or deny it. Nothing is ever
 * executed without an explicit Enter here.
 */

import readline from 'node:readline';
import { isInteractive, stdin, write } from './out.js';
import { bold, borders, dim, faint, glyphs, neon, neonSoft, warn } from './theme.js';
import { padEnd, repeat, visibleWidth } from '../util/ansi.js';

const INDENT = '  ';

/**
 * Frame the popup. Every row is padded to the exact same inner width so the
 * right border always lines up (a short row would leave the box "open").
 */
function frame(rows, { width, title }) {
  const charset = borders.round;
  const inner = Math.max(4, width - 4);
  const out = [];
  const titleText = title ? ' ' + title + ' ' : '';
  const titleWidth = titleText ? visibleWidth(titleText) : 0;
  out.push(
    INDENT +
      dim(
        charset.tl +
          repeat(charset.h, Math.max(0, inner - titleWidth)) +
          (titleText ? charset.t + titleText : '') +
          charset.tr,
      ),
  );
  for (const row of rows) {
    out.push(INDENT + dim(charset.v) + ' ' + padEnd(row, inner) + ' ' + dim(charset.v));
  }
  out.push(INDENT + dim(charset.bl + repeat(charset.h, inner) + charset.br));
  return out;
}

/**
 * Show the tool preview and resolve `true` (allow) or `false` (deny).
 * Falls back to `false` in non-interactive mode: tools never run unattended.
 */
export function authorizeTool({ toolName, preview, argsSummary = '' }) {
  if (!isInteractive()) return Promise.resolve(false);

  return new Promise((resolve) => {
    let selected = true; // default: Allow
    let done = false;

    const width = Math.max(48, Math.min(80, (process.stdout.columns || 80) - 6));
    const bodyWidth = width - 6;

    // The popup always occupies a FIXED number of rows (padded with blanks
    // if the preview is short). Repainting walks back exactly those rows from
    // the anchored bottom line, so it can never drift up the screen.
    const paint = () => {
      const header = [
        neon(glyphs.warn) + ' ' + bold(warn(`${toolName} wants to run`)),
        '',
      ];
      const previewRows = preview.map((row) => dim(row));
      const argsRow = argsSummary ? [dim(argsSummary), ''] : [];
      const buttons = selected
        ? neon('[ ' + bold(neonSoft('Allow')) + ' ]') + '  ' + dim('[ Deny ]')
        : dim('[ Allow ]') + '  ' + neon('[ ' + bold(neonSoft('Deny')) + ' ]');
      const footer = ['', INDENT + buttons, '', INDENT + faint('←/→ or Tab switch  ·  Enter confirm  ·  Esc deny')];
      const rows = [...header, ...previewRows, ...argsRow, ...footer];
      const framed = frame(rows, { width, title: 'Authorization required' });

      // pad to a constant height so repaints never change geometry
      const FIXED = framed.length + 4;
      while (framed.length < FIXED) framed.push('');

      if (paintedOnce) {
        // anchored repaint: return to the first popup row and overwrite
        write(`\u001b[${FIXED}A\r\u001b[J`);
      }
      write(framed.join('\n'));
      paintedOnce = true;
      return FIXED;
    };

    readline.emitKeypressEvents(stdin);
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    stdin.resume();

    let paintedOnce = false;
    let height = paint();

    const cleanup = () => {
      stdin.removeListener('keypress', onKey);
    };
    const finish = (value) => {
      if (done) return;
      done = true;
      cleanup();
      write(`\u001b[${height}A\r\u001b[J`);
      resolve(value);
    };
    const redraw = () => {
      height = paint();
    };
    const onKey = (str, key = {}) => {
      const name = key.name || '';
      if (key.ctrl && name === 'c') {
        finish(false);
        return;
      }
      if (name === 'left' || name === 'right' || name === 'tab') {
        selected = !selected;
        redraw();
        return;
      }
      if (name === 'return' || name === 'enter') {
        finish(selected);
        return;
      }
      if (name === 'escape') {
        finish(false);
        return;
      }
      if (str === 'y' || str === 'Y') {
        finish(true);
        return;
      }
      if (str === 'n' || str === 'N') {
        finish(false);
        return;
      }
    };
    stdin.on('keypress', onKey);
  });
}
