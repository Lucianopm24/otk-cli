/**
 * Model selector: arrow keys to move between cards, Enter to confirm.
 * Cards are rendered by `screens/modelCards.js` so `/models`, `/model` and
 * the first-run flow all share the exact same visual language.
 */

import readline from 'node:readline';
import { isInteractive, rows as termRows, stdin, write } from './out.js';
import { bold, dim, faint, glyphs, neon } from './theme.js';
import { modelCompactRow, modelDetailCard, cardWidth } from '../screens/modelCards.js';

const INDENT = '  ';

export function renderSelectorFrame(models, options = {}) {
  const {
    index = 0,
    currentId = null,
    title = 'Choose a model',
    allowCancel = false,
    indent = INDENT,
    height = termRows(),
    header = null,
  } = options;

  const width = cardWidth();
  const headerRows = Array.isArray(header) ? header : null;
  const blocks = models.map((model, i) =>
    i === index
      ? modelDetailCard(model, {
          indent,
          width,
          active: true,
          current: model.id === currentId,
        })
      : [
          modelCompactRow(model, {
            indent,
            width,
            current: model.id === currentId,
          }),
        ],
  );

  const headerBlock = headerRows
    ? [...headerRows, '', indent + neon(glyphs.diamond) + ' ' + bold(title), '']
    : [indent + neon(glyphs.diamond) + ' ' + bold(title), ''];
  const footer = [
    '',
    indent +
      dim(
        [
          '↑/↓ move',
          'Enter confirm',
          allowCancel ? 'Esc back' : null,
        ]
          .filter(Boolean)
          .join('  ·  '),
      ),
  ];

  // keep the frame at least two rows short of the screen so it never scrolls
  const available = Math.max(6, height - headerBlock.length - footer.length - 4);
  let first = 0;
  let last = blocks.length - 1;
  let used = blocks.reduce((sum, block) => sum + block.length + 1, 0);

  if (used > available) {
    first = index;
    last = index;
    used = blocks[index].length + 1;
    for (;;) {
      const up = first - 1 >= 0 ? blocks[first - 1].length + 1 : Infinity;
      const down = last + 1 < blocks.length ? blocks[last + 1].length + 1 : Infinity;
      const next = Math.min(up, down);
      if (!Number.isFinite(next) || used + next > available) break;
      if (up <= down) {
        first -= 1;
        used += up;
      } else {
        last += 1;
        used += down;
      }
    }
  }

  const body = [];
  if (first > 0) body.push(indent + dim(`↑ ${first} more`));
  for (let i = first; i <= last; i += 1) {
    if (i > first) body.push('');
    body.push(...blocks[i]);
  }
  if (last < blocks.length - 1) {
    body.push(indent + dim(`↓ ${blocks.length - 1 - last} more`));
  }

  return [...headerBlock, ...body, ...footer];
}

function eraseBlock(height) {
  if (height > 0) write(`\u001b[${height}A\u001b[J`);
}

export async function selectModel(options) {
  const {
    models,
    currentId = null,
    allowCancel = options.models?.length > 1,
    title = 'Choose a model',
    preferredId = null,
    header = null,
  } = options;

  if (!models || models.length === 0) return null;

  if (!isInteractive()) {
    const preferred =
      models.find((model) => model.id === preferredId) ||
      models.find((model) => model.id === currentId) ||
      models[0];
    return preferred;
  }

  let index = Math.max(
    0,
    models.findIndex((model) => model.id === currentId || model.id === preferredId),
  );
  if (index < 0) index = 0;

  readline.emitKeypressEvents(stdin);
  if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
  stdin.resume();

  const paint = () => {
    const frame = renderSelectorFrame(models, {
      index,
      currentId,
      title,
      allowCancel,
      header,
    });
    write(frame.join('\n') + '\n');
    return frame.length;
  };

  write('\n');
  let height = paint();

  return new Promise((resolve) => {
    const cleanup = () => {
      stdin.removeListener('keypress', onKey);
    };
    const finish = (value) => {
      cleanup();
      eraseBlock(height);
      resolve(value);
    };
    const redraw = () => {
      eraseBlock(height);
      height = paint();
    };
    const move = (delta) => {
      index = (index + delta + models.length) % models.length;
      redraw();
    };
    const onKey = (str, key = {}) => {
      const name = key.name || '';
      if (key.ctrl && name === 'c') {
        finish(null);
        return;
      }
      if (name === 'up' || name === 'k') move(-1);
      else if (name === 'down' || name === 'j') move(1);
      else if (name === 'left') move(-1);
      else if (name === 'right') move(1);
      else if (name === 'home') {
        index = 0;
        redraw();
      } else if (name === 'end') {
        index = models.length - 1;
        redraw();
      } else if (name === 'return' || name === 'enter') {
        finish(models[index]);
      } else if (name === 'escape') {
        finish(allowCancel ? null : models[index]);
      } else if (/^[1-9]$/.test(str || '')) {
        const target = Number(str) - 1;
        if (target < models.length) {
          index = target;
          finish(models[target]);
        }
      }
    };
    stdin.on('keypress', onKey);
  });
}
