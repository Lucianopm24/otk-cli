/**
 * Test helper: pretend the process owns a terminal so the interactive UI can
 * be driven without a real TTY, then simulate keypresses like Node's readline
 * would deliver them.
 */

import { stripAnsi } from '../../src/util/ansi.js';

export function fakeTerminal({ columns = 90, rows = 30 } = {}) {
  const output = [];
  const restores = [];
  const define = (target, key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    restores.push(() => {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    });
    Object.defineProperty(target, key, { value, writable: true, configurable: true });
  };

  for (const stream of [process.stdout, process.stdin]) define(stream, 'isTTY', true);
  define(process.stdout, 'columns', columns);
  define(process.stdout, 'rows', rows);
  define(process.stdin, 'setRawMode', () => {});
  define(process.stdin, 'resume', () => {});

  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output.push(String(chunk));
    return true;
  };

  return {
    output,
    text: () => stripAnsi(output.join('')),
    raw: () => output.join(''),
    /** Poll until the rendered output satisfies `predicate`. */
    async waitFor(predicate, { timeout = 8_000, interval = 10 } = {}) {
      const started = Date.now();
      for (;;) {
        const text = stripAnsi(output.join(''));
        if (predicate(text, output.join(''))) return true;
        if (Date.now() - started > timeout) {
          throw new Error(
            `timed out waiting for the UI. Last output:\n${text.slice(-800)}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    },
    restore() {
      process.stdout.write = originalWrite;
      for (const undo of restores.reverse()) undo();
    },
  };
}

export function press(name, extra = {}) {
  process.stdin.emit('keypress', extra.sequence ?? null, {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    ...extra,
  });
}

export function type(text) {
  process.stdin.emit('keypress', text, { name: undefined });
}
