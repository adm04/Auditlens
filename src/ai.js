// AI writing assistant — "bring your own key" (BYOK).
//
// The user pastes an API key for Anthropic (Claude), OpenAI or Google Gemini in
// Settings. The key is stored ONLY in chrome.storage.local on this device and is sent
// only to the chosen provider. Calls are made straight from the editor page; the
// extension's host permissions let it call these APIs without a backend.
//
// PRIVACY RULE: only TEXT is sent (headline, CTA labels, SEO tags, finding titles and a
// short page-text sample). Screenshots are never sent.
//
// Shared with StepCapture. Audit-specific prompts live in ai-audit.js.

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-haiku-4-5',
    models: ['claude-haiku-4-5', 'claude-sonnet-5-5'],
    keyHint: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-5-mini',
    models: ['gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini'],
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    keyHint: 'AIza…',
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
};

export const TONES = {
  friendly: 'Friendly and encouraging, like a helpful designer walking a client through it',
  professional: 'Professional, clear and polished',
  simple: 'Very simple, for a non-technical client; no jargon',
  concise: 'As short as possible while staying clear',
};

const DEFAULT_CONFIG = { provider: 'anthropic', apiKey: '', model: '', tone: 'friendly' };

export async function getAIConfig() {
  const { ai } = await chrome.storage.local.get('ai');
  return { ...DEFAULT_CONFIG, ...(ai || {}) };
}

export async function saveAIConfig(config) {
  await chrome.storage.local.set({ ai: { ...DEFAULT_CONFIG, ...config } });
}

export function hasKey(config) {
  return !!(config && config.apiKey && config.apiKey.trim());
}

export function modelFor(config) {
  return (config.model || '').trim() || PROVIDERS[config.provider]?.defaultModel;
}

// ---- Provider calls ----------------------------------------------------------

class AIError extends Error {}

async function readError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.message || JSON.stringify(body).slice(0, 200);
  } catch {
    detail = res.statusText;
  }
  if (res.status === 401 || res.status === 403) return `The API key was rejected (${res.status}). Check it in Settings.`;
  if (res.status === 404) return `Model not found. Check the model name in Settings. (${detail})`;
  if (res.status === 429) return 'Rate limit or quota reached on your AI account. Try again shortly.';
  return `AI request failed (${res.status}): ${detail}`;
}

async function callAnthropic({ apiKey, model, system, user, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required when calling from a browser context; the key stays on this device.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new AIError(await readError(res));
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

async function callOpenAI({ apiKey, model, system, user, maxTokens }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      // Reasoning models spend part of this budget thinking, so keep it generous.
      max_completion_tokens: Math.max(maxTokens, 4000),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new AIError(await readError(res));
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini({ apiKey, model, system, user }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new AIError(await readError(res));
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

const CALLERS = { anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini };

/** Low-level: send a system + user prompt, get text back. */
export async function complete({ system, user, maxTokens = 2000, config }) {
  const cfg = config || (await getAIConfig());
  if (!hasKey(cfg)) throw new AIError('Add an AI API key in Branding & settings first.');
  const caller = CALLERS[cfg.provider];
  if (!caller) throw new AIError(`Unknown AI provider: ${cfg.provider}`);
  try {
    return await caller({ apiKey: cfg.apiKey.trim(), model: modelFor(cfg), system, user, maxTokens });
  } catch (err) {
    if (err instanceof AIError) throw err;
    throw new AIError(`Couldn't reach ${PROVIDERS[cfg.provider].label}. Check your connection. (${err.message})`);
  }
}

/** Pulls the first JSON object out of a model reply (handles ```json fences and chatter). */
export function parseJSON(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AIError('The AI reply wasn’t in the expected format. Try again.');
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new AIError('The AI reply wasn’t in the expected format. Try again.');
  }
}

/** Cheap call used by the "Test key" button. */
export async function testConnection(config) {
  const text = await complete({
    config,
    system: 'Reply with ONLY valid JSON.',
    user: 'Return {"ok":true}',
    maxTokens: 50,
  });
  return parseJSON(text).ok === true;
}
