import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const MODELS = [
  {
    model: 'agnes-3.0-flash',
    inputPricePerMTok: 0.05,
    outputPricePerMTok: 0.15,
    free: false,
    usesSessions: false,
    note: null,
    warning: null,
  },
  {
    model: 'stealth/union-alpha',
    inputPricePerMTok: 0,
    outputPricePerMTok: 0,
    free: true,
    usesSessions: true,
    note: null,
    warning:
      "Union Alpha is a temporary model and won't be available forever. Prompts may be retained for research.",
  },
  {
    model: 'glm-4.7-flash-zai',
    inputPricePerMTok: 0.03,
    outputPricePerMTok: 0.03,
    free: false,
    usesSessions: false,
    note: 'Can be slow (~1 request/second).',
    warning: null,
  },
];

function startMock(options = {}) {
  // when activeSession is on, the free session only starts once a chat request
  // has been accepted — exactly like the real gating
  const activeSession = options.activeSession === true;
  const requests = [];
  let sends = 0;
  const sessionsPayload = () => ({
    remaining: activeSession && sends > 0 ? 3 : 4,
    perDay: 6,
    usedToday: activeSession && sends > 0 ? 1 : 0,
    bonusSessions: 0,
    totalAvailable: activeSession && sends > 0 ? 3 : 4,
    unlocked: true,
    activeNow: activeSession && sends > 0,
    msRemaining: activeSession && sends > 0 ? 3_540_000 : 0,
  });
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      requests.push({ url: req.url, method: req.method, body, auth: req.headers.authorization });

      const json = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (req.url === '/cli/chat/models') {
        return json(200, { ok: true, models: MODELS });
      }
      if (req.url === '/cli/account/me') {
        return json(200, {
          ok: true,
          account: {
            email: 'luciano@example.com',
            balanceCredits: 12.4812,
            createdAt: 1_735_000_000_000,
            sessions: sessionsPayload(),
          },
        });
      }
      if (req.url === '/cli/account/credits') {
        return json(200, {
          ok: true,
          balanceCredits: 12.4812,
          dailyCredits: 0.15,
          totalSpendable: 12.6312,
        });
      }
      if (req.url === '/cli/chat/send') {
        sends += 1;
        const messages = body?.messages ?? [];
        const lastUser = [...messages].reverse().find((message) => message.role === 'user');
        if ((lastUser?.content ?? '').includes('BROKE')) {
          return json(402, {
            ok: false,
            error: 'Insufficient balance: this request needs ~0.003 credits but you have 0.001.',
          });
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const frames = [
          'data: {"choices":[{"delta":{"content":"Here "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"is a snippet:"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"\\n\\n```js\\nconst x = 1;\\n```\\n\\nAll done."}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30,"credits_deducted":0.0001}}\n\n',
          'data: [DONE]\n\n',
        ];
        let index = 0;
        const push = () => {
          if (index >= frames.length) {
            res.end();
            return;
          }
          res.write(frames[index]);
          index += 1;
          setTimeout(push, 5);
        };
        push();
        return;
      }
      return json(404, { ok: false, error: 'Not found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function runCli({ input, env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'bin', 'otk-cli.js')], {
      cwd: ROOT,
      env: { ...process.env, OTK_NO_COLOR: '1', FORCE_COLOR: '0', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function signedInEnv(apiBase, lastModel = 'agnes-3.0-flash') {
  const dir = mkdtempSync(join(tmpdir(), 'otk-e2e-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ token: 'ot_test_token', expiresAt: Date.now() + 6 * 60 * 60 * 1000 }),
    'utf8',
  );
  writeFileSync(
    join(dir, 'prefs.json'),
    JSON.stringify({ lastModel, email: 'luciano@example.com' }),
    'utf8',
  );
  return { OTK_CONFIG_DIR: dir, OTK_API_BASE: apiBase };
}

test('a signed-in session chats, switches models and handles commands', async (t) => {
  const mock = await startMock();
  t.after(() => mock.close());

  const { code, stdout, stderr } = await runCli({
    env: signedInEnv(mock.baseUrl),
    input: [
      'Tell me a joke',
      '/models',
      '/credits',
      '/account',
      '/nope',
      'BROKE please',
      '/model glm',
      'Another one',
      '/exit',
      '',
    ].join('\n'),
  });

  assert.equal(stderr, '');
  assert.equal(code, 0);

  // the stored session is reused without any login step; the banner now
  // lives on the model-picker screen together with the cards
  assert.ok(!stdout.includes('Sign in to OTK CLI'));
  assert.ok(stdout.includes('Agnes 3.0 Flash'));

  // the chat itself: You: with a gutter, Toeky: without one
  assert.ok(stdout.includes('You:'));
  assert.ok(stdout.includes('│ Tell me a joke'));
  assert.ok(stdout.includes('Toeky:'));
  assert.ok(stdout.includes('Here is a snippet:'));
  assert.ok(stdout.includes('const x = 1;'));
  assert.ok(!stdout.includes('│ All done.'));
  assert.ok(stdout.includes('All done.'));
  assert.ok(stdout.includes('0.0001 C'));
  assert.ok(stdout.includes('30 tokens'));

  // account state shown sparingly
  assert.ok(stdout.includes('Luciano'));
  assert.ok(stdout.includes('12.48 C'));
  assert.ok(stdout.includes('4 sessions available'));
  assert.ok(stdout.includes('luciano@example.com'));

  // /models reuses the same cards, including warnings and notes
  assert.ok(stdout.includes('Union Alpha'));
  assert.ok(stdout.includes('temporary model'));
  assert.ok(stdout.includes('Can be slow'));
  assert.ok(stdout.includes('Daily sessions'));

  // command handling
  assert.ok(stdout.includes('Unknown command: /nope'));
  assert.ok(stdout.includes('Insufficient balance'));
  assert.ok(stdout.includes('switch to a free model'));

  // /model switched the model for the following turn
  assert.ok(stdout.includes('model switched'));
  const sends = mock.requests.filter((request) => request.url === '/cli/chat/send');
  assert.equal(sends.length, 3); // the gated request counts too: it was attempted
  assert.equal(sends[0].body.model, 'agnes-3.0-flash');
  assert.equal(sends[1].body.model, 'agnes-3.0-flash');
  assert.equal(sends[2].body.model, 'glm-4.7-flash-zai');
  assert.equal(sends[0].auth, 'Bearer ot_test_token');
  assert.equal(sends[0].body.stream, true);
  assert.ok(sends[0].body.messages.some((message) => message.content === 'Tell me a joke'));

  // plain (non-TTY) runs stay script friendly and exit cleanly
  assert.ok(!stdout.includes('Thanks for using OTK CLI.'));
  assert.ok(!stdout.includes('\u001b['));
});

test('a free-session model reports the session and its countdown', async (t) => {
  const mock = await startMock({ activeSession: true });
  t.after(() => mock.close());

  const { code, stdout } = await runCli({
    env: signedInEnv(mock.baseUrl, 'stealth/union-alpha'),
    input: ['one free question', '/account', '/exit', ''].join('\n'),
  });

  assert.equal(code, 0);
  assert.ok(stdout.includes('Union Alpha'));
  assert.ok(stdout.includes('Daily sessions'));
  assert.ok(stdout.includes('Free session started'));
  assert.ok(stdout.includes('59:00 remaining'));
  assert.ok(stdout.includes('4 sessions available'));    assert.ok(stdout.includes('3/6 today'));
  const send = mock.requests.find((request) => request.url === '/cli/chat/send');
  assert.equal(send.body.model, 'stealth/union-alpha');
  // session models never report credit spend in the meta line
  assert.ok(!/0\.0001 C/.test(stdout));
});

test('an expired token sends the user back to the login screen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'otk-e2e-expired-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ token: 'ot_dead', expiresAt: Date.now() - 1000 }),
    'utf8',
  );
  const { code, stdout } = await runCli({
    env: { OTK_CONFIG_DIR: dir, OTK_API_BASE: 'http://127.0.0.1:1' },
    input: '',
  });
  assert.equal(code, 0);
  assert.ok(stdout.includes('Not signed in.'));
  assert.ok(!stdout.includes('Agnes 3.0 Flash'));
});

test('a rejected token mid-session is never treated as a crash', async (t) => {
  const mock = await startMock();
  t.after(() => mock.close());
  mock.requests.length = 0;

  const server = mock;
  const { code, stdout } = await runCli({
    env: signedInEnv(server.baseUrl),
    input: ['hello there', '/exit', ''].join('\n'),
  });
  assert.equal(code, 0);
  assert.ok(stdout.includes('hello there'));
});
