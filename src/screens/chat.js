/**
 * The chat itself. `You:` messages get a neon gutter, `Toeky:` replies are
 * plain rendered markdown, and everything technical (stream internals, token
 * counts) stays out of the way in a single faint meta line.
 */

import { blank, clearScreen, line, section } from '../ui/out.js';
import { createLiveMarkdown } from '../ui/live.js';
import { createSpinner } from '../ui/spinner.js';
import { selectModel } from '../ui/select.js';
import { wrapStyled, padEnd, repeat, truncateStyled } from '../util/ansi.js';
import { bold, dim, faint, glyphs, mint, neon, neonSoft, warn } from '../ui/theme.js';
import { TokenExpiredError } from '../api.js';
import { savePrefs } from '../config.js';
import {
  creditsExact,
  creditsLabel,
  durationLabel,
  displayNameFromEmail,
  modelDisplayName,
  tokensLabel,
} from '../format.js';
import { renderMarkdown, renderMarkdownEx } from '../ui/markdown.js';
import { columns } from '../ui/out.js';
import { authorizeTool } from '../ui/authorize.js';
import { TranscriptScroller } from '../ui/scroller.js';
import {
  buildToolPreview,
  executeTool,
  extractToolCalls,
  maskToolStream,
  toolDeclarations,
} from '../tools.js';
import { chatModelCard, modelWarningLines } from './modelCards.js';
import {
  INDENT,
  accountPanel,
  creditsPanel,
  errorPanel,
  helpPanel,
  modelsPanel,
  unknownCommandPanel,
  versionPanel,
} from './panels.js';
import { runSetup } from './setup.js';
import { APP_NAME, ASSISTANT_NAME } from '../version.js';

const PAINT_INTERVAL_MS = 55;
const HISTORY_LIMIT = 40;

function print(rows) {
  for (const row of rows) line(row);
}

/** `line()` + journal into the scrollback transcript. */
function lineTracked(scroller, text = '') {
  line(text);
  scroller?.append(text);
}

/**
 * Keep the last HISTORY_LIMIT messages, but tool results (role "tool") ride
 * along for free: they never consume slots from the context window.
 */
function trimHistory(history) {
  const counted = history.filter((m) => m.role !== 'tool');
  if (counted.length <= HISTORY_LIMIT) return history;
  const cutoff = counted[counted.length - HISTORY_LIMIT];
  const start = history.indexOf(cutoff);
  return start > 0 ? history.slice(start) : history;
}

export function sessionRemaining(state) {
  const endAt = state.session?.endAt;
  if (!endAt) return 0;
  return Math.max(0, endAt - Date.now());
}

export function syncSession(state, account) {
  if (!account) return;
  state.account = account;
  if (Number.isFinite(Number(account.balanceCredits))) {
    state.balance = Number(account.balanceCredits);
  }
  const sessions = account.sessions;
  if (!sessions) return;
  const startedAt = state.session?.startedAt ?? null;
  if (sessions.activeNow && Number(sessions.msRemaining) > 0) {
    state.session = {
      endAt: Date.now() + Number(sessions.msRemaining),
      startedAt: startedAt ?? (state.session?.endAt ? null : Date.now()),
    };
  } else {
    state.session = { endAt: null, startedAt: null };
  }
}

export function accountSummary(state) {
  const parts = [];
  const email = state.account?.email || state.auth?.email || null;
  if (email) parts.push(neon(glyphs.dot) + ' ' + neonSoft(displayNameFromEmail(email)));
  if (Number.isFinite(Number(state.balance))) {
    parts.push(mint(glyphs.diamond + ' ' + creditsLabel(state.balance)));
  }
  const sessions = state.account?.sessions;
  if (sessions) {
    const active = sessions.activeNow && Number(sessions.msRemaining) > 0;
    const label = active
      ? `session ${durationLabel(sessions.msRemaining)} left`
      : `${Number(sessions.remaining) || 0} session${Number(sessions.remaining) === 1 ? '' : 's'} remaining`;
    parts.push(faint(glyphs.clock + ' ' + label));
  }
  return parts.join('   ');
}

