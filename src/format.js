/**
 * Presentation helpers: everything the UI shows about a model, a balance or
 * a duration is derived from backend data here. No model list is hardcoded.
 */

const BRAND_CASE = {
  ai: 'AI',
  api: 'API',
  glm: 'GLM',
  gpt: 'GPT',
  llm: 'LLM',
  tts: 'TTS',
  stt: 'STT',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  llama: 'Llama',
  mistral: 'Mistral',
  claude: 'Claude',
  gemini: 'Gemini',
  sonic: 'Sonic',
  kimi: 'Kimi',
  free: 'Free',
  mini: 'Mini',
  max: 'Max',
};

/** Provider-ish trailing tokens that are internal and must not be displayed. */
const PROVIDER_SUFFIXES = new Set([
  'zai', 'zhipu', 'openai', 'anthropic', 'google', 'meta', 'mistral', 'deepseek',
  'qwen', 'alibaba', 'moonshot', 'cohere', 'perplexity', 'azure', 'bedrock',
  'vertex', 'nvidia', 'xai', 'groq', 'together', 'fireworks', 'minimax',
  '01ai', 'siliconflow', 'internal', 'cloud', 'eu', 'us',
]);

/** Turn a backend model id into a clean display name. */
export function modelDisplayName(id) {
  const raw = String(id ?? '').trim();
  if (!raw) return 'Unknown model';
  let body = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  body = body.replace(/[_\s]+/g, '-');
  let tokens = body.split('-').filter(Boolean);
  if (tokens.length > 1 && PROVIDER_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens = tokens.slice(0, -1);
  }
  const merged = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i < tokens.length - 1 && /^\d+$/.test(tokens[i]) && /^\d{1,2}$/.test(tokens[i + 1])) {
      merged.push(`${tokens[i]}.${tokens[i + 1]}`);
      i++;
    } else {
      merged.push(tokens[i]);
    }
  }
  tokens = merged;
  const pretty = tokens.map((token) => {
    const lower = token.toLowerCase();
    if (BRAND_CASE[lower]) return BRAND_CASE[lower];
    if (/^v?\d/.test(token)) return lower;
    if (/^[a-z]/.test(token)) return token.charAt(0).toUpperCase() + token.slice(1);
    return token;
  });
  return pretty.join(' ').replace(/\s+/g, ' ').trim();
}

function price(value) {
  const number = Number(value) || 0;
  if (number === 0) return 'Free';
  if (number < 1) return `$${number.toFixed(2)}`;
  if (Number.isInteger(number)) return `$${number}`;
  return `$${number.toFixed(2)}`;
}

export function inputPriceLabel(model) {
  return Number(model?.inputPricePerMTok) === 0
    ? 'Free'
    : `${price(model.inputPricePerMTok)} / 1M tokens`;
}

export function outputPriceLabel(model) {
  return Number(model?.outputPricePerMTok) === 0
    ? 'Free'
    : `${price(model.outputPricePerMTok)} / 1M tokens`;
}

/** `Credits` | `Daily sessions` | `Free` */
export function usageLabel(model) {
  if (model?.limitedTime) return 'Limited-time pool';
  if (model?.free && !model?.usesSessions) return 'Free';
  if (model?.usesSessions) return 'Daily sessions';
  return 'Credits';
}

export function usageIcon(model) {
  if (model?.usesSessions) return 'sessions';
  if (model?.free) return 'free';
  return 'credits';
}

/** One-line summary: `Credits · $0.05 / $0.15 per 1M` */
export function modelSummary(model) {
  const parts = [];
  if (model?.limitedTime && Number.isFinite(Number(model.poolLimit)) && model.poolLimit > 0) {
    parts.push(`LIMITED · ${model.poolRemaining ?? 0}/${model.poolLimit} left`);
  }
  parts.push(usageLabel(model));
  const input = Number(model?.inputPricePerMTok) || 0;
  const output = Number(model?.outputPricePerMTok) || 0;
  if (input > 0 || output > 0) {
    parts.push(`${price(input)} / ${price(output)} per 1M`);
  } else {
    parts.push('no credits used');
  }
  return parts.join(' · ');
}

/** Short, derived hint about what the model is good for. */
export function modelTagline(model) {
  const input = Number(model?.inputPricePerMTok) || 0;
  const output = Number(model?.outputPricePerMTok) || 0;
  if (model?.limitedTime) {
    return model.yourActiveSession
      ? 'Limited-time model — unlocked by your active session.'
      : 'Limited-time model — the first message starts your free hour.';
  }
  if (model?.usesSessions) return 'Runs on your free daily sessions.';
  if (model?.free) return 'Free to use.';
  const average = (input + output) / 2;
  if (average <= 0.05) return 'Economical and quick for everyday prompts.';
  if (average <= 0.3) return 'Balanced quality and price.';
  return 'Premium model for demanding prompts.';
}

export function creditsLabel(value) {
  const number = Number(value) || 0;
  if (number === 0) return '0 C';
  if (number >= 1000) return `${Math.round(number).toLocaleString('en-US')} C`;
  if (number >= 100) return `${Number(number.toFixed(1))} C`;
  if (number >= 1) return `${Number(number.toFixed(2))} C`;
  if (number >= 0.01) return `${Number(number.toFixed(4))} C`;
  return `${Number(number.toFixed(6))} C`;
}

/** Precise amount for balance explanations: `0.001 C`. */
export function creditsExact(value) {
  const number = Number(value) || 0;
  if (number === 0) return '0 C';
  if (number >= 1) return `${Number(number.toFixed(4))} C`;
  return `${Number(number.toFixed(5))} C`;
}

export function tokensLabel(usage) {
  const total = Number(usage?.totalTokens ?? usage?.total_tokens ?? 0);
  if (!total) return '';
  if (total >= 1000) return `${(total / 1000).toFixed(total >= 10000 ? 0 : 1)}k tokens`;
  return `${total} tokens`;
}

export function durationLabel(ms) {
  const totalSeconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function minutesLabel(ms) {
  return `${Math.ceil((Number(ms) || 0) / 60000)} min`;
}

export function sessionsLabel(account) {
  const sessions = account?.sessions;
  if (!sessions) return '';
  if (sessions.activeNow && sessions.msRemaining > 0) {
    return `session ${durationLabel(sessions.msRemaining)} left`;
  }
  const remaining = Number(sessions.remaining) || 0;
  if (remaining === 0) return 'no sessions left today';
  return `${remaining} session${remaining === 1 ? '' : 's'} remaining`;
}

/** `luciano.romero@mail.com` -> `Luciano` */
export function displayNameFromEmail(email) {
  const local = String(email ?? '').split('@')[0] || '';
  const first = local.split(/[._\-+]+/).filter(Boolean)[0] || '';
  const letters = first.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (!letters) return 'there';
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}

export function dateLabel(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toISOString().slice(0, 10);
}

export { price };
