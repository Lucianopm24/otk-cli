/**
 * OTK CLI visual identity: dark terminal, neon green accent, restrained
 * secondary colours. Everything visual imports its colours and glyphs here.
 */

import { RESET } from '../util/ansi.js';

const PALETTE = {
  neon: { rgb: [61, 255, 155], c256: 84, c16: 92 },
  neonSoft: { rgb: [157, 255, 200], c256: 121, c16: 92 },
  neonDeep: { rgb: [27, 127, 77], c256: 29, c16: 32 },
  mint: { rgb: [99, 230, 255], c256: 80, c16: 96 },
  text: { rgb: [232, 236, 233], c256: 255, c16: 97 },
  dim: { rgb: [148, 160, 152], c256: 246, c16: 37 },
  faint: { rgb: [101, 113, 106], c256: 241, c16: 30 },
  border: { rgb: [46, 66, 56], c256: 238, c16: 32 },
  borderSoft: { rgb: [32, 45, 38], c256: 235, c16: 30 },
  warn: { rgb: [255, 199, 92], c256: 221, c16: 33 },
  error: { rgb: [255, 107, 118], c256: 203, c16: 31 },
  codeBg: { rgb: [16, 30, 23], c256: 234, c16: null },
};

function detectLevel() {
  if (process.env.NO_COLOR && process.env.NO_COLOR !== '') return 0;
  if (process.env.OTK_NO_COLOR === '1') return 0;
  if (!process.stdout.isTTY) return 0;
  if (process.env.FORCE_COLOR === '0') return 0;
  const forced = Number(process.env.FORCE_COLOR);
  if (forced >= 3) return 3;
  if (forced === 2) return 2;
  if (forced === 1) return 1;
  const colorterm = (process.env.COLORTERM || '').toLowerCase();
  if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return 3;
  const term = (process.env.TERM || '').toLowerCase();
  if (term.includes('256color') || term === 'xterm-kitty') return 2;
  if (term === 'dumb' || term === '') return 1;
  if (term.includes('color') || term.includes('xterm') || term.includes('screen')) return 2;
  return 1;
}

export const colorLevel = detectLevel();

function fg(name) {
  const entry = PALETTE[name];
  return (value) => {
    const text = value === undefined || value === null ? '' : String(value);
    if (colorLevel === 0 || text === '') return text;
    if (colorLevel === 3) return `\u001b[38;2;${entry.rgb.join(';')}m${text}${RESET}`;
    if (colorLevel === 2) return `\u001b[38;5;${entry.c256}m${text}${RESET}`;
    return `\u001b[${entry.c16}m${text}${RESET}`;
  };
}

export const neon = fg('neon');
export const neonSoft = fg('neonSoft');
export const neonDeep = fg('neonDeep');
export const mint = fg('mint');
export const text = fg('text');
export const dim = fg('dim');
export const faint = fg('faint');
export const border = fg('border');
export const borderSoft = fg('borderSoft');
export const warn = fg('warn');
export const error = fg('error');

function attr(open, close) {
  return (value) => {
    const str = value === undefined || value === null ? '' : String(value);
    if (colorLevel === 0 || str === '') return str;
    return `${open}${str}${close}`;
  };
}

export const bold = attr('\u001b[1m', '\u001b[22m');
export const italic = attr('\u001b[3m', '\u001b[23m');
export const underline = attr('\u001b[4m', '\u001b[24m');
export const strike = attr('\u001b[9m', '\u001b[29m');

/** Inline code: subtle dark plate behind neon text. */
export function inlineCode(value) {
  const str = String(value);
  if (colorLevel === 0) return '`' + str + '`';
  if (colorLevel === 3) {
    return `\u001b[48;2;${PALETTE.codeBg.rgb.join(';')}m\u001b[38;2;${PALETTE.neonSoft.rgb.join(';')}m ${str} ${RESET}`;
  }
  if (colorLevel === 2) return `\u001b[48;5;${PALETTE.codeBg.c256}m\u001b[38;5;121m ${str} ${RESET}`;
  return '\u001b[7m' + str + RESET;
}

export const glyphs = {
  headingBar: '▎',
  quoteBar: '▏',
  ok: '✓',
  cross: '✕',
  bullet: '◉',
  circle: '○',
  dot: '●',
  diamond: '◈',
  clock: '◷',
  timer: '⏱',
  bar: '│',
  arrow: '▸',
  spark: '✦',
  warn: '⚠',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

export const borders = {
  round: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  square: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
};

/** Whether the CLI is rendering without any fancy Unicode glyphs. */
export const ascii = { on: false };

/** Switch to plain ASCII (used by `OTK_ASCII=1` and dumb terminals). */
export function setAsciiMode(enabled) {
  if (!enabled) return;
  ascii.on = true;
  Object.assign(glyphs, {
    headingBar: '#',
    quoteBar: '|',
    ok: '+',
    cross: 'x',
    bullet: '(*)',
    circle: '( )',
    dot: '*',
    diamond: '<>',
    clock: '@',
    timer: 'T',
    bar: '|',
    arrow: '>',
    spark: '*',
    warn: '!',
    spinner: ['|', '/', '-', '\\'],
  });
  borders.round = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
  borders.square = { ...borders.round };
}

if (process.env.OTK_ASCII === '1') setAsciiMode(true);

/** Namespace object for renderers that prefer `t.neon(...)`. */
export const t = {
  neon,
  neonSoft,
  neonDeep,
  mint,
  text,
  dim,
  faint,
  border,
  borderSoft,
  warn,
  error,
  bold,
  italic,
  underline,
  strike,
  inlineCode,
};