export function statusLine(state) {
  const model = state.model;
  if (!model) return faint('no model selected');
  const parts = [neon(glyphs.bullet) + ' ' + neonSoft(modelDisplayName(model.id))];
  if (model.usesSessions) {
    const left = sessionRemaining(state);
    parts.push(left > 0 ? mint(glyphs.timer + ' ' + durationLabel(left)) : faint('daily sessions'));
  } else if (model.free) {
    parts.push(faint('Free'));
  } else if (Number.isFinite(Number(state.balance))) {
    parts.push(mint(glyphs.diamond + ' ' + creditsLabel(state.balance)));
  }
  return parts.join(dim('  ·  '));
}

function printUserMessage(text) {
  const width = Math.max(20, (process.stdout.columns || 80) - 8);
  line(INDENT + dim('You:'));
  for (const row of wrapStyled(text, width)) {
    line(INDENT + neon(glyphs.bar) + ' ' + row);
  }
}

function printUsageLine(state, usage) {
  const model = state.model;
  const parts = [];
  if (model?.usesSessions) {
    const left = sessionRemaining(state);
    if (left > 0) parts.push(`free session · ${durationLabel(left)} left`);
  } else if (model?.free) {
    parts.push('free');
  } else if (usage && Number.isFinite(Number(usage.creditsDeducted))) {
    parts.push(`${creditsExact(usage.creditsDeducted)} credits`);
  }
  const tokens = tokensLabel(usage);
  if (tokens) parts.push(tokens);
  if (parts.length) line(INDENT + faint(parts.join('  ·  ')));
}

/** Streaming replies carry no usage: settle the exact spend from the API. */
async function refreshBalanceAfterStream(state, api) {
  if (!state.model || state.model.usesSessions || state.model.free) return;
  try {
    state.balance = await api.credits(state.auth.token);
  } catch {
    /* cosmetic only: never fail the turn over a balance refresh */
  }
}

function printSessionStarted(ms) {
  section(
    [
      INDENT + neon(glyphs.bullet) + ' ' + bold(neonSoft('Free session started')),
      INDENT + mint(glyphs.timer + ' ' + durationLabel(ms) + ' remaining'),
    ],
    { before: 1, after: 1 },
  );
}

function printSessionEnded() {
  section([INDENT + faint(glyphs.timer + ' Free session ended.')], { before: 1, after: 0 });
  blank(1);
}

export function renderChatIntro(state) {
  section(chatModelCard(state.model), { before: 1, after: 0 });
  const summary = accountSummary(state);
  if (summary) line(INDENT + summary);
  blank(1);
  line(INDENT + faint(`Ask ${ASSISTANT_NAME} anything. Type /help for commands.`));
  blank(1);
}

export function printFarewell(state) {
  blank(1);
  line(INDENT + neon(glyphs.diamond) + ' ' + bold(`Thanks for using ${APP_NAME}.`));
  const summary = accountSummary(state);
  if (summary) line(INDENT + summary);
  blank(1);
}

/**
 * OpenAds card: additive-only render after the model's reply. The ad is
 * always labeled, framed in its own box, and a failed/missing ad renders
 * nothing at all. Any open composer is erased first and redrawn after so
 * the card never lands inside the input box.
 */
function printAdCard(ad, { scroller, prompt } = {}) {
  if (!ad) return;
  prompt?.erase?.();
  const width = Math.min(56, Math.max(28, columns() - INDENT.length - 2));
  const inner = width - 4;
  const url = ad.url ? link(ad.url, ad.url) : null;
  const body = [
    faint('📢 AD'),
    bold(truncateStyled(String(ad.name ?? ''), inner)),
    ...(ad.description ? [dim(truncateStyled(String(ad.description), inner))] : []),
    ...(url ? [neon('→ ') + url] : []),
  ];
  const rows = [
    INDENT + dim('╭' + repeat('─', width - 2) + '╮'),
    ...body.map((row) => INDENT + dim('│') + ' ' + padEnd(row, inner) + ' ' + dim('│')),
    INDENT + dim('╰' + repeat('─', width - 2) + '╯'),
  ];
  line('');
  for (const row of rows) lineTracked(scroller, row);
  line('');
  prompt?.refresh?.();
}

