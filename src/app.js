/**
 * OTK CLI top level flow:
 *   banner -> (setup/login when needed) -> choose model -> chat
 * Falling back to setup happens automatically whenever the stored token is
 * rejected or expires.
 */

import {
  blank,
  clearScreen,
  enterAltScreen,
  isInteractive,
  leaveAltScreen,
  line,
  showCursor,
  stdin,
} from './ui/out.js';
import { renderBanner } from './ui/banner.js';
import { createPrompt } from './ui/prompt.js';
import { createSpinner } from './ui/spinner.js';
import { selectModel } from './ui/select.js';
import { errorPanel } from './screens/panels.js';
import { runSetup } from './screens/setup.js';
import { printFarewell, runChat, syncSession } from './screens/chat.js';
import { createApi, TokenExpiredError, ApiError } from './api.js';
import { anchorLimitedSession, applyLimitedModels } from './util/limitedSession.js';
import { clearAuth, loadAuth, loadPrefs, savePrefs, tokenExpired } from './config.js';
import { bold, dim, faint, glyphs, neon, neonSoft, warn } from './ui/theme.js';
import { APP_NAME, ASSISTANT_NAME, VERSION } from './version.js';
import { classifyVersion, fetchLatestVersion, installVersion } from './update.js';
import readline from 'node:readline';

const INDENT = '  ';

/**
 * Ask a yes/no question with raw keypresses (y/n/Enter/Esc). Resolves
 * `true` only for an affirmative answer.
 */
function confirmPrompt(question) {
  return new Promise((resolve) => {
    line(INDENT + bold(question) + dim('  [y/N]'));
    readline.emitKeypressEvents(stdin);
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    stdin.resume();
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        resolve(false);
        return;
      }
      cleanup();
      const answer = String(str ?? '').toLowerCase();
      resolve(answer === 'y' || answer === 's' || answer === 'yes' || answer === 'si');
    };
    const cleanup = () => {
      stdin.removeListener('keypress', onKey);
    };
    stdin.on('keypress', onKey);
  });
}

/**
 * Version gate: runs once before anything else. Older than the backend's
 * stable means the user MUST update; newer means they are on a beta build.
 * A failed check (offline, endpoint missing) never blocks the CLI.
 */
async function runVersionGate() {
  const latest = await fetchLatestVersion();
  const verdict = classifyVersion(VERSION, latest);

  if (verdict === 'ok') return { proceed: true, beta: false };

  if (verdict === 'update-required') {
    for (;;) {
      clearScreen();
      const rows = [
        '',
        INDENT + neon(glyphs.diamond) + ' ' + bold(neonSoft('Update required')),
        '',
        INDENT + `Your ${APP_NAME} is v${VERSION}, but the latest version is v${latest}.`,
        INDENT + dim('You must update before you can continue.'),
        '',
        INDENT + dim('Run:') + ' ' + bold('npm i -g opentokens-cli'),
        '',
      ];
      for (const row of rows) line(row);
      if (await confirmPrompt('Install it now?')) {
        const ok = await installVersion(null, {
          onLine: (text) => line(INDENT + faint(text.slice(0, (process.stdout.columns || 80) - 4))),
        });
        if (ok) {
          line('');
          line(INDENT + neon(glyphs.ok) + ' ' + bold('Updated successfully.'));
          line(INDENT + dim(`Restarting ${APP_NAME}…`));
          return { proceed: false, beta: false }; // exit: fresh version takes over
        }
        line('');
        line(INDENT + warn(glyphs.cross) + ' ' + warn('The install failed. Update manually and try again.'));
      }
      // Either the user declined or the install failed: offer to retry by
      // looping (mandatory means mandatory), or let them exit cleanly.
      line('');
      if (!(await confirmPrompt('Try again?'))) {
        line('');
        line(INDENT + dim('Update with ') + bold('npm i -g opentokens-cli') + dim(' and run otk-cli again.'));
        return { proceed: false, beta: false };
      }
    }
  }

  // verdict === 'beta': newer than the backend's stable version.
  for (;;) {
    clearScreen();
    const rows = [
      '',
      INDENT + warn(glyphs.spark) + ' ' + bold(warn('BETA version')),
      '',
      INDENT + `You are running ${APP_NAME} v${VERSION}, newer than the stable v${latest}.`,
      INDENT + dim('Beta builds may have errors or unfinished features.'),
      '',
    ];
    for (const row of rows) line(row);
    if (await confirmPrompt('Continue in beta anyway?')) {
      return { proceed: true, beta: true }; // the caller shows the beta tag
    }
    line('');
    line(INDENT + dim('Installing the stable version…')); 
    const ok = await installVersion(latest, {
      onLine: (text) => line(INDENT + faint(text.slice(0, (process.stdout.columns || 80) - 4))),
    });
    if (ok) {
      line(INDENT + neon(glyphs.ok) + ' ' + bold('Stable version installed.'));
      line(INDENT + dim(`Restarting ${APP_NAME}…`));
      return { proceed: false, beta: false }; // exit: stable takes over
    }
    line('');
    line(INDENT + warn(glyphs.cross) + ' ' + warn('The install failed.'));
    if (!(await confirmPrompt('Continue in beta anyway?'))) {
      return { proceed: false, beta: false };
    }
    return { proceed: true, beta: true };
  }
}

export function restoreTerminal() {
  showCursor();
  leaveAltScreen();
  try {
    if (stdin.isTTY) stdin.setRawMode(false);
  } catch {
    /* ignore */
  }
}

