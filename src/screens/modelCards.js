/**
 * Model cards. Every value shown here comes from the backend model list:
 * name, price, whether it is free, whether it uses daily sessions, notes and
 * warnings. Nothing about a specific model is hardcoded.
 */

import { padEnd, truncateStyled, visibleWidth, wrapStyled } from '../util/ansi.js';
import { box } from '../ui/box.js';
import { columns } from '../ui/out.js';
import { bold, dim, faint, glyphs, mint, neon, neonSoft, warn } from '../ui/theme.js';
import {
  inputPriceLabel,
  modelDisplayName,
  modelSummary,
  modelTagline,
  outputPriceLabel,
  usageLabel,
} from '../format.js';

export function cardWidth(extra = 0) {
  return Math.max(34, Math.min(columns() - 6 - extra, 68));
}

function labelValue(label, value, inner) {
  const prefix = dim(padEnd(label, 9)) + '  ';
  const room = Math.max(4, inner - visibleWidth(prefix));
  return prefix + truncateStyled(value, room);
}

function prefixedLines(glyph, text, inner, paint) {
  const room = Math.max(8, inner - 2);
  const wrapped = wrapStyled(text, room);
  return wrapped.map((line, index) =>
    index === 0 ? paint(glyph + ' ') + line : '  ' + line,
  );
}

/** Detailed card used by the model selector and `/models`. */
export function modelDetailCard(model, options = {}) {
  const { indent = '  ', width = null, current = false, footer = null } = options;
  const w = width ?? cardWidth();
  const inner = w - 4;
  const name = modelDisplayName(model.id);
  const rows = [];
  if (model.limitedTime) {
    rows.push(neon(glyphs.bullet) + '  ' + bold(neonSoft(name)));
    rows.push(warn('LIMITED'));
  } else {
    rows.push(neon(glyphs.bullet) + '  ' + bold(neonSoft(name)));
  }
  rows.push('');
  rows.push(dim(modelTagline(model)));
  rows.push(dim(modelSummary(model)));
  rows.push('');
  const input = Number(model.inputPricePerMTok) || 0;
  const output = Number(model.outputPricePerMTok) || 0;
  if (input === 0 && output === 0) {
    rows.push(labelValue('Cost', 'Free — no credits used', inner));
  } else {
    rows.push(labelValue('Input', inputPriceLabel(model), inner));
    rows.push(labelValue('Output', outputPriceLabel(model), inner));
  }
  rows.push(labelValue('Usage', usageLabel(model), inner));
  if (model.limitedTime && model.yourActiveSession) {
    rows.push('');
    rows.push(...prefixedLines(mint(glyphs.timer), 'Unlocked — your session is active.', inner, mint));
  }
  if (model.note) {
    rows.push('');
    rows.push(...prefixedLines(mint(glyphs.spark), model.note, inner, mint));
  }
  if (model.warning) {
    rows.push('');
    rows.push(...prefixedLines(warn(glyphs.warn), model.warning, inner, warn));
  }
  if (current) {
    rows.push('');
    rows.push(neon(glyphs.dot) + ' ' + dim('current model'));
  }
  return box(rows, {
    width: w,
    indent,
    active: options.active ?? false,
    footer: footer ?? undefined,
  });
}

/** Compact one-line row for models that are not focused. */
export function modelCompactRow(model, options = {}) {
  const { indent = '  ', width = null, focused = false, current = false } = options;
  const w = width ?? cardWidth();
  const glyph = focused ? neon(glyphs.bullet) : current ? neon(glyphs.dot) : dim(glyphs.circle);
  const name = focused
    ? bold(neonSoft(modelDisplayName(model.id)))
    : dim(modelDisplayName(model.id));
  const tail = faint(modelSummary(model));
  const used =
    visibleWidth(indent) + visibleWidth(glyph) + 2 + visibleWidth(name) + visibleWidth(tail);
  const gap = Math.max(2, w - (used - visibleWidth(indent)));
  return indent + glyph + '  ' + name + ' '.repeat(gap) + tail;
}

/** The persistent two-line card shown in the chat header. */
export function chatModelCard(model, options = {}) {
  const { indent = '  ', width = null, footer = null } = options;
  const w = width ?? Math.min(cardWidth(), 62);
  const name = modelDisplayName(model.id);
  const rows = [
    neon(glyphs.bullet) + '  ' + bold(neonSoft(name)),
    dim(modelSummary(model)),
  ];
  return box(rows, { width: w, indent, footer: footer ?? undefined });
}

export function modelWarningLines(model, indent = '  ') {
  if (!model?.warning) return [];
  const inner = Math.min(cardWidth() - 4, 66);
  return prefixedLines(warn(glyphs.warn), model.warning, inner, warn).map(
    (line) => indent + line,
  );
}