/** OSC 8 hyperlink — plain text fallback in terminals without support. */
function link(text, url) {
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

async function afterReply(state, api, usage) {
  if (!state.model?.usesSessions) {
    await refreshBalanceAfterStream(state, api);
    return;
  }
  const wasActive = sessionRemaining(state) > 0;
  try {
    const account = await api.account(state.auth.token);
    syncSession(state, account);
    if (!wasActive && sessionRemaining(state) > 0) {
      printSessionStarted(sessionRemaining(state));
    }
  } catch {
    /* the reply itself succeeded: never fail the turn over account refresh */
  }
}

async function sendMessage(text, { api, state, prompt }) {
  const scroller = state.scroller;
  state.history.push({ role: 'user', content: text });
  printUserMessage(text);
  if (scroller) {
    scroller.append(INDENT + dim('You:'));
    for (const row of wrapStyled(text, Math.max(20, (process.stdout.columns || 80) - 8))) {
      scroller.append(INDENT + neon(glyphs.bar) + ' ' + row);
    }
    scroller.append('');
  }
  blank(1);
  lineTracked(scroller, INDENT + neon('Toeky:'));
  state.busy = true;

  try {
    const result = await agentTurn(text, { api, state, prompt });
    state.busy = false;
    prompt.refresh?.();
    return result;
  } catch (error) {
    state.busy = false;
    if (error instanceof TokenExpiredError) {
      blank(1);
      print(
        errorPanel(error, {
          hints: ['Sign in again to keep chatting — your conversation stays in this session.'],
        }),
      );
      return 'relogin';
    }
    print(errorPanel(error, { balance: state.balance }));
    return 'ok';
  }
}

/**
 * One full agent exchange: stream the reply, run any tool calls through the
 * authorization popup, feed results back and stream again until the model
 * answers with plain text (or the user denies / the loop cap is reached).
 */
async function agentTurn(userText, { api, state, prompt }) {
  const MAX_TOOL_ROUNDS = 8;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const spinner = createSpinner({ label: round === 0 ? 'Thinking…' : 'Working…' });
    spinner.start();
    let live = null;
    let lastPaint = 0;

    let content;
    let usage;
    try {
      const streamed = await api.stream(state.auth.token, {
        model: state.model.id,
        messages: trimHistory(state.history),
        tools: toolDeclarations(),
        onDelta: (full) => {
          if (!live) {
            spinner.stop();
            live = createLiveMarkdown({ indent: INDENT });
          }
          const now = Date.now();
          if (now - lastPaint >= PAINT_INTERVAL_MS) {
            lastPaint = now;
            live.update(maskToolStream(full));
          }
        },
      });
      content = streamed.content;
      usage = streamed.usage;
    } catch (error) {
      spinner.stop();
      if (live) live.discard();
      throw error;
    }
    spinner.stop();

    const calls = extractToolCalls(content);

    if (calls.length === 0) {
      if (!live) live = createLiveMarkdown({ indent: INDENT });
      live.finish(content);
      if (!content.trim()) line(INDENT + faint('(empty response)'));
      // journal the assistant reply so it shows up in the scrollback
      if (state.scroller) {
        const { lines: replyLines } = renderMarkdownEx(content, {
          width: columns(),
          indent: INDENT,
        });
        for (const row of replyLines) state.scroller.append(row);
        state.scroller.append('');
      }
      blank(1);
      printUsageLine(state, usage);
      state.history.push({ role: 'assistant', content });
      await afterReply(state, api, usage);
      // OpenAds: fire-and-forget after the reply, never blocking or re-rendering
      api
        .ad(state.auth.token, userText)
        .then((ad) => printAdCard(ad, { scroller: state.scroller, prompt }));
      return 'ok';
    }

    // Text before the first tool call is still worth showing permanently.
    const preamble = content.slice(0, content.indexOf('<toolcall>')).trim();
    if (live) {
      live.finish(maskToolStream(preamble));
      blank(1);
    } else if (preamble) {
      print(renderMarkdown(maskToolStream(preamble), { indent: INDENT }));
      blank(1);
    }

    const results = [];
    let denied = false;
    for (const call of calls) {
      const preview = await buildToolPreview(call.name, call.args);
      const allowed = await authorizeTool({ toolName: call.name, preview });
      if (!allowed) {
        denied = true;
        results.push(`[TOOL RESULT: ${call.name}]\nDENIED by user.`);
        line(INDENT + warn(glyphs.cross) + ' ' + dim(`${call.name} denied.`));
        continue;
      }
      const spinner = createSpinner({ label: `Running ${call.name}…` });
      spinner.start();
      const result = await executeTool(call.name, call.args);
      spinner.stop();
      results.push(`[TOOL RESULT: ${call.name}]\n${result.output}`);
      const mark = result.ok ? neon(glyphs.ok) : warn(glyphs.cross);
      line(INDENT + mark + ' ' + dim(`${call.name} ${result.ok ? 'finished' : 'failed'}.`));
      const outputRows = result.output.split('\n').slice(0, 8);
      for (const row of outputRows) line(INDENT + '  ' + faint(row.slice(0, (process.stdout.columns || 80) - 8)));
      if (result.output.split('\n').length > 8) line(INDENT + '  ' + faint('…'));
    }

    // Per the backend docs: keep the assistant message with the <toolcall>
    // blocks intact, then one user message carrying all [TOOL RESULT] markers,
    // multiple results joined with \n---\n.
    state.history.push({ role: 'assistant', content });
    state.history.push({ role: 'tool', content: results.join('\n---\n') });
    if (denied) {
      blank(1);
      line(INDENT + dim('Continuing without the tool — Toeky will answer in plain text.'));
      // A denied round still gets one more model turn so it can react, but it
      // cannot keep calling tools this turn; fall through to a final stream.
    }
    blank(1);
  }

  line(INDENT + warn(glyphs.warn) + ' ' + dim('Too many tool rounds — stopping here.'));
  return 'ok';
}

