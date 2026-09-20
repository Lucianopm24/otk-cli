/**
 * Unauthenticated state: a dedicated setup screen, then the browser login
 * flow. The CLI creates the code, opens the browser and polls until the user
 * approves — no codes are ever copied by hand.
 */

import readline from 'node:readline';
import { blank, clearScreen, columns, isInteractive, line, stdin } from '../ui/out.js';
import { center } from '../util/ansi.js';
import { box } from '../ui/box.js';
import { renderBanner } from '../ui/banner.js';
import { createSpinner } from '../ui/spinner.js';
import {
  bold,
  dim,
  faint,
  glyphs,
  neon,
  neonSoft,
  error as errorPaint,
  underline,
} from '../ui/theme.js';
import { wrapStyled } from '../util/ansi.js';
import { openBrowser } from '../util/browser.js';
import { ApiError } from '../api.js';
import { displayNameFromEmail, durationLabel } from '../format.js';
import { saveAuth, savePrefs } from '../config.js';
import { APP_NAME, BIN_NAME, WEB_BASE_URL } from '../version.js';

const POLL_INTERVAL_MS = 2_500;
const INDENT = '  ';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setupKeyHandler(handler) {
  readline.emitKeypressEvents(stdin);
  if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
  stdin.resume();
  stdin.on('keypress', handler);
  return () => stdin.removeListener('keypress', handler);
}

export function renderSetupScreen(notice = null, options = {}) {
  const cols = columns();
  const width = Math.max(40, Math.min(48, cols - 8));
  const inner = width - 4;
  const rows = [];
  if (options.banner === false) {
    // re-authentication in the middle of a conversation: no full banner
    rows.push('', INDENT + neon(glyphs.diamond) + ' ' + bold(`${APP_NAME} · sign-in required`), '');
  } else {
    rows.push(...renderBanner({ columns: cols }));
  }
  if (notice) {
    rows.push(center(dim(notice), cols));
    rows.push('');
  }
  rows.push(center(bold(neonSoft('Welcome.')), cols));
  rows.push('');
  rows.push(center(dim("Let's get you set up."), cols));
  rows.push('');
  const button = neon('[ ') + bold(neonSoft('Sign in')) + neon(' ]');
  rows.push(
    ...box(
      [
        '',
        center(bold(neonSoft('Sign in to OTK CLI')), inner),
        '',
        center(dim('Connect your OpenTokens'), inner),
        center(dim('account to continue.'), inner),
        '',
        center(button, inner),
        '',
      ],
      { width, indent: '' },
    ).map((row) => center(row, cols)),
  );
  rows.push('');
  rows.push(center(faint('Enter to sign in  ·  Ctrl+C to exit'), cols));
  rows.push('');
  return rows;
}

function renderCodeScreen({ code, loginUrl, opened }) {
  const cols = columns();
  const width = Math.max(44, Math.min(64, cols - 8));
  const inner = width - 4;
  const spaced = code.split('').join(' ');
  const rows = ['', INDENT + neon(glyphs.ok) + ' ' + bold(neonSoft('Login code created.')), ''];
  rows.push(
    ...box(
      [
        '',
        center(dim('Y O U R  O N E - T I M E  C O D E'), inner),
        '',
        center(bold(neon(spaced)), inner),
        '',
        center(dim('the code is valid for 10 minutes'), inner),
        '',
      ],
      { width, indent: INDENT, title: 'Sign in requires one approval' },
    ),
  );
  rows.push('');
  rows.push(
    INDENT +
      dim(opened ? 'Approve the login in the browser we just opened:' : 'Open this link to approve the login:'),
  );
  rows.push('');
  rows.push(INDENT + underline(neonSoft(loginUrl)));
  rows.push('');
  rows.push(
    INDENT +
      faint(`No browser? Visit ${WEB_BASE_URL.replace(/^https?:\/\//, '')}/cli/login and enter ${code}`),
  );
  rows.push('');
  return rows;
}

export function successLines(name) {
  return [
    '',
    INDENT + neon(glyphs.ok) + ' ' + bold(neonSoft('Successfully signed in.')),
    '',
    INDENT + 'Welcome back, ' + bold(name) + '.',
    '',
  ];
}

export function errorLines(message, hints = []) {
  const rows = ['', INDENT + errorPaint(glyphs.cross) + ' ' + errorPaint(message)];
  for (const hint of hints) {
    for (const text of wrapStyled(hint, columns() - 6)) rows.push(INDENT + dim(text));
  }
  rows.push('');
  return rows;
}

