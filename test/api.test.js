import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';

const { OtkApi, ApiError, TokenExpiredError } = await import('../src/api.js');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function apiWith(handler) {
  return new OtkApi({
    baseUrl: 'https://example.test',
    fetchImpl: async (url, init) => handler(url, init),
  });
}

test('sign() builds an absolute login URL from the relative path', async () => {
  const calls = [];
  const api = apiWith((url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      ok: true,
      code: 'K7M2QPX4RA',
      secret: '483920',
      expiresAt: 1737000000000,
      loginUrl: '/cli/login?code=K7M2QPX4RA',
    });
  });
  const session = await api.sign();
  assert.equal(session.code, 'K7M2QPX4RA');
  assert.equal(session.secret, '483920');
  assert.equal(session.expiresAt, 1737000000000);
  assert.equal(session.loginUrl, 'https://opentokens.is-so.pro/cli/login?code=K7M2QPX4RA');
  assert.equal(calls[0].url, 'https://example.test/cli/account/sign');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{}');
  assert.ok(!('authorization' in calls[0].init.headers));
});

test('exchange() reports pending while the login is not approved', async () => {
  const pending = apiWith(() =>
    jsonResponse({ ok: false, error: 'Code not confirmed. Approve the login on the website.' }, 401),
  );
  assert.deepEqual(await pending.exchange({ code: 'A', secret: 'B' }), { pending: true });

  const done = apiWith(() =>
    jsonResponse({ ok: true, token: 'ot_123', expiresAt: 1737000000000 }),
  );
  const result = await done.exchange({ code: 'A', secret: 'B' });
  assert.equal(result.pending, false);
  assert.equal(result.token, 'ot_123');
});

test('exchange() surfaces real failures with their message', async () => {
  const api = apiWith(() => jsonResponse({ ok: false, error: 'Code expired. Run the login command again.' }, 401));
  await assert.rejects(
    () => api.exchange({ code: 'A', secret: 'B' }),
    (error) => error instanceof ApiError && /Code expired/.test(error.message) && error.status === 401,
  );
});

test('models() normalises the backend payload', async () => {
  const api = apiWith((url, init) => {
    assert.equal(init.headers.authorization, 'Bearer ot_test');
    return jsonResponse({
      ok: true,
      models: [
        {
          model: 'agnes-3.0-flash',
          inputPricePerMTok: 0.05,
          outputPricePerMTok: 0.15,
          free: false,
          usesSessions: false,
          note: '  ',
          warning: null,
        },
        { model: 'stealth/union-alpha', free: true, usesSessions: true, warning: ' temporary ' },
        { nope: true },
      ],
    });
  });
  const models = await api.models('ot_test');
  assert.equal(models.length, 2);
  assert.equal(models[0].id, 'agnes-3.0-flash');
  assert.equal(models[0].note, null);
  assert.equal(models[1].warning, 'temporary');
  assert.equal(models[1].usesSessions, true);
});

test('authenticated 401 responses become TokenExpiredError', async () => {
  const api = apiWith(() => jsonResponse({ ok: false, error: 'Invalid or expired CLI token.' }, 401));
  await assert.rejects(() => api.models('ot_dead'), (error) => error instanceof TokenExpiredError);
});

test('401 messages never send users hunting for a non-existent command', async () => {
  const api = apiWith(() =>
    jsonResponse(
      { ok: false, error: 'Invalid or expired CLI token. Log in again with `otk login`.' },
      401,
    ),
  );
  await assert.rejects(
    () => api.account('ot_dead'),
    (error) =>
      error instanceof TokenExpiredError &&
      !/otk login/i.test(error.message) &&
      /sign in again/i.test(error.message),
  );
});

test('gating errors keep their HTTP status and message', async () => {
  const api = apiWith(() =>
    jsonResponse(
      { ok: false, error: 'Insufficient balance: this request needs ~0.003 credits but you have 0.001.' },
      402,
    ),
  );
  await assert.rejects(
    () => api.send('ot_test', { model: 'm', messages: [] }),
    (error) => error.status === 402 && /Insufficient balance/.test(error.message),
  );
});

test('network failures are reported in plain language', async () => {
  const api = apiWith(() => {
    throw new Error('ECONNREFUSED');
  });
  await assert.rejects(
    () => api.models('ot_test'),
    (error) => error.status === 0 && /Could not reach OpenTokens/.test(error.message),
  );
});

test('stream() accumulates OpenTokens deltas and reads the usage frame', async () => {
  const frames = [
    'data: {"delta":"Hel"}',
    'data: {"delta":"lo!"}',
    'data: {"delta":" ","usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7,"credits_deducted":0.0001}}',
    'data: [DONE]',
    '',
  ].join('\n\n');
  const api = apiWith((url, init) => {
    assert.equal(url, 'https://example.test/cli/chat/send');
    assert.match(init.body, /"stream":true/);
    return new Response(frames, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  const seen = [];
  const result = await api.stream('ot_test', {
    model: 'agnes-3.0-flash',
    messages: [{ role: 'user', content: 'hi' }],
    onDelta: (full) => seen.push(full),
  });
  assert.equal(result.content, 'Hello! ');
  assert.deepEqual(seen, ['Hel', 'Hello!', 'Hello! ']);
  assert.equal(result.usage.totalTokens, 7);
  assert.equal(result.usage.creditsDeducted, 0.0001);
});

test('stream() tolerates legacy OpenAI-shaped frames', async () => {
  const frames = ['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]', ''].join('\n\n');
  const api = apiWith(
    () => new Response(frames, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  );
  const result = await api.stream('ot_test', { model: 'm', messages: [] });
  assert.equal(result.content, 'ok');
});

test('stream() turns an error frame into an ApiError', async () => {
  const api = apiWith(
    () =>
      new Response('data: {"error":"Provider is busy."}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  );
  await assert.rejects(
    () => api.stream('ot_test', { model: 'm', messages: [] }),
    (error) => error instanceof ApiError && /Provider is busy/.test(error.message),
  );
});

test('streaming gate errors arrive before any token', async () => {
  const api = apiWith(() =>
    jsonResponse({ ok: false, error: 'No free sessions left today.' }, 429),
  );
  await assert.rejects(
    () => api.stream('ot_test', { model: 'stealth/union-alpha', messages: [] }),
    (error) => error.status === 429 && /No free sessions/.test(error.message),
  );
});

test('search() posts the query and normalises the results and charge', async () => {
  const api = apiWith((url, init) => {
    assert.equal(url, 'https://example.test/cli/tools/search');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.authorization, 'Bearer ot_test');
    assert.deepEqual(JSON.parse(init.body), { query: 'react 19 new hooks' });
    return jsonResponse({
      ok: true,
      charged: 0.003,
      results: [
        { title: 'React 19', url: 'https://react.dev', snippet: 'New hooks' },
        null,
      ],
    });
  });
  const out = await api.search('ot_test', 'react 19 new hooks');
  assert.equal(out.charged, 0.003);
  assert.deepEqual(out.results, [
    { title: 'React 19', url: 'https://react.dev', snippet: 'New hooks' },
  ]);
});

test('search() surfaces the 402 message as an ApiError', async () => {
  const api = apiWith(() =>
    jsonResponse(
      {
        ok: false,
        charged: false,
        error:
          'web_search cost 0.003 credits/search and you human does not have enough credits to pay it, so the search was not succeded.',
      },
      402,
    ),
  );
  await assert.rejects(
    () => api.search('ot_test', 'x'),
    (error) =>
      error instanceof ApiError &&
      error.status === 402 &&
      /not have enough credits/.test(error.message),
  );
});
