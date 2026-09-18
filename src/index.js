/**
 * Entry point. Flags are parsed before any UI module is imported because the
 * theme decides its colour level at import time.
 */

const KNOWN_FLAGS = new Set([
  '--help',
  '-h',
  '--version',
  '-v',
  '-V',
  '--no-color',
  '--plain',
  '--ascii',
  '--conhost',
]);

const argv = process.argv.slice(2);
const has = (...names) => names.some((name) => argv.includes(name));

if (has('--ascii')) process.env.OTK_ASCII = '1';
if (has('--no-color', '--plain')) process.env.OTK_NO_COLOR = '1';

// Classic Windows console (cmd/PowerShell under conhost) cannot handle the
// alternate screen buffer; opt out with --conhost for terminal types that
// do support it but are not auto-detected (e.g. Alacritty, WezTerm).
if (has('--conhost')) process.env.OTK_NO_ALT_SCREEN = '1';

const unknown = argv.filter((arg) => !KNOWN_FLAGS.has(arg));

async function boot() {
  if (has('--version', '-v', '-V')) {
    const { VERSION } = await import('./version.js');
    process.stdout.write(VERSION + '\n');
    return;
  }

  if (has('--help', '-h')) {
    const { printHelp } = await import('./help.js');
    printHelp();
    return;
  }

  const { runApp, restoreTerminal } = await import('./app.js');

  if (unknown.length > 0) {
    const { glyphs, neon, dim } = await import('./ui/theme.js');
    process.stdout.write(
      '\n  ' +
        neon(glyphs.diamond) +
        ' ' +
        dim('OTK CLI runs entirely inside the interactive session — starting it for you.') +
        '\n\n',
    );
  }

  process.on('SIGINT', () => {
    restoreTerminal();
    process.exit(130);
  });

  const code = await runApp({ unknownArgs: unknown });
  if (typeof code === 'number') process.exitCode = code;
}

boot().catch(async (error) => {
  try {
    const { restoreTerminal } = await import('./app.js');
    restoreTerminal();
  } catch {
    /* ignore */
  }
  process.stderr.write(
    '\n  \u2715 Unexpected error: ' + (error?.stack || String(error)) + '\n\n',
  );
  process.exitCode = 1;
});
