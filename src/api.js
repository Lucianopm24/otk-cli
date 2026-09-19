/**
 * OpenTokens API client. The backend contract lives in the project docs:
 * login by code+secret, then bearer-token calls for models, chat and account.
 * Every failure is surfaced as an `ApiError` with a readable message, which
 * is exactly what the UI shows the user.
 */

import { API_BASE_URL, WEB_BASE_URL } from './version.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Raised when a bearer token is rejected or has expired (HTTP 401). */
export class TokenExpiredError extends ApiError {
  constructor(message = 'Your session expired. Please sign in again.') {
    super(message, { status: 401, code: 'token_expired' });
  }
}

/**
 * The backend still points at the old `otk login` command in its 401 body;
 * OTK CLI signs in from the interactive session, so keep our own wording.
 */
function sessionMessage(message) {
  return /otk\s+login/i.test(message)
    ? 'Your session expired. Please sign in again.'
    : message;
}

function absoluteLoginUrl(loginUrl) {
  if (!loginUrl) return WEB_BASE_URL;
  if (/^https?:\/\//i.test(loginUrl)) return loginUrl;
  return WEB_BASE_URL.replace(/\/$/, '') + (loginUrl.startsWith('/') ? loginUrl : `/${loginUrl}`);
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const credits = usage.creditsDeducted ?? usage.credits_deducted;
  const cost = usage.costUSD ?? usage.cost_usd;
  return {
    promptTokens: Number(usage.promptTokens ?? usage.prompt_tokens ?? 0),
    completionTokens: Number(usage.completionTokens ?? usage.completion_tokens ?? 0),
    totalTokens: Number(usage.totalTokens ?? usage.total_tokens ?? 0),
    creditsDeducted: Number.isFinite(Number(credits)) ? Number(credits) : null,
    costUSD: Number.isFinite(Number(cost)) ? Number(cost) : null,
  };
}

export class OtkApi {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || API_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async #request(path, { method = 'GET', token = null, body = null, signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs);
    if (timer.unref) timer.unref();
    const abort = () => controller.abort(new Error('aborted'));
    signal?.addEventListener?.('abort', abort, { once: true });

    const headers = { accept: 'application/json' };
    if (body !== null) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;

    let response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (signal?.aborted) throw new ApiError('Request cancelled.', { code: 'aborted' });
      throw new ApiError(
        'Could not reach OpenTokens. Check your connection and try again.',
        { status: 0, code: 'network' },
      );
    } finally {
      signal?.removeEventListener?.('abort', abort);
    }

    const raw = await response.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const message =
        (data && typeof data.error === 'string' && data.error.trim()) ||
        `Request failed (HTTP ${response.status}).`;
      if (response.status === 401 && token) throw new TokenExpiredError(sessionMessage(message));
      throw new ApiError(message, { status: response.status, code: data?.code ?? null });
    }
    if (!data || typeof data !== 'object') {
      throw new ApiError('OpenTokens returned an unexpected response.', {
        status: response.status,
        code: 'bad_response',
      });
    }
    return data;
  }

  /** Step 1 of the login flow: ask for a code + secret pair. */
  async sign() {
    const data = await this.#request('/cli/account/sign', { method: 'POST', body: {} });
    return {
      code: String(data.code ?? ''),
      secret: String(data.secret ?? ''),
      expiresAt: Number(data.expiresAt) || Date.now() + 600_000,
      loginUrl: absoluteLoginUrl(data.loginUrl),
    };
  }

  /**
   * Step 3 of the login flow. Resolves `{ pending: true }` while the user has
   * not approved the login on the website yet.
   */
  async exchange({ code, secret }) {
    try {
      const data = await this.#request('/cli/account/token', {
        method: 'POST',
        body: { code, secret },
      });
      return {
        pending: false,
        token: String(data.token ?? ''),
        expiresAt: Number(data.expiresAt) || null,
      };
    } catch (cause) {
      if (cause instanceof ApiError && /not confirmed/i.test(cause.message)) {
        return { pending: true };
      }
      throw cause;
    }
  }

  async models(token) {
    const data = await this.#request('/cli/chat/models', { token });
    const models = Array.isArray(data.models) ? data.models : [];
    return models
      .filter((model) => model && typeof model.model === 'string')
      .map((model) => ({
        id: model.model,
        inputPricePerMTok: Number(model.inputPricePerMTok) || 0,
        outputPricePerMTok: Number(model.outputPricePerMTok) || 0,
        free: Boolean(model.free),
        usesSessions: Boolean(model.usesSessions),
        note: typeof model.note === 'string' && model.note.trim() ? model.note.trim() : null,
        warning:
          typeof model.warning === 'string' && model.warning.trim() ? model.warning.trim() : null,
      }));
  }

  /**
   * Limited-time pool models: the global pool status plus the caller's own
   * active session, if any. The session itself starts automatically on the
   * first message to a pool model — there is no separate "start" endpoint.
   */
  async limitedModels(token) {
    const data = await this.#request('/cli/models/limited', { token });
    const models = Array.isArray(data.models) ? data.models : [];
    return models
      .filter((model) => model && typeof model.model === 'string')
      .map((model) => ({
        model: model.model,
        limitedTime: Boolean(model.limitedTime),
        free: Boolean(model.free),
        usesSessions: Boolean(model.usesSessions),
        poolLimit: Number(model.poolLimit) || 0,
        poolUsed: Number(model.poolUsed) || 0,
        poolRemaining: Number(model.poolRemaining) || 0,
        poolSharedAcrossAllUsers: model.poolSharedAcrossAllUsers !== false,
        poolResets: Boolean(model.poolResets),
        yourActiveSession:
          model.yourActiveSession && Number(model.yourActiveSession.expiresAt) > 0
            ? {
                startedAt: Number(model.yourActiveSession.startedAt) || null,
                expiresAt: Number(model.yourActiveSession.expiresAt),
                msRemaining: Number(model.yourActiveSession.msRemaining) || 0,
              }
            : null,
      }));
  }

  /**
   * The caller's active limited-time session (null when there is none).
   * `msRemaining` is computed server-side; the caller anchors it locally on
   * receipt so the countdown never needs another round-trip.
   */
  async limitedBonus(token) {
    const data = await this.#request('/cli/models/bonus', { token });
    const session = data.activeLimitedTimeSession;
    if (!session || !Number(session.expiresAt)) return null;
    return {
      model: String(session.model ?? ''),
      startedAt: Number(session.startedAt) || null,
      expiresAt: Number(session.expiresAt),
      msRemaining: Number(session.msRemaining) || 0,
      minutesRemaining: Number(session.minutesRemaining) || 0,
    };
  }

  async account(token) {
    const data = await this.#request('/cli/account/me', { token });
    return data.account ?? null;
  }

  async credits(token) {
    const data = await this.#request('/cli/account/credits', { token });
    return Number(data.balanceCredits) || 0;
  }

  async send(token, { model, messages, maxTokens = 16_384, signal = null }) {
    const data = await this.#request('/cli/chat/send', {
      method: 'POST',
      token,
      signal,
      body: { model, messages, maxTokens, stream: false },
    });
    return { content: String(data.content ?? ''), usage: normalizeUsage(data.usage) };
  }

  /**
   * Web search proxy (`web_search` tool). The Exa key lives on the server, so
   * the CLI only ever posts a query and gets back normalized results. Each
   * search costs credits (0.003), even on free sessions; a 402 comes back as
   * an ApiError whose message is what the agent relays to the human.
   */
  async search(token, query) {
    const data = await this.#request('/cli/tools/search', {
      method: 'POST',
      token,
      body: { query: String(query ?? '') },
    });
    const results = Array.isArray(data.results)
      ? data.results
          .filter((result) => result && typeof result === 'object')
          .map((result) => ({
            title: String(result.title ?? ''),
            url: String(result.url ?? ''),
            snippet: String(result.snippet ?? ''),
          }))
      : [];
    const charged = Number(data.charged);
    return { results, charged: Number.isFinite(charged) ? charged : 0 };
  }

  /**
   * OpenAds: ask for an ad matching the user's last prompt. No match or any
   * error (401, 400, 5xx, network) resolves null — the caller renders nothing.
   */
  async ad(token, prompt) {
    try {
      const data = await this.#request(
        `/cli/openads/show?prompt=${encodeURIComponent(String(prompt ?? ''))}`,
        { token },
      );
      return data && data.ok ? data.ad : null;
    } catch {
      return null;
    }
  }

  /** Exact post-stream spend, since streaming responses carry no usage. */
  async creditsAfterStream(token) {
    try {
      return Number(await this.credits(token));
    } catch {
      return null;
    }
  }

  /**
   * Streaming chat. `onDelta(fullText, delta)` is called for every token
   * chunk so the UI can print progressively.
   */
  async stream(token, { model, messages, maxTokens = 16_384, tools = null, onDelta = null, signal = null } = {}) {
    const body = { model, messages, maxTokens, stream: true };
    if (Array.isArray(tools) && tools.length > 0) body.tools = tools;
    const response = await this.#requestRaw('/cli/chat/send', {
      method: 'POST',
      token,
      signal,
      body,
    });

    if (!response.body) {
      throw new ApiError('Streaming is not supported by this response.', { code: 'no_stream' });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage = null;
    // Raw `data:` payloads, kept so callers can dump them when a tool call
    // arrives in an unexpected shape.
    const frames = [];

    const handlePayload = (payload) => {
      const trimmed = payload.trim();
      if (!trimmed || trimmed === '[DONE]') return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (parsed.error) throw new ApiError(String(parsed.error), { status: 502, code: 'stream' });
      // OpenTokens stream protocol: data: {"delta":"..."} — NOT OpenAI format.
      const delta = parsed.delta ?? parsed.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        content += delta;
        if (onDelta) onDelta(content, delta);
      }
      if (parsed.usage) usage = normalizeUsage(parsed.usage);
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          frames.push(line.slice(5));
          handlePayload(line.slice(5));
        }
      }
      if (buffer.startsWith('data:')) {
        frames.push(buffer.slice(5));
        handlePayload(buffer.slice(5));
      }
    } finally {
      reader.releaseLock?.();
    }

    return { content, usage, frames };
  }

  async #requestRaw(path, { method = 'GET', token = null, body = null, signal = null } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('aborted'));
    signal?.addEventListener?.('abort', abort, { once: true });
    const headers = { accept: 'text/event-stream' };
    if (body !== null) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    let response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) throw new ApiError('Request cancelled.', { code: 'aborted' });
      throw new ApiError('Could not reach OpenTokens. Check your connection and try again.', {
        status: 0,
        code: 'network',
      });
    } finally {
      signal?.removeEventListener?.('abort', abort);
    }
    if (!response.ok) {
      let message = `Request failed (HTTP ${response.status}).`;
      try {
        const text = await response.text();
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
          message = parsed.error.trim();
        }
      } catch {
        /* keep the generic message */
      }
      if (response.status === 401 && token) throw new TokenExpiredError(sessionMessage(message));
      throw new ApiError(message, { status: response.status });
    }
    return response;
  }
}

export function createApi(options) {
  return new OtkApi(options);
}

export { normalizeUsage };
