import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';

const { anchorLimitedSession, applyLimitedModels, limitedRemaining } = await import(
  '../src/util/limitedSession.js'
);
const { modelSummary, modelTagline } = await import('../src/format.js');

test('anchorLimitedSession stores the session and the receipt time', () => {
  const state = {};
  anchorLimitedSession(state, null, 1000);
  assert.equal(state.limited.session, null);

  anchorLimitedSession(
    state,
    { model: 'm', startedAt: 0, expiresAt: 3_600_000, msRemaining: 3_590_000 },
    1000,
  );
  assert.equal(state.limited.session.model, 'm');
  assert.equal(state.limited.receivedAt, 1000);
  // countdown anchored on receipt: 3_590_000 ms from the receipt moment
  assert.equal(limitedRemaining(state, 2000), 3_589_000);
  assert.equal(limitedRemaining(state, 10_000_000), 0);
});

test('applyLimitedModels attaches pool data to matching model entries', () => {
  const models = [
    { id: 'a', free: true },
    { id: 'gemini-3.8-flash-tiered', free: true },
  ];
  const merged = applyLimitedModels(models, [
    {
      model: 'gemini-3.8-flash-tiered',
      limitedTime: true,
      poolLimit: 20,
      poolUsed: 5,
      poolRemaining: 15,
      yourActiveSession: null,
    },
  ]);
  assert.equal(merged[0].limitedTime, undefined);
  assert.equal(merged[1].limitedTime, true);
  assert.equal(merged[1].poolRemaining, 15);
  assert.equal(merged[1].poolLimit, 20);
});

test('limited models render the LIMITED pool summary', () => {
  const model = { id: 'gemini-3.8-flash-tiered', limitedTime: true, free: true, poolLimit: 20, poolRemaining: 12 };
  assert.match(modelSummary(model), /LIMITED · 12\/20 left/);
  assert.match(modelTagline(model), /first message starts your free hour/);
  assert.match(modelTagline({ ...model, yourActiveSession: {} }), /unlocked by your active session/);
});
