/**
 * Box drawing primitives. Every card, panel and the input box is produced
 * here so borders, padding and embedded titles stay perfectly aligned.
 */

import {
  center,
  padEnd,
  padStart,
  repeat,
  truncateStyled,
  visibleWidth,
} from '../util/ansi.js';
import { borders, dim, neon } from './theme.js';

function borderRow(width, label, position, charset, paint) {
  const inner = Math.max(0, width - 2);
  const left = position === 'top' ? charset.tl : charset.bl;
  const right = position === 'top' ? charset.tr : charset.br;
  if (!label) {
    return paint(left) + paint(repeat(charset.h, inner)) + paint(right);
  }
  const text = truncateStyled(label, Math.max(0, inner - 4));
  const decorated = ` ${text} `;
  const used = visibleWidth(decorated) + 1;
  const fill = repeat(charset.h, Math.max(0, inner - used));
  return paint(left) + paint(fill) + decorated + paint(right);
}

/**
 * Render a box around `content`.
 *
 * Content entries may be plain styled strings or `{ left, right }` objects to
 * push a value to the right edge of the card.
 *
 * @returns {string[]} rendered rows (each already the full visual line)
 */
export function box(content, options = {}) {
  const {
    width = 64,
    title = null,
    footer = null,
    active = false,
    padX = 1,
    style = 'round',
    indent = '',
    titlePaint = null,
    footerPaint = null,
  } = options;
  const safeWidth = Math.max(8, width);
  const charset = borders[style] || borders.round;
  const borderPaint = active ? neon : dim;
  const inner = Math.max(2, safeWidth - 2 - padX * 2);
  const rows = [];

  const labelPaint = titlePaint || (active ? neon : dim);
  rows.push(
    indent +
      borderRow(
        safeWidth,
        title ? labelPaint(title) : null,
        'top',
        charset,
        borderPaint,
      ),
  );

  for (const entry of content) {
    const isPair =
      entry !== null && typeof entry === 'object' && !Array.isArray(entry);
    const left = isPair ? String(entry.left ?? '') : String(entry ?? '');
    const right = isPair ? String(entry.right ?? '') : '';
    const available = Math.max(0, inner - visibleWidth(right));
    const body = truncateStyled(left, available);
    const gap = repeat(' ', Math.max(0, inner - visibleWidth(body) - visibleWidth(right)));
    const pad = repeat(' ', padX);
    rows.push(
      indent +
        borderPaint(charset.v) +
        pad +
        body +
        gap +
        right +
        pad +
        borderPaint(charset.v),
    );
  }

  rows.push(
    indent +
      borderRow(
        safeWidth,
        footer ? (footerPaint || dim)(footer) : null,
        'bottom',
        charset,
        borderPaint,
      ),
  );
  return rows;
}

/** A box whose width hugs its content but never exceeds `maxWidth`. */
export function card(content, options = {}) {
  const { maxWidth = 76, minWidth = 34, indent = '' } = options;
  let natural = 0;
  for (const entry of content) {
    const isPair = entry !== null && typeof entry === 'object' && !Array.isArray(entry);
    const left = isPair ? String(entry.left ?? '') : String(entry ?? '');
    const right = isPair ? String(entry.right ?? '') : '';
    natural = Math.max(natural, visibleWidth(left) + visibleWidth(right) + 2);
  }
  const width = Math.min(maxWidth, Math.max(minWidth, natural + 2));
  return box(content, { ...options, width, indent });
}

/** Horizontal rule used inside panels. */
export function rule(width, style = 'round') {
  const charset = borders[style] || borders.round;
  return dim(repeat(charset.h, Math.max(1, width)));
}

export function centerBlock(rows, width) {
  return rows.map((row) => center(row, width));
}