function applyModel(state, model, { announce = true } = {}) {
  const changed = state.model?.id !== model.id;
  state.model = model;
  savePrefs({ lastModel: model.id });
  if (announce && changed) {
    section(chatModelCard(model, { footer: 'model switched' }), { before: 1, after: 0 });
    const warnings = modelWarningLines(model);
    if (warnings.length) {
      blank(1);
      for (const row of warnings) line(row);
    }
    blank(1);
  }
}

async function changeModel({ api, state }, query) {
  const q = query.trim();
  let target = null;
  if (q) {
    const needle = q.toLowerCase();
    const matches = state.models.filter((model) => {
      const name = modelDisplayName(model.id).toLowerCase();
      return (
        model.id.toLowerCase() === needle ||
        name === needle ||
        model.id.toLowerCase().includes(needle) ||
        name.replace(/\s+/g, '-').includes(needle.replace(/\s+/g, '-'))
      );
    });
    if (matches.length === 1) {
      target = matches[0];
    } else {
      const rows = ['', INDENT + faint(matches.length === 0 ? `No model matched "${q}".` : `Several models matched "${q}":`)];
      for (const match of matches) rows.push(INDENT + dim('· ') + modelDisplayName(match.id));
      rows.push('', INDENT + dim('Use /models to browse everything available.'), '');
      print(rows);
      return 'ok';
    }
  }
  if (!target) {
    target = await selectModel({
      api,
      models: state.models,
      currentId: state.model?.id,
      title: 'Choose a model',
    });
    if (!target) {
      blank(1);
      return 'ok';
    }
  }
  applyModel(state, target);
  return 'ok';
}

