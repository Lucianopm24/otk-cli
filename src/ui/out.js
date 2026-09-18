/**
 * Thin wrapper around stdout/stdin so the rest of the UI never touches
 * process streams directly (and so tests can redirect output).
 */

export const stdout = process.stdout;
export const stdin = process.stdin;

export const isTTY = () => Boolean(process.stdout.isTTY);
export const isInteractive = () =>
  Boolean(process.stdout.isTTY && process.stdin.isTTY);

export const columns = () => Math.max(20, process.stdout.columns || 80);
export const rows = () => Math.max(6, process.stdout.rows || 24);

export function write(chunk) {
  process.stdout.write(chunk);
}

export function line(text = '') {
  process.stdout.write(text + '\n');
}

export function lines(list) {
  if (!list || list.length === 0) return;
  process.stdout.write(list.join('\n') + '\n');
}

export function blank(count = 1) {
  if (count > 0) process.stdout.write('\n'.repeat(count));
}

/** Write a block of rows surrounded by breathing space. */
export function section(blockRows, { before = 1, after = 1 } = {}) {
  blank(before);
  lines(blockRows);
  blank(after);
}

let altScreenActive = false;

/**
 * Windows Terminal and VS Code's terminal fully support the alternate screen
 * buffer, but the classic Windows console (conhost: cmd/PowerShell) does not —
 * there the escape codes would print as garbage and break the whole UI.
 */
function supportsAltScreen() {
  if (!isTTY()) return false;
  if (process.env.OTK_NO_ALT_SCREEN === '1') return false;
  if (process.platform !== 'win32') return true;
  return Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM === 'vscode');
}

let canUseAltScreen = supportsAltScreen();

/**
 * Switch to the terminal's alternate screen buffer: the app gets a fresh,
 * empty canvas (nothing from before is visible) and nothing it prints ever
 * leaks into the scrollback, so scrolling up shows the user's own history.
 * On consoles without support it degrades to a plain clear.
 */
export function enterAltScreen() {
  if (!isTTY() || altScreenActive) return;
  altScreenActive = true;
  if (canUseAltScreen) write('\u001b[?1049h\u001b[2J\u001b[H');
  else write('\u001b[2J\u001b[H');
}

/** Leave the alternate screen, restoring whatever was on the terminal. */
export function leaveAltScreen() {
  if (!altScreenActive) return;
  altScreenActive = false;
  if (canUseAltScreen) write('\u001b[?1049l');
}

export function clearScreen() {
  if (isTTY()) {
    write('\u001b[2J\u001b[H');
    // only touch the scrollback where it is actually supported
    if (canUseAltScreen) write('\u001b[3J');
  } else write('\n'.repeat(2));
}

export function hideCursor() {
  if (isTTY()) write('\u001b[?25l');
}

export function showCursor() {
  if (isTTY()) write('\u001b[?25h');
}
