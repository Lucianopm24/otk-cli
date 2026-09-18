/**
 * Very small syntax highlighter used for fenced code blocks. It is
 * deliberately conservative: only comments, strings, numbers and keywords
 * get colour so code stays readable instead of turning into confetti.
 */

import { faint, mint, neonSoft, warn } from './theme.js';

const KEYWORDS = {
  js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'new', 'await', 'async', 'import', 'export', 'from', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'this', 'null', 'undefined', 'true', 'false', 'of', 'in', 'default', 'switch', 'case', 'break', 'continue', 'yield', 'static', 'super'],
  py: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'async', 'await', 'None', 'True', 'False', 'and', 'or', 'not', 'in', 'is', 'pass', 'self'],
  sh: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'export', 'local', 'echo', 'set', 'unset', 'source'],
  go: ['package', 'import', 'func', 'return', 'if', 'else', 'for', 'range', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'select', 'case', 'switch', 'break', 'continue', 'nil', 'true', 'false'],
  rust: ['fn', 'let', 'mut', 'pub', 'struct', 'enum', 'impl', 'trait', 'use', 'mod', 'match', 'if', 'else', 'for', 'while', 'loop', 'return', 'self', 'Self', 'where', 'as', 'const', 'static', 'async', 'await', 'move', 'ref', 'dyn', 'crate'],
  sql: ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'index', 'join', 'left', 'right', 'inner', 'outer', 'group', 'by', 'order', 'limit', 'offset', 'and', 'or', 'not', 'null', 'as', 'on', 'distinct', 'count', 'sum', 'avg'],
  java: ['public', 'private', 'protected', 'class', 'interface', 'void', 'int', 'long', 'double', 'float', 'boolean', 'String', 'new', 'return', 'if', 'else', 'for', 'while', 'try', 'catch', 'finally', 'throws', 'static', 'final', 'import', 'package', 'extends', 'implements', 'null', 'true', 'false'],
  c: ['int', 'char', 'void', 'long', 'short', 'float', 'double', 'struct', 'enum', 'union', 'typedef', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'sizeof', 'const', 'static', 'extern', 'include', 'define', 'nullptr', 'NULL'],
};

const FAMILY_BY_LANG = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  ts: 'js', typescript: 'js', tsx: 'js',
  py: 'py', python: 'py', python3: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', terminal: 'sh',
  go: 'go', golang: 'go',
  rs: 'rust', rust: 'rust',
  sql: 'sql', postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql',
  java: 'java', kotlin: 'java',
  c: 'c', h: 'c', cpp: 'c', 'c++': 'c', csharp: 'c', cs: 'c',
  json: 'data', jsonc: 'data', yaml: 'data', yml: 'data', toml: 'data', ini: 'data',
  diff: 'diff', patch: 'diff',
};

export function familyFor(lang) {
  if (!lang) return null;
  const key = String(lang)
    .toLowerCase()
    .split(/[\s:]/)[0]
    .replace(/^language-/, '');
  return FAMILY_BY_LANG[key] || null;
}

export function isHighlightable(lang) {
  return familyFor(lang) !== null;
}

const PATTERNS = new Map();

function patternFor(family) {
  if (PATTERNS.has(family)) return PATTERNS.get(family);
  const parts = [];
  if (family === 'js') parts.push('(?<comment>\\/\\/.*$)');
  if (family === 'py' || family === 'sh' || family === 'data') parts.push('(?<comment>#.*$)');
  parts.push(
    '(?<string>"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)',
  );
  parts.push('(?<number>\\b(?:0[xX][0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b)');
  const keywords = KEYWORDS[family];
  if (keywords && keywords.length) {
    parts.push('(?<keyword>\\b(?:' + keywords.join('|') + ')\\b)');
  }
  const pattern = new RegExp(parts.join('|'), family === 'js' || family === 'sql' ? 'gi' : 'g');
  PATTERNS.set(family, pattern);
  return pattern;
}

function highlightLine(line, family) {
  const pattern = patternFor(family);
  pattern.lastIndex = 0;
  let out = '';
  let last = 0;
  let match;
  while ((match = pattern.exec(line))) {
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    out += line.slice(last, match.index);
    const groups = match.groups || {};
    if (groups.comment !== undefined) out += faint(match[0]);
    else if (groups.string !== undefined) out += neonSoft(match[0]);
    else if (groups.number !== undefined) out += warn(match[0]);
    else out += mint(match[0]);
    last = match.index + match[0].length;
  }
  out += line.slice(last);
  return out;
}

function highlightDiff(line) {
  if (/^(\+\+\+|---)/.test(line)) return faint(line);
  if (/^@@/.test(line)) return mint(line);
  if (/^\+/.test(line)) return neonSoft(line);
  if (/^-/.test(line)) return warn(line);
  return faint(line);
}

/** Highlight `code` for the given language tag (unknown languages pass through). */
export function highlightCode(code, lang) {
  const family = familyFor(lang);
  if (!family) return String(code);
  return String(code)
    .split('\n')
    .map((line) => (family === 'diff' ? highlightDiff(line) : highlightLine(line, family)))
    .join('\n');
}
