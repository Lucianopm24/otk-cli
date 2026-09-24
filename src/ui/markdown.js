/**
 * Markdown renderer tuned for a terminal chat: headings, lists, quotes,
 * tables, links, inline code and boxed fenced code blocks.
 *
 * `renderMarkdownEx` also reports how many leading lines are *stable* (they
 * belong to finished blocks) so the streaming renderer knows what it may
 * print permanently and what it still needs to repaint.
 */

import {
  padEnd,
  repeat,
  stripAnsi,
  truncateStyled,
  visibleWidth,
  wrapStyled,
} from '../util/ansi.js';
import { highlightCode } from './highlight.js';
import {
  bold,
  borders,
  dim,
  faint,
  glyphs,
  inlineCode,
  italic,
  neon,
  neonSoft,
  strike,
  underline,
} from './theme.js';

const FENCE_RE = /^\s*(```+|~~~+)\s*([\w+#.\-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
const OL_RE = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitTableRow(line) {
  const placeholder = '\u0000';
  const clean = line
    .trim()
    .replace(/\\\|/g, placeholder)
    .replace(/^\|/, '')
    .replace(/\|$/, '');
  return clean.split('|').map((cell) => cell.replaceAll(placeholder, '|').trim());
}

function indentLevel(whitespace) {
  const width = whitespace.replace(/\t/g, '    ').length;
  if (width >= 4) return 2;
  if (width >= 2) return 1;
  return 0;
}

/** Parse markdown into a flat list of block descriptors. */
export function parseBlocks(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const blocks = [];
  let paragraph = [];
  let inFence = false;
  let fenceChar = '`';
  let fenceLang = '';
  let fenceLines = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ').replace(/\s+/g, ' ').trim() });
      paragraph = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (inFence) {
      const closing = FENCE_RE.exec(line);
      if (closing && closing[1][0] === fenceChar && closing[1].length >= 3) {
        blocks.push({ type: 'code', lang: fenceLang, code: fenceLines.join('\n'), closed: true });
        inFence = false;
        fenceLines = [];
      } else {
        fenceLines.push(line);
      }
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph();
      inFence = true;
      fenceChar = fence[1][0];
      fenceLang = fence[2] || '';
      fenceLines = [];
      i += 1;
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushParagraph();
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushParagraph();
      const quoteLines = [quote[1]];
      i += 1;
      while (i < lines.length) {
        const next = QUOTE_RE.exec(lines[i]);
        if (!next) break;
        quoteLines.push(next[1]);
        i += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join(' ').trim() });
      continue;
    }

    if ((UL_RE.test(line) || OL_RE.test(line))) {
      flushParagraph();
      const items = [];
      while (i < lines.length) {
        const current = lines[i];
        const ul = UL_RE.exec(current);
        const ol = OL_RE.exec(current);
        if (ul) {
          items.push({ ordered: false, marker: '', level: indentLevel(ul[1]), text: ul[2].trim() });
        } else if (ol) {
          items.push({ ordered: true, marker: ol[2], level: indentLevel(ol[1]), text: ol[3].trim() });
        } else if (/^\s*$/.test(current) || FENCE_RE.test(current) || HEADING_RE.test(current)) {
          break;
        } else if (items.length && !TABLE_SEP_RE.test(current)) {
          // lazy continuation of the previous item
          items[items.length - 1].text += ' ' + current.trim();
        } else {
          break;
        }
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flushParagraph();
      const header = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  if (inFence) {
    blocks.push({ type: 'code', lang: fenceLang, code: fenceLines.join('\n'), closed: false });
  }
  flushParagraph();
  return blocks;
}

/** Inline markdown (bold, italic, code, links, strike). */
export function inline(text) {
  const source = String(text ?? '');
  const out = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    let match;
    if ((match = /^`([^`]+)`/.exec(rest))) {
      out.push(inlineCode(match[1]));
      i += match[0].length;
      continue;
    }
    if ((match = /^\*\*([\s\S]+?)\*\*/.exec(rest)) || (match = /^__([\s\S]+?)__/.exec(rest))) {
      out.push(bold(inline(match[1])));
      i += match[0].length;
      continue;
    }
    if ((match = /^~~([\s\S]+?)~~/.exec(rest))) {
      out.push(strike(inline(match[1])));
      i += match[0].length;
      continue;
    }
    if ((match = /^\*([^*\n]+)\*/.exec(rest)) || (match = /^_([^_\n]+)_/.exec(rest))) {
      out.push(italic(inline(match[1])));
      i += match[0].length;
      continue;
    }
    if ((match = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest))) {
      out.push(inline(match[1]) + ' ' + faint(match[2]));
      i += match[0].length;
      continue;
    }
    if ((match = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      const label = inline(match[1]);
      const url = match[2];
      out.push(
        visibleWidth(stripAnsi(label)) === visibleWidth(url)
          ? underline(label)
          : underline(label) + ' ' + faint('(' + url + ')'),
      );
      i += match[0].length;
      continue;
    }
    out.push(rest[0]);
    i += 1;
  }
  return out.join('');
}

function renderCodeBlock(block, ctx) {
  const charset = borders.round;
  const boxWidth = Math.max(24, ctx.available);
  const inner = boxWidth - 2;
  const tag = block.lang ? neonSoft(block.lang.toLowerCase()) : '';
  const heading = tag
    ? charset.h + ' ' + tag + ' ' + repeat(charset.h, Math.max(0, inner - 4 - visibleWidth(block.lang)))
    : repeat(charset.h, inner);
  const rows = [ctx.indent + dim(charset.tl + heading + charset.tr)];
  const code = highlightCode(block.code, block.lang);
  const contentWidth = Math.max(4, boxWidth - 4);
  for (const rawLine of code.split('\n')) {
    const wrapped = wrapStyled(rawLine === '' ? ' ' : rawLine, contentWidth);
    for (const piece of wrapped) {
      rows.push(
        ctx.indent +
          dim(charset.v) +
          ' ' +
          padEnd(piece, contentWidth) +
          ' ' +
          dim(charset.v),
      );
    }
  }
  rows.push(ctx.indent + dim(charset.bl + repeat(charset.h, inner) + charset.br));
  return rows;
}

function renderList(block, ctx) {
  const rows = [];
  let counter = 0;
  let previousOrdered = false;
  for (const item of block.items) {
    if (!item.ordered) counter = 0;
    else if (!previousOrdered) counter = Number(item.marker) || 1;
    else counter += 1;
    previousOrdered = item.ordered;
    const pad = '  '.repeat(item.level);
    const markerText = item.ordered ? `${counter}.` : '•';
    const marker = item.ordered ? dim(markerText) : neon(markerText);
    const hanging = ' '.repeat(visibleWidth(markerText) + 1);
    const body = wrapStyled(inline(item.text), Math.max(4, ctx.available - pad.length - hanging.length));
    body.forEach((line, index) => {
      rows.push(
        ctx.indent +
          pad +
          (index === 0 ? marker + ' ' : hanging) +
          line,
      );
    });
  }
  return rows;
}

function renderQuote(block, ctx) {
  const bar = dim(glyphs.quoteBar);
  return wrapStyled(italic(dim(inline(block.text))), Math.max(4, ctx.available - 2)).map(
    (line) => ctx.indent + bar + ' ' + line,
  );
}

function renderTable(block, ctx) {
  const columnCount = block.header.length;
  if (columnCount === 0) return [];
  const allRows = [block.header, ...block.rows];
  const widths = [];
  for (let c = 0; c < columnCount; c += 1) {
    let width = 0;
    for (const row of allRows) {
      width = Math.max(width, visibleWidth(stripAnsi(inline(String(row[c] ?? '')))));
    }
    widths.push(Math.min(width, 40));
  }
  const separatorWidth = 3 * (columnCount - 1);
  let total = widths.reduce((sum, value) => sum + value, 0) + separatorWidth;
  while (total > ctx.available && Math.max(...widths) > 6) {
    const widest = widths.indexOf(Math.max(...widths));
    widths[widest] -= 1;
    total -= 1;
  }
  const renderRow = (row, paint) =>
    ctx.indent +
    row
      .map((cell, index) => {
        const styled = paint(inline(String(cell ?? '')));
        const last = index === columnCount - 1;
        return last
          ? truncateStyled(styled, widths[index])
          : padEnd(truncateStyled(styled, widths[index]), widths[index]);
      })
      .join(dim(' │ '));
  const rows = [renderRow(block.header, (value) => bold(neonSoft(stripAnsi(value))))];
  rows.push(ctx.indent + widths.map((width) => dim(repeat('─', width))).join(dim('─┼─')));
  for (const row of block.rows) rows.push(renderRow(row, (value) => value));
  return rows;
}

function renderHeading(block, ctx) {
  const bar = glyphs.headingBar;
  if (block.level <= 2) {
    const body = wrapStyled(bold(neon(inline(block.text))), Math.max(4, ctx.available - 2));
    return body.map((line, index) =>
      ctx.indent + (index === 0 ? neon(bar + ' ') : '  ') + line,
    );
  }
  if (block.level === 3) {
    return wrapStyled(bold(neonSoft(inline(block.text))), ctx.available).map((line) => ctx.indent + line);
  }
  return wrapStyled(bold(inline(block.text)), ctx.available).map((line) => ctx.indent + line);
}

function renderBlock(block, ctx) {
  switch (block.type) {
    case 'paragraph':
      return wrapStyled(inline(block.text), ctx.available).map((line) => ctx.indent + line);
    case 'heading':
      return renderHeading(block, ctx);
    case 'code':
      return renderCodeBlock(block, ctx);
    case 'list':
      return renderList(block, ctx);
    case 'quote':
      return renderQuote(block, ctx);
    case 'table':
      return renderTable(block, ctx);
    case 'hr':
      return [ctx.indent + dim(repeat(borders.round.h, Math.min(ctx.available, 42)))];
    default:
      return [];
  }
}

/**
 * @returns {{ lines: string[], stableCount: number }}
 *   `stableCount` counts the leading lines that belong to finished blocks.
 */
export function renderMarkdownEx(source, options = {}) {
  const width = Math.max(16, options.width || 80);
  const indent = options.indent ?? '  ';
  const indentWidth = visibleWidth(indent);
  const ctx = { width, indent, indentWidth, available: Math.max(8, width - indentWidth) };
  const blocks = parseBlocks(source);
  const lines = [];
  let stableCount = 0;
  const trailingBlank = /\n[ \t]*\n[ \t]*$/.test(String(source ?? ''));
  blocks.forEach((block, index) => {
    const isLast = index === blocks.length - 1;
    const previous = index > 0 ? blocks[index - 1] : null;
    // blocks breathe: one blank line between them, but not after a heading
    if (previous && previous.type !== 'heading') lines.push('');
    lines.push(...renderBlock(block, ctx));
    const finished = !isLast || trailingBlank || (block.type === 'code' && block.closed);
    if (finished) stableCount = lines.length;
  });
  return { lines, stableCount };
}

export function renderMarkdown(source, options = {}) {
  return renderMarkdownEx(source, options).lines;
}
