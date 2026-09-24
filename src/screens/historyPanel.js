/**
 * /history panels: the saved-conversations list and a single conversation
 * transcript rendered the same way the live chat renders messages.
 */

import { columns } from '../ui/out.js';
import { bold, dim, faint, glyphs, neon, warn } from '../ui/theme.js';import { truncateStyled, wrapStyled } from '../util/ansi.js';
import { modelDisplayName } from '../format.js';
import { INDENT } from './panels.js';
import { renderMarkdown } from '../ui/markdown.js';

const DATE_LOCALE = 'en-GB'; // dd/mm/yyyy — compact and unambiguous

function dateLabel(timestamp) {
  if (!timestamp) return 'unknown date';
  return new Date(timestamp).toLocaleString(DATE_LOCALE, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * List of saved conversations: `▸ title · model · date · n messages`.
 * Empty state explains how the history works.
 */
export function historyPanel(conversations) {
  const rows = ['', INDENT + neon(glyphs.diamond) + ' ' + bold('History'), ''];
  if (conversations.length === 0) {
    rows.push(
      INDENT + dim('No saved conversations yet.'),
      '',
      INDENT + dim('Every chat is saved locally after your first message.'),
      INDENT + dim('Use /history open <number> to reopen one, /history delete <number> to remove it.'),
      '',
    );
    return rows;
  }
  conversations.forEach((conversation, index) => {
    const number = neon(String(index + 1).padStart(2, ' '));
    const title = truncateStyled(conversation.title, 42);
    const model = conversation.model ? faint(modelDisplayName(conversation.model)) : '';
    const when = faint(dateLabel(conversation.updatedAt));
    const count = faint(`${conversation.messageCount} msg`);
    rows.push(
      INDENT + number + '  ' + [title, model, when, count].filter(Boolean).join('  ' + dim('·') + '  '),
    );
  });
  rows.push('');
  rows.push(INDENT + faint('/history open <n> · /history delete <n> · /history clear'));
  rows.push('');
  return rows;
}

/** Full transcript of one saved conversation, as it appeared in the chat. */
export function conversationPanel(conversation) {
  const rows = [
    '',
    INDENT + neon(glyphs.diamond) + ' ' + bold(truncateStyled(conversation.title, 52)),
    INDENT +
      dim(
        [
          conversation.model ? modelDisplayName(conversation.model) : null,
          dateLabel(conversation.createdAt),
          `${conversation.messages.length} messages`,
        ]
          .filter(Boolean)
          .join('  ·  '),
      ),
    '',
  ];
  const width = Math.max(20, (columns() || 80) - 8);
  for (const message of conversation.messages) {
    if (message.role === 'user') {
      rows.push(INDENT + dim('You:'));
      for (const line of wrapStyled(message.content, width)) rows.push(INDENT + line);
    } else {
      rows.push(INDENT + dim('Toeky:'));
      for (const line of renderMarkdown(message.content, { width, indent: INDENT })) {
        rows.push(INDENT + line);
      }
    }
    rows.push('');
  }
  return rows;
}

/** Confirmation line after /history delete or /history clear. */
export function historyDeleted(count) {
  return [
    '',
    count > 0
      ? INDENT + neon(glyphs.ok) + ' ' + dim(count === 1 ? 'Conversation deleted.' : `${count} conversations deleted.`)
      : INDENT + warn(glyphs.warn) + ' ' + dim('Nothing to delete.'),
    '',
  ];
}
