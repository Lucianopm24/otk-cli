/**
 * Limited-time pool session tracking. The backend reports `msRemaining`
 * computed server-side; we anchor it on the moment it was received and count
 * down locally (`msRemaining - (now - receivedAt)`), exactly like the docs
 * suggest, so no extra round-trip is needed for a per-second countdown.
 */

/** Build state.limited from a `/cli/models/bonus` payload (or null). */
export function anchorLimitedSession(state, session, receivedAt = Date.now()) {
  if (!session || !Number.isFinite(Number(session.expiresAt))) {
    state.limited = { session: null, receivedAt: null, models: state.limited?.models ?? [] };
    return;
  }
  state.limited = {
    session: {
      model: String(session.model ?? ''),
      startedAt: Number(session.startedAt) || null,
      expiresAt: Number(session.expiresAt),
      msRemaining: Number(session.msRemaining) || 0,
    },
    receivedAt,
    models: state.limited?.models ?? [],
  };
}

/** Milliseconds left in the active limited session, drift-corrected locally. */
export function limitedRemaining(state, now = Date.now()) {
  const session = state.limited?.session;
  if (!session) return 0;
  const left = session.msRemaining - (now - (state.limited.receivedAt ?? now));
  return Math.max(0, left);
}

/**
 * Merge `/cli/models/limited` data into the model list: attach `limitedTime`,
 * pool numbers and this user's active session to the matching model entry.
 */
export function applyLimitedModels(models, limitedModels) {
  if (!Array.isArray(limitedModels)) return models;
  const byId = new Map(limitedModels.map((entry) => [entry.model, entry]));
  return models.map((model) => {
    const entry = byId.get(model.id);
    if (!entry) return model;
    return {
      ...model,
      limitedTime: entry.limitedTime,
      poolLimit: entry.poolLimit,
      poolUsed: entry.poolUsed,
      poolRemaining: entry.poolRemaining,
      yourActiveSession: entry.yourActiveSession,
    };
  });
}
