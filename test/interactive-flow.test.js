import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';
process.env.OTK_NO_BROWSER = '1';

const dir = mkdtempSync(join(tmpdir(), 'otk-flow-'));
process.env.OTK_CONFIG_DIR = dir;
writeFileSync(
  join(dir, 'config.json'),
  JSON.stringify({ token: 'ot_flow', expiresAt: Date.now() + 3_600_000 }),
  'utf8',
);
writeFileSync(
  join(dir, 'prefs.json'),
  JSON.stringify({ lastModel: 'agnes-3.0-flash', email: 'luciano@example.com' }),
  'utf8',
);

const { fakeTerminal, press, type } = await import('./helpers/terminal.js');
const { runApp } = await import('../src/app.js');
const { runSetup } = await import('../src/screens/setup.js');
const { loadAuth } = await import('../src/config.js');

const MODELS = [
  {
    id: 'agnes-3.0-flash',
    inputPricePerMTok: 0.05,
    outputPricePerMTok: 0.15,
    free: false,
    usesSessions: false,
    note: null,
    warning: null,
  },
  {
    id: 'stealth/union-alpha',
    inputPricePerMTok: 0,
    outputPricePerMTok: 0,
    free: true,
    usesSessions: true,
    note: null,
    warning: 'Temporary model.',
  },
  {
    id: 'glm-4.7-flash-zai',
    inputPricePerMTok: 0.03,
    outputPricePerMTok: 0.03,
    free: false,
    usesSessions: false,
    note: 'Can be slow.',
    warning: null,
  },
];

function fakeApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    async models(token) {
      calls.push({ kind: 'models', token });
      return MODELS;
    },
    async account() {
      calls.push({ kind: 'account' });
      return {
        email: 'luciano@example.com',
        balanceCredits: 12.4812,
        createdAt: 1_735_000_000_000,
        sessions: {
          remaining: 4,
          perDay: 6,
          usedToday: 1,
          unlocked: true,
          activeNow: false,
          msRemaining: 0,
          bonusSessions: 2,
          totalAvailable: 6,
        },
      };
    },
    async credits() {
      return { balance: 12.4812, dailyCredits: 0.15, totalSpendable: 12.6312 };
    },
    async sign() {
      calls.push({ kind: 'sign' });
      return {
        code: 'K7M2QPX4RA',
        secret: '483920',
        expiresAt: Date.now() + 600_000,
        loginUrl: 'https://opentokens.is-so.pro/cli/login?code=K7M2QPX4RA',
      };
    },
    async exchange() {
      calls.push({ kind: 'exchange' });
      return { pending: false, token: 'ot_new', expiresAt: Date.now() + 43_200_000 };
    },
    async stream(token, options) {
      calls.push({ kind: 'stream', model: options.model });
      options.onDelta('Hello ');
      options.onDelta('Hello from the mock');
      return {
        content: 'Hello from the mock',
        usage: { totalTokens: 12, creditsDeducted: 0.0002 },
      };
    },
    async send() {
      throw new Error('send() should not be used: the CLI streams');
    },
    ...overrides,
  };
}

