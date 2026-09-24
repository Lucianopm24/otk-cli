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

function panelWidth() {
  // Full terminal width (minus the chat indent) so nothing is ever cut off.
  return Math.max(34, (columns() || 80) - INDENT.length);
}

function panel(title, content, options = {}) {
  const width = options.width ?? panelWidth();
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
  const inner = panelWidth() - 4;
  const rows = [
    field('/help', 'Show this overview', inner),
    field('/models', 'Browse every available model', inner),
    field('/model', 'Switch the model in use', inner),
    field('/account', 'Account, credits and sessions', inner),
    field('/credits', 'Check your credit balance', inner),
    field('/clear', 'Clear this conversation', inner),
    field('/history', 'Saved conversations (open/delete/clear)', inner),
    field('/login', 'Sign in again', inner),
    field('/version', 'CLI version', inner),
    field('/exit', 'Leave OTK CLI', inner),
  ];
  return panel('Commands', rows);
}

export function versionPanel() {
  const inner = panelWidth() - 4;
  const rows = [
    field('CLI', `${APP_NAME} v${VERSION}`, inner),
    field('Runtime', `Node ${process.version.replace(/^v/, '')}`, inner),
    field('Terminal', `${columns()} × ${process.stdout.rows || 24}`, inner),
    '',
    dim(`Official OpenTokens client · assistant: ${ASSISTANT_NAME}`),
  ];
  return panel('About', rows);
}

export function accountPanel(account, options = {}) {
  const inner = panelWidth() - 4;
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
    const remaining = Number(sessions.remaining) || 0;
    const perDay = Number(sessions.perDay) || 0;
    const bonus = Number(sessions.bonusSessions) || 0;
    rows.push(
      field(
        'Sessions',
        `${remaining}/${perDay} today${bonus > 0 ? ` — ${bonus} bonus` : ''}`,
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
  return panel('Account', rows);
}

export function creditsPanel(credits, options = {}) {
  const width = panelWidth();
  const inner = width - 4;
  // Accept either the full payload or a bare number.
  const balance = typeof credits === 'object' && credits !== null ? credits.balance : credits;
  const daily = typeof credits === 'object' && credits !== null ? credits.dailyCredits : 0;
  const total =
    typeof credits === 'object' && credits !== null
      ? credits.totalSpendable
      : Number(credits) || 0;
  const rows = [
    '',
    centerStyled(mint(bold(creditsLabel(total))), inner),
    centerStyled(dim('ready to spend'), inner),
  ];
  if (daily > 0) {
    rows.push('');
    rows.push(
      centerStyled(
        dim(`${creditsLabel(daily)} are today's free credits · ${creditsLabel(balance)} balance`),
        inner,
      ),
    );
  }
  rows.push('');
  return panel('Credits', rows, {
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
  const width = panelWidth();
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


