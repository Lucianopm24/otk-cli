/**
 * Local conversation history. Every conversation is persisted as one JSON
 * file under `~/.otk/history/` (same owner-only config dir as the token) so
 * the user can list, reopen or delete past chats with /history.
 *
 * File shape:
 *   { id, title, model, createdAt, updatedAt, messages: [{role, content}] }
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './config.js';

export const HISTORY_DIR = join(CONFIG_DIR, 'history');

const MAX_TITLE = 64;
const MAX_CONVERSATIONS = 200;

function ensureDir() {
  mkdirSync(HISTORY_DIR, { recursive: true });
}

function safeId(raw) {
  return String(raw ?? '').replace(/[^\w.-]/g, '');
}

/** Derive a short title from the first user message. */
export function titleFromMessages(messages) {
  const firstUser = (Array.isArray(messages) ? messages : []).find(
    (message) => message?.role === 'user' && String(message.content ?? '').trim(),
  );
  if (!firstUser) return 'Empty conversation';
  const text = String(firstUser.content).replace(/\s+/g, ' ').trim();
  return text.length > MAX_TITLE ? text.slice(0, MAX_TITLE - 1) + '…' : text;
}

/**
 * Persist a conversation. When `conversation.id` is empty a new file is
 * created; otherwise the existing file is updated in place. Returns the
 * conversation descriptor (with its id) so callers can keep appending.
 */
export function saveConversation({ id = null, model = null, messages = [], createdAt = null }) {
  ensureDir();
  const now = Date.now();
  const cleanId = id ? safeId(id) : null;
  const conversationId = cleanId || `conv-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id: conversationId,
    title: titleFromMessages(messages),
    model: typeof model === 'string' ? model : model?.id ?? null,
    createdAt: createdAt ?? now,
    updatedAt: now,
    messages: Array.isArray(messages) ? messages : [],
  };
  writeFileSync(join(HISTORY_DIR, `${conversationId}.json`), JSON.stringify(record, null, 2) + '\n');
  pruneOldConversations();
  return record;
}

/** Keep the newest MAX_CONVERSATIONS files, delete the rest. */
function pruneOldConversations() {
  const entries = listConversations();
  for (const entry of entries.slice(MAX_CONVERSATIONS)) {
    try {
      rmSync(join(HISTORY_DIR, `${entry.id}.json`), { force: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * All saved conversations, newest first.
 * @returns {{ id: string, title: string, model: string|null, createdAt: number, updatedAt: number, messageCount: number }[]}
 */
export function listConversations() {
  let files;
  try {
    files = readdirSync(HISTORY_DIR);
  } catch {
    return [];
  }
  const conversations = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(HISTORY_DIR, file), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.id) continue;
      conversations.push({
        id: safeId(parsed.id),
        title: String(parsed.title ?? 'Untitled'),
        model: typeof parsed.model === 'string' ? parsed.model : null,
        createdAt: Number(parsed.createdAt) || 0,
        updatedAt: Number(parsed.updatedAt) || 0,
        messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
      });
    } catch {
      /* skip corrupt files instead of failing the whole list */
    }
  }
  return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Load one conversation by id, or null when missing/corrupt. */
export function loadConversation(id) {
  const cleanId = safeId(id);
  if (!cleanId) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(HISTORY_DIR, `${cleanId}.json`), 'utf8'));
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return {
      id: safeId(parsed.id) || cleanId,
      title: String(parsed.title ?? 'Untitled'),
      model: typeof parsed.model === 'string' ? parsed.model : null,
      createdAt: Number(parsed.createdAt) || 0,
      updatedAt: Number(parsed.updatedAt) || 0,
      messages: parsed.messages
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
        .map((message) => ({ role: message.role, content: String(message.content ?? '') })),
    };
  } catch {
    return null;
  }
}

/** Delete one conversation by id. Returns true when something was deleted. */
export function deleteConversation(id) {
  const cleanId = safeId(id);
  if (!cleanId) return false;
  try {
    rmSync(join(HISTORY_DIR, `${cleanId}.json`), { force: false });
    return true;
  } catch {
    return false;
  }
}

/** Delete every saved conversation. Returns how many were removed. */
export function deleteAllConversations() {
  return listConversations().filter((entry) => deleteConversation(entry.id)).length;
}