test('the interactive session runs from banner to farewell', async () => {
  const terminal = fakeTerminal();
  try {
    const api = fakeApi();
    const appPromise = runApp({ api });

    await terminal.waitFor((text) => text.includes('Choose a model'));
    assert.ok(terminal.text().includes('Agnes 3.0 Flash'), 'cards are shown first');
    assert.ok(terminal.text().includes('$0.05 / $0.15 per 1M'));
    press('return', { sequence: '\r' });

    await terminal.waitFor((text) => text.includes('Ask Toeky anything'));
    type('hi there');
    press('return', { sequence: '\r' });

    await terminal.waitFor((text) => text.includes('Hello from the mock'));
    await terminal.waitFor((text) => text.includes('12 tokens'));
    type('/exit');
    press('return', { sequence: '\r' });

    const code = await appPromise;
    assert.equal(code, 0);

    const text = terminal.text();
    assert.ok(text.includes('OTK CLI v1.0.3'));
    assert.ok(text.includes('│ hi there'));
    assert.ok(text.includes('Toeky:'));
    assert.ok(text.includes('Hello from the mock'));
    assert.ok(text.includes('Hello from the mock') && text.includes('0.0002 C'));
    assert.ok(text.includes('Thanks for using OTK CLI.'));
    // the app owns the alternate screen buffer while it runs; cursor moves
    // and erase codes are expected, but no raw SGR colour may leak (--no-color)
    assert.ok(!/\u001b\[3[0-9;]*m/.test(terminal.raw()), 'the terminal is left clean');

    const stream = api.calls.find((call) => call.kind === 'stream');
    assert.equal(stream.model, 'agnes-3.0-flash');
  } finally {
    terminal.restore();
  }
});

test('the sign-in flow walks from the setup screen to the chat', async () => {
  rmSync(join(dir, 'config.json'), { force: true });
  const terminal = fakeTerminal();
  try {
    const api = fakeApi();
    const appPromise = runApp({ api });

    await terminal.waitFor((text) => text.includes('Sign in to OTK CLI'));
    assert.ok(terminal.text().includes('Welcome.'));
    assert.ok(terminal.text().includes("Let's get you set up."));
    press('return', { sequence: '\r' });

    await terminal.waitFor((text) => text.includes('Y O U R  O N E - T I M E  C O D E'), {
      timeout: 12_000,
    });
    await terminal.waitFor((text) => text.includes('Successfully signed in.'), {
      timeout: 12_000,
    });
    assert.ok(terminal.text().includes('Welcome back, Luciano.'));
    assert.ok(terminal.text().includes('K 7 M 2 Q P X 4 R A'));
    assert.ok(!terminal.text().includes('483920'), 'the login secret is never printed');
    assert.equal(loadAuth().token, 'ot_new', 'the session is persisted');

    await terminal.waitFor((text) => text.includes('Choose a model'));
    press('return', { sequence: '\r' });
    await terminal.waitFor((text) => text.includes('Ask Toeky anything'));
    type('/exit');
    press('return', { sequence: '\r' });

    assert.equal(await appPromise, 0);
    assert.ok(api.calls.some((call) => call.kind === 'sign'));
    assert.ok(api.calls.some((call) => call.kind === 'exchange'));
  } finally {
    terminal.restore();
  }
});

test('a session that expires mid-chat returns to sign-in and keeps the conversation', async () => {
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ token: 'ot_expired_midway', expiresAt: Date.now() + 3_600_000 }),
    'utf8',
  );
  const terminal = fakeTerminal();
  try {
    const { TokenExpiredError } = await import('../src/api.js');
    let streamed = 0;
    const api = fakeApi({
      async stream(token, options) {
        streamed += 1;
        if (streamed === 1) {
          options.onDelta('First answer');
          return { content: 'First answer', usage: { totalTokens: 5, creditsDeducted: 0.0001 } };
        }
        throw new TokenExpiredError();
      },
    });

    const appPromise = runApp({ api });
    await terminal.waitFor((text) => text.includes('Choose a model'));
    press('return', { sequence: '\r' });
    await terminal.waitFor((text) => text.includes('Ask Toeky anything'));

    type('first question');
    press('return', { sequence: '\r' });
    await terminal.waitFor((text) => text.includes('First answer'));

    type('second question');
    press('return', { sequence: '\r' });
    // the sign-in card reappears inline, keeping the conversation visible
    await terminal.waitFor((text) => text.includes('sign-in required'), { timeout: 12_000 });
    assert.ok(terminal.text().includes('First answer'), 'the conversation is still on screen');
    assert.ok(terminal.text().includes('Sign in to OTK CLI'));

    press('return', { sequence: '\r' });
    await terminal.waitFor((text) => text.includes('Successfully signed in.'), { timeout: 12_000 });
    await terminal.waitFor((text) => text.includes('Choose a model'), { timeout: 12_000 });
    press('return', { sequence: '\r' });
    await terminal.waitFor((text) => text.includes('Ask Toeky anything'));
    type('third question');
    press('return', { sequence: '\r' });
    await terminal.waitFor((text) => text.includes('First answer'));
    type('/exit');
    press('return', { sequence: '\r' });

    assert.equal(await appPromise, 0);
    assert.ok(!terminal.text().includes('Unexpected error'));
  } finally {
    terminal.restore();
  }
});
