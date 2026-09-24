import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

process.env.OTK_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'otk-history-test-'));

const {
  deleteAllConversations,
  deleteConversation,
  listConversations,
  loadConversation,
  saveConversation,
  titleFromMessages,
} = await import('../src/history.js');

/** Reset the history dir before each test so tests never depend on order. */
function reset() {
  deleteAllConversations();
}

test('saveConversation creates a file with a derived title', () => {
  reset();
  const saved = saveConversation({
    model: 'agnes-3.0-flash',
    messages: [
      { role: 'user', content: 'Explain WebSockets in two lines' },
      { role: 'assistant', content: 'A persistent connection…' },
    ],
  });
  assert.ok(saved.id.startsWith('conv-'));
  assert.equal(saved.title, 'Explain WebSockets in two lines');
  assert.equal(saved.model, 'agnes-3.0-flash');

  const list = listConversations();
  assert.equal(list.length, 1);
  assert.equal(list[0].messageCount, 2);
});

test('title is trimmed to 64 chars and whitespace-collapsed', () => {
  const title = titleFromMessages([{ role: 'user', content: `  ${'a'.repeat(100)}  ` }]);
  assert.equal(title.length, 64);
  assert.ok(title.endsWith('…'));
});

test('updating uses the same id (in place) and bumps updatedAt', async () => {
  reset();
  const first = saveConversation({
    messages: [{ role: 'user', content: 'hello' }],
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = saveConversation({
    id: first.id,
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ],
  });
  assert.equal(second.id, first.id);
  assert.ok(second.updatedAt >= first.updatedAt);

  const list = listConversations();
  assert.equal(list.length, 1);
  assert.equal(list[0].messageCount, 2);
});

test('loadConversation returns only user/assistant messages', () => {
  reset();
  const saved = saveConversation({
    messages: [
      { role: 'user', content: 'run ls' },
      { role: 'assistant', content: '<toolcall>run_command…</toolcall>' },
      { role: 'tool', content: '[TOOL RESULT: run_command]\nOK' },
      { role: 'user', content: 'thanks' },
    ],
  });
  const loaded = loadConversation(saved.id);
  assert.equal(loaded.messages.length, 3); // tool message dropped
  assert.deepEqual(loaded.messages.map((m) => m.role), ['user', 'assistant', 'user']);
});

test('loadConversation is null for missing or bad ids', () => {
  assert.equal(loadConversation('does-not-exist'), null);
  assert.equal(loadConversation('../escape'), null);
  assert.equal(loadConversation(null), null);
});

test('deleteConversation removes exactly one conversation', () => {
  reset();
  const a = saveConversation({ messages: [{ role: 'user', content: 'a' }] });
  const b = saveConversation({ messages: [{ role: 'user', content: 'b' }] });
  assert.equal(deleteConversation(a.id), true);
  const list = listConversations();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, b.id);
  assert.equal(deleteConversation(a.id), false);
});

test('deleteAllConversations wipes everything', () => {
  reset();
  saveConversation({ messages: [{ role: 'user', content: 'x' }] });
  saveConversation({ messages: [{ role: 'user', content: 'y' }] });
  assert.equal(listConversations().length, 2);
  assert.equal(deleteAllConversations(), 2);
  assert.equal(listConversations().length, 0);
});

test('listConversations is sorted newest first', async () => {
  reset();
  const older = saveConversation({ messages: [{ role: 'user', content: 'older' }] });
  const newer = saveConversation({ messages: [{ role: 'user', content: 'newer' }] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  // touching the older conversation moves it to the front
  saveConversation({ id: older.id, messages: older.messages });
  const list = listConversations();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, older.id);
  assert.equal(list[1].id, newer.id);
});

after(() => {
  try {
    rmSync(process.env.OTK_CONFIG_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
