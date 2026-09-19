/**
 * `/models bonus` panel: the active limited-time pool session (or the reason
 * there is none). Purely presentational — the live countdown also shows in
 * `statusLine`; this card is rendered on demand.
 */

import { columns } from '../ui/out.js';
import { box } from '../ui/box.js';
import { bold, dim, faint, glyphs, mint, neon, warn } from '../ui/theme.js';
import { durationLabel, modelDisplayName } from '../format.js';
import { limitedRemaining } from '../util/limitedSession.js';

const INDENT = '  ';

function panelWidth(max = 58) {
  return Math.max(34, Math.min(columns() - 6, max));
}

export function limitedTimePanel(state) {
  const width = panelWidth();
  const inner = width - 4;
  const rows = [];
  const poolModels = state.models?.filter((model) => model.limitedTime) ?? [];

  if (poolModels.length > 0) {
    rows.push(neon(glyphs.diamond) + ' ' + bold('Limited-time models'), '');
    for (const model of poolModels) {
      const pool =
        Number.isFinite(Number(model.poolLimit)) && model.poolLimit > 0
          ? ` · ${model.poolRemaining ?? 0}/${model.poolLimit} left`
          : '';
      rows.push(INDENT + warn('LIMITED') + ' ' + modelDisplayName(model.id) + dim(pool));
    }
    rows.push('');
  }

  const session = state.limited?.session;
  if (session && limitedRemaining(state) > 0) {
    const left = limitedRemaining(state);
    rows.push(warn(glyphs.timer) + '  ' + bold(modelDisplayName(session.model)), '');
    rows.push(field('Status', mint('active — free until it expires'), inner));
    rows.push(field('Left', bold(durationLabel(left)), inner));
    rows.push('');
    rows.push(dim('The clock never pauses. Everything you send while it'));
    rows.push(dim('is active costs 0 credits.'));
  } else {
    rows.push(faint('No active limited-time session.'));
    rows.push('');
    rows.push(dim('Send one message to a LIMITED model to start your free hour.'));
  }

  return ['', ...box(rows, { width, indent: INDENT }), ''];
}

function field(label, value, inner) {
  const prefix = dim(label + ':');
  return prefix + ' ' + value.slice(0, Math.max(4, inner - prefix.length - 1));
}