function waitForStart() {
  return new Promise((resolve) => {
    const remove = setupKeyHandler((str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        remove();
        resolve('cancel');
        return;
      }
      if (key.name === 'escape') {
        remove();
        resolve('cancel');
        return;
      }
      if (key.name === 'return' || key.name === 'enter' || str === ' ') {
        remove();
        resolve('start');
      }
    });
  });
}

/**
 * Runs the whole unauthenticated flow.
 * @returns {Promise<{token: string, expiresAt: number|null, email: string|null, account: object|null}|null>}
 */
export async function runSetup({ api, notice = null, banner = true, clear = true } = {}) {
  if (!isInteractive()) {
    line('');
    line(INDENT + errorPaint(glyphs.cross) + ' ' + errorPaint('Not signed in.'));
    line(INDENT + dim(`Run ${BIN_NAME} in an interactive terminal and press Enter to sign in.`));
    line('');
    return null;
  }

  for (;;) {
    if (clear) clearScreen();
    for (const row of renderSetupScreen(notice, { banner })) line(row);
    const action = await waitForStart();
    if (action === 'cancel') return null;

    const outcome = await runLoginFlow({ api, banner });
    if (outcome === 'retry') {
      notice = 'The login code expired. Requesting a new one.';
      continue;
    }
    if (outcome === 'cancel') return null;
    return outcome;
  }
}

async function runLoginFlow({ api, banner = true }) {
  const spinner = createSpinner({ label: 'Creating a secure login code…' });
  if (banner) clearScreen();
  blank(1);
  spinner.start();
  let session;
  try {
    session = await api.sign();
  } catch (error) {
    spinner.stop();
    for (const row of errorLines(
      error?.message || 'Could not start the login flow.',
      error instanceof ApiError && error.status === 0
        ? ['Check your connection, then run OTK CLI again.']
        : ['Try again in a moment.'],
    )) {
      line(row);
    }
    const action = await waitForStart();
    return action === 'start' ? runLoginFlow({ api, banner }) : 'cancel';
  }
  spinner.stop();

  const opened = process.env.OTK_NO_BROWSER === '1' ? false : await openBrowser(session.loginUrl);
  for (const row of renderCodeScreen({ ...session, opened })) line(row);

  const watcher = { cancelled: false };
  const remove = setupKeyHandler((str, key = {}) => {
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) watcher.cancelled = true;
  });

  const deadline = Math.min(session.expiresAt, Date.now() + 10 * 60 * 1000);
  const waiting = createSpinner({
    label: () =>
      `Waiting for your approval · code expires in ${durationLabel(deadline - Date.now())}  ·  Esc to cancel`,
  });
  waiting.start();

  let result = null;
  let failure = null;
  try {
    while (Date.now() < deadline) {
      if (watcher.cancelled) break;
      await sleep(POLL_INTERVAL_MS);
      if (watcher.cancelled) break;
      try {
        const exchanged = await api.exchange({ code: session.code, secret: session.secret });
        if (exchanged.pending) continue;
        result = exchanged;
        break;
      } catch (error) {
        const message = String(error?.message || '');
        if (/invalid code/i.test(message) || /invalid secret/i.test(message)) {
          failure = 'This login code is no longer valid.';
          break;
        }
        if (error instanceof ApiError && error.status === 0) {
          continue; // transient network hiccup, keep polling
        }
        failure = message || 'The login could not be completed.';
        break;
      }
    }
    if (!result && !failure && !watcher.cancelled) {
      failure = `The login code expired (10 minutes).`;
    }
  } finally {
    waiting.stop();
    remove();
  }

  if (watcher.cancelled) {
    line('');
    line(INDENT + dim('Sign-in cancelled.'));
    line('');
    return 'cancel';
  }
  if (failure) {
    for (const row of errorLines(failure, ['Press Enter to request a new login code.'])) line(row);
    const action = await waitForStart();
    return action === 'start' ? runLoginFlow({ api, banner }) : 'cancel';
  }

  saveAuth({ token: result.token, expiresAt: result.expiresAt });

  const connectSpinner = createSpinner({ label: 'Loading your account…' });
  connectSpinner.start();
  let account = null;
  try {
    account = await api.account(result.token);
  } catch {
    account = null;
  }
  connectSpinner.stop();
  if (account?.email) savePrefs({ email: account.email });

  const name = account?.email ? displayNameFromEmail(account.email) : 'there';
  for (const row of successLines(name)) line(row);

  return {
    token: result.token,
    expiresAt: result.expiresAt,
    email: account?.email ?? null,
    account,
  };
}
