/**
 * `otk-cli --help`: a short page that points at the interactive session
 * instead of advertising a pile of subcommands.
 */

import { blank, line } from './ui/out.js';
import { renderBanner } from './ui/banner.js';
import { bold, dim, glyphs, neon, neonSoft } from './ui/theme.js';
import { helpPanel } from './screens/panels.js';
import { ASSISTANT_NAME, BIN_NAME, VERSION } from './version.js';

function row(command, description) {
  const padding = ' '.repeat(Math.max(1, 22 - command.length));
  line('  ' + neon(command) + padding + dim(description));
}

export function printHelp() {
  for (const bannerRow of renderBanner({})) line(bannerRow);
  line('  ' + dim('OpenTokens in your terminal — a chat, not a command collection.'));
  blank(1);
  line('  ' + bold('Usage'));
  blank(1);
  row('otk-cli', 'start the interactive session');
  row('otk-cli --version', `print the version (v${VERSION})`);
  row('otk-cli --help', 'show this page');
  row('otk-cli --no-color', 'disable colour for this run');
  row('otk-cli --ascii', 'use plain ASCII borders and glyphs');
  blank(1);
  line(
    '  ' +
      dim('Signing in, picking a model, checking your account and quitting all happen'),
  );
  line('  ' + dim(`inside the session — just run ${neonSoft(BIN_NAME)} and talk to ${ASSISTANT_NAME}.`));
  for (const panelRow of helpPanel()) line(panelRow);
  line('  ' + dim(glyphs.diamond + ' Documentation: https://opentokens.is-so.pro'));
  blank(1);
}
