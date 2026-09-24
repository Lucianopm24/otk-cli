/**
 * The OTK banner: full ASCII wordmark on roomy terminals, compact boxed
 * wordmark when the terminal is narrow, and a one-line lockup for panels.
 */

import { center, padEnd, repeat, visibleWidth } from '../util/ansi.js';
import { APP_NAME, PRODUCT_NAME, VERSION } from '../version.js';
import { ascii, bold, borders, dim, neon, neonDeep, neonSoft, warn } from './theme.js';

const ART = [
  '  ██████╗ ████████╗██╗  ██╗',
  ' ██╔═══██╗╚══██╔══╝██║ ██╔╝',
  ' ██║   ██║   ██║   █████╔╝ ',
  ' ██║   ██║   ██║   ██╔═██╗ ',
  ' ╚██████╔╝   ██║   ██║  ██╗',
  '  ╚═════╝    ╚═╝   ╚═╝  ╚═╝',
];

const ART_WIDTH = Math.max(...ART.map(visibleWidth));
const ART_HEIGHT = ART.length;

/** The wordmark under the ASCII art: `O P E N T O K E N S`. */
export function wordmark(spaced = true) {
  return spaced ? PRODUCT_NAME.toUpperCase().split('').join(' ') : PRODUCT_NAME.toUpperCase();
}

function lockupLine() {
  return `${dim('Version')} ${neonSoft(VERSION)}`;
}

function betaTag() {
  return warn(' BETA');
}

function compactBanner(columns, { beta = false } = {}) {
  const charset = borders.round;
  const body = ascii.on
    ? [wordmark() + (beta ? betaTag() : ''), dim(`${APP_NAME} v${VERSION}`)]
    : [
        ...ART.map((row) => row.trimEnd()),
        '',
        wordmark() + (beta ? betaTag() : ''),
        dim(`${APP_NAME} v${VERSION}`),
      ];
  const natural = Math.max(...body.map((row) => visibleWidth(row)));
  const inner = Math.max(12, Math.min(columns - 4, natural + 4) - 2);
  const rows = [
    center(neonDeep(charset.tl + repeat(charset.h, inner) + charset.tr), columns),
  ];
  for (const row of body) {
    rows.push(
      center(
        neonDeep(charset.v) +
          ' ' +
          padEnd(row, Math.max(1, inner - 2)) +
          ' ' +
          neonDeep(charset.v),
        columns,
      ),
    );
  }
  rows.push(center(neonDeep(charset.bl + repeat(charset.h, inner) + charset.br), columns));
  return ['', ...rows, ''];
}

function fullBanner(columns, { beta = false } = {}) {
  const rows = [];
  rows.push('');
  const indent = ' '.repeat(Math.max(0, Math.floor((columns - ART_WIDTH) / 2)));
  ART.forEach((row, index) => {
    const paint = index % 2 === 0 ? neon : neonSoft;
    rows.push(indent + paint(row));
  });
  rows.push('');
  rows.push(center(bold(neon(wordmark())) + (beta ? betaTag() : ''), columns));
  rows.push(center(dim(`${APP_NAME} v${VERSION}`), columns));
  rows.push('');
  return rows;
}

/**
 * @param {object} [options]
 * @param {number} [options.columns]  terminal width
 * @param {number} [options.rows]     terminal height
 * @param {boolean} [options.compact] force the compact lockup
 * @param {boolean} [options.beta]    show the BETA tag next to the wordmark
 */
export function renderBanner(options = {}) {
  const columns = options.columns || process.stdout.columns || 80;
  const rows = options.rows || process.stdout.rows || 24;
  const wideEnough = columns >= ART_WIDTH + 8;
  const tallEnough = rows >= ART_HEIGHT + 12;
  if (ascii.on || options.compact || !wideEnough || !tallEnough) {
    return compactBanner(columns, { beta: options.beta });
  }
  return fullBanner(columns, { beta: options.beta });
}

