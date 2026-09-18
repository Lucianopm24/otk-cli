/**
 * A discreet single-line spinner. It paints on the current line only and
 * erases itself when stopped, so it never dirties the transcript.
 */

import { isTTY, write } from './out.js';
import { dim, glyphs, neon } from './theme.js';

export function createSpinner(options = {}) {
  const interval = options.interval ?? 80;
  const indent = options.indent ?? '  ';
  let timer = null;
  let frame = 0;
  let label = options.label ?? (() => 'Working');
  let printed = false;

  const text = () => (typeof label === 'function' ? label() : label);

  function paint() {
    const spin = glyphs.spinner[frame % glyphs.spinner.length];
    write('\r\u001b[2K' + indent + neon(spin) + ' ' + dim(text()));
    frame += 1;
  }

  return {
    start(nextLabel) {
      if (nextLabel !== undefined) label = nextLabel;
      if (!isTTY()) return this;
      if (timer) return this;
      frame = 0;
      paint();
      printed = true;
      timer = setInterval(paint, interval);
      if (timer.unref) timer.unref();
      return this;
    },
    setLabel(nextLabel) {
      label = nextLabel;
      if (isTTY() && timer) paint();
      return this;
    },
    /** Stop and erase the spinner line. */
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (printed && isTTY()) write('\r\u001b[2K');
      printed = false;
      return this;
    },
    /** Stop and leave the label on screen as a permanent line. */
    settle(suffix = '') {
      const message = text();
      this.stop();
      if (message) write(indent + dim(message + suffix) + '\n');
      return this;
    },
    get active() {
      return timer !== null;
    },
  };
}