function finish(state) {
  restoreTerminal();
  if (isInteractive()) printFarewell(state);
  return 0;
}

async function withSpinner(label, task) {
  const spinner = createSpinner({ label });
  spinner.start();
  try {
    return await task();
  } finally {
    spinner.stop();
  }
}

/**
 * @param {object} [options]
 * @param {object} [options.api]        pre-built API client (used by tests)
 * @param {object} [options.apiOptions] options forwarded to `createApi`
 * @param {string[]} [options.unknownArgs]
 * @returns {Promise<number>} process exit code
 */
export async function runApp(options = {}) {
  const api = options.api || createApi(options.apiOptions);
  const prompt = createPrompt();
  const state = {
    auth: null,
    models: [],
    model: null,
    account: null,
    balance: null,
    session: { endAt: null, startedAt: null },
    history: [],
    busy: false,
    limited: { session: null, receivedAt: null, models: [] },
  };

  const prefs = loadPrefs();

  if (isInteractive()) {
    // The whole app lives in the alternate screen buffer: it starts blank,
    // screens replace each other instead of stacking, and scrolling up only
    // ever shows the user's own terminal history.
    enterAltScreen();
    clearScreen();
  }

  // Version gate: mandatory update when older than the backend's stable,
  // beta notice when newer. `false` means the process must exit (either an
  // update was just installed, or the user chose not to continue).
  let isBeta = false;
  // Skipped when an API client is injected (tests) or the check is disabled.
  const gateEnabled = isInteractive() && !options.api && process.env.OTK_NO_VERSION_CHECK !== '1';
  if (gateEnabled) {
    const gate = await runVersionGate();
    if (!gate.proceed) {
      restoreTerminal();
      return 0;
    }
    isBeta = gate.beta;
  }

  let notice = null;
  if (isBeta) {
    notice = `Beta build v${VERSION}: you may run into errors. Install the stable with npm i -g opentokens-cli.`;
  }
  // true when a session expires while chatting: the setup screen then
  // reappears without wiping the conversation off the screen
  let midSession = false;
  let stored = loadAuth();
  if (stored && tokenExpired(stored)) {
    clearAuth();
    stored = null;
    notice = 'Your previous session expired.';
  }
  if (stored) {
    state.auth = stored;
    // The banner now lives on the model-picker screen, so a known session
    // does not need to paint anything before it.
  }

  const showScreen = (render) => {
    // every screen replaces the previous one: clear, then draw fresh
    if (isInteractive()) clearScreen();
    render();
  };

  for (;;) {
    if (!state.auth) {
      showScreen(() => {});
      const session = await runSetup(
        midSession ? { api, notice, banner: false, clear: true } : { api, notice, clear: true },
      );
      notice = null;
      midSession = false;
      if (!session) return finish(state);
      state.auth = {
        token: session.token,
        expiresAt: session.expiresAt,
        email: session.email,
      };
      if (session.account) syncSession(state, session.account);
      if (session.email) savePrefs({ email: session.email });
    }

    let models;
    try {
      models = await withSpinner('Fetching available models…', () => api.models(state.auth.token));
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        state.auth = null;
        clearAuth();
        notice = 'Your session expired.';
        continue;
      }
      blank(1);
      for (const row of errorPanel(error, {})) line(row);
      return 1;
    }
    // Limited-time pool data is additive: if the endpoint fails or the
    // backend does not ship it yet, the plain model list still works.
    try {
      const limited = await api.limitedModels(state.auth.token);
      models = applyLimitedModels(models, limited);
    } catch {
      /* cosmetic only: limited badges just don't render */
    }
    if (models.length === 0) {
      blank(1);
      for (const row of ['', '  ' + faint('No models are available right now. Try again in a moment.'), '']) {
        line(row);
      }
      return 1;
    }
    state.models = models;
    showScreen(() => {});

    const remembered = state.model?.id || prefs.lastModel || null;
    // First run: the OTK banner lives on the same screen as the model picker.
    const header = state.model
      ? null
      : [...renderBanner({ beta: isBeta }), '  ' + neon(glyphs.diamond) + ' ' + bold(neonSoft(APP_NAME)) + (isBeta ? warn(' BETA') : '') + dim(` · ${ASSISTANT_NAME} in your terminal`), ''];
    const chosen = await selectModel({
      api,
      models,
      currentId: state.model?.id || null,
      preferredId: remembered,
      title: state.model ? 'Choose a model' : 'Choose a model',
      header,
    });
    if (!chosen) return finish(state);
    state.model = chosen;
    savePrefs({ lastModel: chosen.id });
    showScreen(() => {});

    if (!state.account) {
      try {
        const account = await withSpinner('Loading your account…', () => api.account(state.auth.token));
        syncSession(state, account);
      } catch (error) {
        if (error instanceof TokenExpiredError) {
          state.auth = null;
          clearAuth();
          notice = 'Your session expired.';
          continue;
        }
        if (!(error instanceof ApiError)) throw error;
        // Non-fatal: the chat still works, /account can retry later.
      }
    }

    // Re-anchor any active limited-time session for the countdown.
    try {
      anchorLimitedSession(state, await api.limitedBonus(state.auth.token));
    } catch {
      /* cosmetic only */
    }

    const outcome = await runChat({ api, state, prompt });
    if (outcome === 'exit') return finish(state);
    if (outcome === 'relogin') {
      state.auth = null;
      state.account = null;
      clearAuth();
      notice = 'Your session expired.';
      midSession = true;
      continue;
    }
  }
}
