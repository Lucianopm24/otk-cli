/**
 * Static panels used by the in-session commands (`/help`, `/account`,
 * `/credits`, `/models`, `/version`) and the unified error card.
 */

import { columns } from '../ui/out.js';
import { box } from '../ui/box.js';
import { bold, dim, faint, glyphs, mint, neon, neonSoft, error as errorPaint } from '../ui/theme.js';
import { padEnd, truncateStyled, visibleWidth, wrapStyled } from '../util/ansi.js';
import {
  creditsExact,
  creditsLabel,
  dateLabel,
  displayNameFromEmail,
  durationLabel,
} from '../format.js';
import { modelDetailCard } from './modelCards.js';
import { APP_NAME, ASSISTANT_NAME, VERSION, WEB_BASE_URL } from '../version.js';

export const INDENT = '  ';

function panelWidth(max = 62) {
  return Math.max(34, Math.min(columns() - 6, max));
}

function panel(title, content, options = {}) {
  const width = options.width ?? panelWidth(options.max ?? 62);
  const rows = [''];
  if (title) rows.push(INDENT + neon(glyphs.diamond) + ' ' + bold(title), '');
  rows.push(...box(content, { width, indent: INDENT, footer: options.footer }));
  rows.push('');
  return rows;
}

function field(label, value, inner) {
  const prefix = dim(padEnd(label, 10));
  const room = Math.max(4, inner - visibleWidth(prefix));
  return prefix + truncateStyled(value, room);
}

export function helpPanel() {
  const rows = [
    field('/help', 'Show this overview', 52),
    field('/models', 'Browse every available model', 52),
    field('/model', 'Switch the model in use', 52),
    field('/account', 'Account, credits and sessions', 52),
    field('/credits', 'Check your credit balance', 52),
    field('/clear', 'Clear this conversation', 52),
    field('/login', 'Sign in again', 52),
    field('/version', 'CLI version', 52),
    field('/exit', 'Leave OTK CLI', 52),
  ];
  return panel('Commands', rows, { max: 60 });
}

export function versionPanel() {
  const rows = [
    field('CLI', `${APP_NAME} v${VERSION}`, 52),
    field('Runtime', `Node ${process.version.replace(/^v/, '')}`, 52),
    field('Terminal', `${columns()} × ${process.stdout.rows || 24}`, 52),
    '',
    dim(`Official OpenTokens client · assistant: ${ASSISTANT_NAME}`),
  ];
  return panel('About', rows, { max: 58 });
}

export function accountPanel(account, options = {}) {
  const inner = panelWidth(options.max ?? 58) - 4;
  const email = account?.email || options.email || null;
  const name = email ? displayNameFromEmail(email) : 'there';
  const balance = options.balance ?? account?.balanceCredits ?? 0;
  const sessions = account?.sessions;
  const rows = [];
  rows.push(neon(glyphs.dot) + '  ' + bold(neonSoft(name)));
  if (email) rows.push(field('Email', dim(email), inner));
  rows.push(field('Credits', mint(creditsLabel(balance)), inner));
  if (sessions) {
    const active =
      sessions.activeNow && sessions.msRemaining > 0
        ? mint(`${glyphs.timer} ${durationLabel(sessions.msRemaining)} left`)
        : dim('none active');
    rows.push(field('Session', active, inner));
    rows.push(
      field(
        'Sessions',
        `${Number(sessions.remaining) || 0} of ${Number(sessions.perDay) || 0} left today`,
        inner,
      ),
    );
    if (!sessions.unlocked) {
      rows.push('');
      rows.push(...wrapStyled(
        `${glyphs.spark} Earn $0.01+ in Earn to unlock all ${sessions.perDay || 6} daily sessions.`,
        inner,
      ).map((text) => dim(text)));
    }
  }
  if (account?.createdAt) rows.push(field('Member', dim(dateLabel(account.createdAt)), inner));
  return panel('Account', rows, { max: 58 });
}

export function creditsPanel(balance, options = {}) {
  const width = panelWidth(48);
  const inner = width - 4;
  const rows = [
    '',
    centerStyled(mint(bold(creditsLabel(balance))), inner),
    centerStyled(dim('ready to spend'), inner),
    '',
  ];
  return panel('Credits', rows, {
    max: 48,
    footer: `manage at ${WEB_BASE_URL.replace(/^https?:\/\//, '')}`,
  });
}

function centerStyled(text, width) {
  const pad = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
  return ' '.repeat(pad) + text;
}

export function modelsPanel(models, currentId, options = {}) {
  const rows = [''];
  rows.push(INDENT + neon(glyphs.diamond) + ' ' + bold('Models'), '');
  models.forEach((model, index) => {
    const lines = modelDetailCard(model, {
      indent: INDENT,
      current: model.id === currentId,
      active: model.id === currentId,
    });
    rows.push(...lines);
    if (index < models.length - 1) rows.push('');
  });
  rows.push('');
  rows.push(INDENT + faint(`Use /model to switch · ${models.length} available`));
  rows.push('');
  return rows;
}

export function unknownCommandPanel(command) {
  const rows = [
    '',
    INDENT + errorPaint(glyphs.cross) + ' ' + errorPaint(`Unknown command: /${command}`),
    '',
    INDENT + dim('Send /help to see everything the CLI supports.'),
    '',
  ];
  return rows;
}

function hintsFor(error, context = {}) {
  const status = error?.status ?? 0;
  const hints = [];
  if (status === 401) {
    hints.push('Run /login to reconnect your account.');
  } else if (status === 402) {
    if (Number.isFinite(context.balance)) {
      hints.push(`Your balance right now is ${creditsExact(context.balance)}.`);
    }
    hints.push(`Add credits at ${WEB_BASE_URL.replace(/^https?:\/\//, '')}, or switch to a free model with /model.`);
  } else if (status === 429) {
    if (/pool|limited/i.test(String(error?.message || ''))) {
      // Pool exhausted on a limited-time model: informative, not an error to retry.
      hints.push('The limited-time pool is fully used right now. It does not reset — try a free or credits model with /model.');
    } else {
      hints.push('Free sessions reset every day. You can also switch to a credits model with /model.');
    }
  } else if (status === 423) {
    hints.push('That model is in maintenance. Pick another one with /model.');
  } else if (status === 0) {
    hints.push('Check your connection and send your message again.');
  }
  return hints;
}

/** Unified error card: ✕ message plus short, actionable hints. */
export function errorPanel(error, context = {}) {
  const width = panelWidth(66);
  const inner = width - 4;
  const message = String(error?.message || 'Something went wrong.');
  const hints = context.hints ?? hintsFor(error, context);
  const content = [];
  wrapStyled(message, Math.max(12, inner - 2)).forEach((text, index) => {
    content.push((index === 0 ? errorPaint(glyphs.cross) + ' ' : '  ') + errorPaint(text));
  });
  if (hints.length) {
    content.push('');
    for (const hint of hints) {
      for (const text of wrapStyled(hint, Math.max(12, inner))) content.push(dim(text));
    }
  }
  return ['', ...box(content, { width, indent: INDENT }), ''];
}


