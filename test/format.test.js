import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.OTK_NO_COLOR = '1';

const {
  creditsExact,
  creditsLabel,
  displayNameFromEmail,
  durationLabel,
  inputPriceLabel,
  modelDisplayName,
  modelSummary,
  modelTagline,
  outputPriceLabel,
  tokensLabel,
  usageLabel,
} = await import('../src/format.js');

test('model names are derived from ids and hide internal providers', () => {
  assert.equal(modelDisplayName('agnes-3.0-flash'), 'Agnes 3.0 Flash');
  assert.equal(modelDisplayName('stealth/union-alpha'), 'Union Alpha');
  assert.equal(modelDisplayName('glm-4.7-flash-zai'), 'GLM 4.7 Flash');
  assert.equal(modelDisplayName('deepseek-v4.1-flash'), 'DeepSeek v4.1 Flash');
  assert.equal(modelDisplayName('claude-sonnet-4-6'), 'Claude Sonnet 4.6');
  assert.equal(modelDisplayName('claude-3-5-sonnet'), 'Claude 3.5 Sonnet');
  assert.equal(modelDisplayName('gpt-4-0613'), 'GPT 4 0613');
  assert.equal(modelDisplayName('gpt-4o-2024-08-06'), 'GPT 4o 2024 08 06');
  assert.equal(modelDisplayName('claude-opus-4-1-20250805'), 'Claude Opus 4.1 20250805');
});

test('prices, usage and summaries reflect the backend flags', () => {
  const credits = {
    inputPricePerMTok: 0.05,
    outputPricePerMTok: 0.15,
    free: false,
    usesSessions: false,
  };
  assert.equal(inputPriceLabel(credits), '$0.05 / 1M tokens');
  assert.equal(outputPriceLabel(credits), '$0.15 / 1M tokens');
  assert.equal(usageLabel(credits), 'Credits');
  assert.equal(modelSummary(credits), 'Credits · $0.05 / $0.15 per 1M');

  const session = { inputPricePerMTok: 0, outputPricePerMTok: 0, free: true, usesSessions: true };
  assert.equal(usageLabel(session), 'Daily sessions');
  assert.equal(modelSummary(session), 'Daily sessions · no credits used');

  const free = { inputPricePerMTok: 0, outputPricePerMTok: 0, free: true, usesSessions: false };
  assert.equal(usageLabel(free), 'Free');
  assert.equal(inputPriceLabel(free), 'Free');
  assert.ok(modelTagline(free).includes('Free'));
});

test('credits are formatted for reading and for explanations', () => {
  assert.equal(creditsLabel(0), '0 C');
  assert.equal(creditsLabel(12.4812), '12.48 C');
  assert.equal(creditsLabel(0.5231), '0.5231 C');
  assert.equal(creditsExact(0.001), '0.001 C');
  assert.equal(creditsExact(0.0001), '0.0001 C');
});

test('durations count up to the last second', () => {
  assert.equal(durationLabel(3_599_000), '59:59');
  assert.equal(durationLabel(60_000), '01:00');
  assert.equal(durationLabel(3_600_000), '1:00:00');
  assert.equal(durationLabel(0), '00:00');
});

test('token usage and account names are readable', () => {
  assert.equal(tokensLabel({ totalTokens: 30 }), '30 tokens');
  assert.equal(tokensLabel({ total_tokens: 12_400 }), '12k tokens');
  assert.equal(tokensLabel(null), '');
  assert.equal(displayNameFromEmail('luciano.romero@example.com'), 'Luciano');
  assert.equal(displayNameFromEmail('team+otk@example.com'), 'Team');
  assert.equal(displayNameFromEmail('12345@example.com'), 'there');
  assert.equal(displayNameFromEmail(null), 'there');
});
