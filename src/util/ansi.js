/**
 * ANSI-aware text helpers: visible width, styled word wrapping, truncation
 * and padding. Every renderer in OTK CLI goes through these so that borders
 * stay straight no matter what markup or colour is embedded in a line.
 */

const SGR = /^\u001b\[[0-9;]*m/;
const ANY_ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export const RESET = '\u001b[0m';

export function stripAnsi(text) {
  return String(text).replace(ANY_ANSI, '');
}

export function hasAnsi(text) {
  ANY_ANSI.lastIndex = 0;
  return ANY_ANSI.test(String(text));
}

function isZeroWidth(cp) {
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfe0f) return true;
  if (cp >= 0x0300 && cp <= 0x036f) return true;
  if (cp >= 0x1ab0 && cp <= 0x1aff) return true;
  if (cp >= 0x20d0 && cp <= 0x20ff) return true;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true;
  return false;
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

export function charWidth(cp) {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (isZeroWidth(cp)) return 0;
  return isWide(cp) ? 2 : 1;
}

export function visibleWidth(text) {
  let width = 0;
  for (const ch of stripAnsi(text)) width += charWidth(ch.codePointAt(0));
  return width;
}

/** Split styled text into atoms: `{ t, w, space }` where `t` keeps leading ANSI. */
function atomize(text) {
  const atoms = [];
  let pending = '';
  let i = 0;
  const source = String(text);
  while (i < source.length) {
    const match = SGR.exec(source.slice(i));
    if (match) {
      pending += match[0];
      i += match[0].length;
      continue;
    }
    const cp = source.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (ch === ' ' || ch === '\t') {
      atoms.push({ t: pending + ' ', w: 1, space: true });
    } else if (ch === '\u200b') {
      atoms.push({ t: pending, w: 0, space: false, skip: true });
    } else {
      atoms.push({ t: pending + ch, w: charWidth(cp), space: false });
    }
    pending = '';
  }
  if (pending) atoms.push({ t: pending, w: 0, space: false, skip: true });
  return atoms;
}

/** Remove spaces that sit at the end of a line, before any trailing ANSI codes. */
function trimTrailingSpaces(text) {
  let out = text;
  for (;;) {
    const match = /(?:\u001b\[[0-9;]*m)*$/.exec(out);
    const cut = out.length - (match ? match[0].length : 0);
    if (cut > 0 && out[cut - 1] === ' ') out = out.slice(0, cut - 1) + out.slice(cut);
    else break;
  }
  return out;
}

function updateOpen(open, segment) {
  let result = open;
  const re = /\u001b\[([0-9;]*)m/g;
  let match;
  while ((match = re.exec(segment))) {
    const params = match[1];
    if (params === '' || params === '0') result = '';
    else result += match[0];
  }
  return result;
}

/**
 * Word-wrap styled text to `width` visible columns.
 * Words longer than the width are hard-broken so a line never overflows.
 */
export function wrapStyled(text, width) {
  const limit = Math.max(1, Math.floor(width));
  const source = String(text).replace(/\r/g, '').replace(/\n/g, ' ');
  const atoms = atomize(source);
  const out = [];
  let current = '';
  let currentWidth = 0;
  let open = '';

  const flush = () => {
    const line = trimTrailingSpaces(current);
    out.push(line && hasAnsi(line) ? line + RESET : line);
    current = '';
    currentWidth = 0;
  };

  const newLine = () => {
    flush();
    current = open;
  };

  const push = (atom) => {
    current += atom.t;
    currentWidth += atom.w;
    open = updateOpen(open, atom.t);
  };

  let i = 0;
  while (i < atoms.length) {
    if (atoms[i].skip) {
      push(atoms[i]);
      i += 1;
      continue;
    }
    if (atoms[i].space) {
      // collapse runs of whitespace into a single breakable space
      while (i < atoms.length && atoms[i].space) i += 1;
      if (currentWidth > 0 && currentWidth + 1 <= limit) {
        current += ' ';
        currentWidth += 1;
      }
      continue;
    }
    // collect one word
    let wordWidth = 0;
    const word = [];
    while (i < atoms.length && !atoms[i].space) {
      if (!atoms[i].skip) wordWidth += atoms[i].w;
      word.push(atoms[i]);
      i += 1;
    }
    if (currentWidth > 0 && currentWidth + wordWidth > limit) newLine();
    for (const atom of word) {
      if (atom.skip) {
        push(atom);
        continue;
      }
      if (currentWidth + atom.w > limit && currentWidth > 0) newLine();
      push(atom);
    }
  }

  flush();
  return out.length ? out : [''];
}

/** Wrap plain (unstyled) text, optionally tracking character offsets per row. */
export function wrapPlain(text, width, trackOffsets = false) {
  const rows = [];
  const source = String(text);
  const segments = source.split('\n');
  let offset = 0;
  for (let s = 0; s < segments.length; s += 1) {
    const segment = segments[s];
    let rowStart = offset;
    let rowWidth = 0;
    let row = '';
    const pushRow = () => {
      const text = row.replace(/[ \t]+$/, '');
      rows.push(trackOffsets ? { text, start: rowStart } : text);
      row = '';
      rowWidth = 0;
      rowStart = offset;
    };
    const words = segment.split(/(\s+)/);
    for (const piece of words) {
      if (piece === '') continue;
      if (/^\s+$/.test(piece)) {
        const space = piece.replace(/\t/g, ' ').length;
        if (rowWidth > 0 && rowWidth + 1 <= width) {
          row += ' ';
          rowWidth += 1;
        }
        offset += piece.length;
        continue;
      }
      let chunk = piece;
      while (chunk.length > 0) {
        if (rowWidth + chunk.length <= width) {
          row += chunk;
          rowWidth += chunk.length;
          offset += chunk.length;
          chunk = '';
        } else if (rowWidth === 0) {
          const take = chunk.slice(0, width);
          row += take;
          rowWidth += take.length;
          offset += take.length;
          chunk = chunk.slice(take.length);
          pushRow();
        } else {
          pushRow();
        }
      }
    }
    offset += 1; // the newline we split on
    pushRow();
  }
  if (trackOffsets) return rows;
  return rows.length ? rows : [''];
}

export function truncateStyled(text, width, ellipsis = '…') {
  const source = String(text);
  if (visibleWidth(source) <= width) return source;
  const tailWidth = visibleWidth(ellipsis);
  const budget = Math.max(0, width - tailWidth);
  let out = '';
  let used = 0;
  let i = 0;
  while (i < source.length) {
    const match = SGR.exec(source.slice(i));
    if (match) {
      out += match[0];
      i += match[0].length;
      continue;
    }
    const cp = source.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (used + cw > budget) break;
    out += ch;
    used += cw;
    i += ch.length;
  }
  return out + (hasAnsi(out) ? RESET : '') + ellipsis;
}

export function padEnd(text, width) {
  const diff = width - visibleWidth(text);
  return diff > 0 ? text + ' '.repeat(diff) : text;
}

export function padStart(text, width) {
  const diff = width - visibleWidth(text);
  return diff > 0 ? ' '.repeat(diff) + text : text;
}

/** Centre a styled string inside `width` columns. */
export function center(text, width) {
  const diff = width - visibleWidth(text);
  if (diff <= 0) return text;
  const left = Math.floor(diff / 2);
  const right = diff - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

export function repeat(char, count) {
  return count > 0 ? char.repeat(count) : '';
}