async function showModels({ state }) {
  print(modelsPanel(state.models, state.model?.id));
  return 'ok';
}

async function showAccount({ api, state }) {
  const account = await api.account(state.auth.token);
  const wasActive = sessionRemaining(state) > 0;
  syncSession(state, account);
  print(accountPanel(account, { balance: state.balance }));
  if (!wasActive && sessionRemaining(state) > 0) printSessionStarted(sessionRemaining(state));
  return 'ok';
}

async function showCredits({ api, state }) {
  state.balance = await api.credits(state.auth.token);
  print(creditsPanel(state.balance));
  return 'ok';
}

function clearConversation({ state }) {
  clearScreen();
  state.history = [];
  renderChatIntro(state);
  line(INDENT + dim('Conversation cleared.'));
  blank(1);
}

async function relogin({ api, state }) {
  const next = await runSetup({
    api,
    notice: 'Signing in again.',
    banner: false,
    clear: false,
  });
  if (!next) {
    blank(1);
    return 'ok';
  }
  state.auth = { token: next.token, expiresAt: next.expiresAt, email: next.email };
  if (next.account) syncSession(state, next.account);
  blank(1);
  line(INDENT + neon(glyphs.ok) + ' ' + dim('Account reconnected.'));
  blank(1);
  return 'ok';
}

async function handleCommand(raw, ctx) {
  const trimmed = raw.trim();
  const [name, ...rest] = trimmed.slice(1).split(/\s+/);
  const command = (name || '').toLowerCase();
  const args = rest.join(' ');
  try {
    switch (command) {
      case 'help':
      case '?':
        print(helpPanel());
        return 'ok';
      case 'version':
        print(versionPanel());
        return 'ok';
      case 'models':
        return await showModels(ctx);
      case 'model':
        return await changeModel(ctx, args);
      case 'account':
        return await showAccount(ctx);
      case 'credits':
      case 'balance':
        return await showCredits(ctx);
      case 'clear':
        clearConversation(ctx);
        return 'ok';
      case 'login':
      case 'signin':
        return await relogin(ctx);
      case 'exit':
      case 'quit':
      case 'q':
        return 'exit';
      default:
        print(unknownCommandPanel(command));
        return 'ok';
    }
  } catch (error) {
    blank(1);
    print(errorPanel(error, { balance: ctx.state.balance }));
    return error instanceof TokenExpiredError ? 'relogin' : 'ok';
  }
}

/**
 * @returns {Promise<'exit'|'relogin'>}
 */
export async function runChat({ api, state, prompt }) {
  // The alternate screen has no native scroll, so the whole conversation is
  // journaled here and Shift+↑/↓ / PgUp/PgDn scroll through it.
  const scroller = new TranscriptScroller({ indent: INDENT });
  if (prompt.setScroller) prompt.setScroller(scroller);
  state.scroller = scroller;
  renderChatIntro(state);
  const tick = setInterval(() => {
    const session = state.session;
    if (!session?.endAt) return;
    if (session.endAt <= Date.now()) {
      if (!state.busy) {
        state.session = { endAt: null, startedAt: null };
        printSessionEnded();
      }
      return;
    }
    if (!state.busy) prompt.refresh?.();
  }, 1000);
  if (tick.unref) tick.unref();

  try {
    for (;;) {
      const answer = await prompt.read({ status: () => statusLine(state) });
      if (answer.type !== 'submit') return 'exit';
      const input = answer.text.trim();
      if (!input) continue;
      if (input.startsWith('/')) {
        const outcome = await handleCommand(input, { api, state, prompt });
        if (outcome === 'exit') return 'exit';
        if (outcome === 'relogin') return 'relogin';
        continue;
      }
      const outcome = await sendMessage(input, { api, state, prompt });
      if (outcome === 'relogin') return 'relogin';
    }
  } finally {
    clearInterval(tick);
  }
}
