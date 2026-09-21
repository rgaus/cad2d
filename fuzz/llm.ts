import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * OpenAI-compatible chat completion client used for the LLM judge, seed
 * generator and symptom oracle. Wired to opencode go by default.
 *
 * Configured via env vars:
 *   FUZZ_LLM_BASE_URL    (default: https://opencode.ai/zen/go/v1)
 *   FUZZ_LLM_API_KEY     (default: read from ~/.local/share/opencode/auth.json "opencode-go")
 *   FUZZ_LLM_MODEL       (default: deepseek-v4-flash)
 *   FUZZ_LLM_RATE_PER_MINUTE (default: 30)
 */

export const DEFAULT_LLM_BASE_URL = 'https://opencode.ai/zen/go/v1';
export const DEFAULT_LLM_MODEL = 'deepseek-v4-flash';

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  ratePerMinute: number;
  timeoutMs: number;
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const state: { lastRequestAt: number; minIntervalMs: number } = {
  lastRequestAt: 0,
  minIntervalMs: 0,
};

/** Reads the API key from the opencode auth.json files if present. */
function readKeyFromOpenCodeConfig(): string | null {
  const candidates = [
    path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'),
    path.join(os.homedir(), '.config', 'opencode', 'auth.json'),
  ];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const key of ['opencode-go', 'opencode']) {
        if (parsed && parsed[key] && typeof parsed[key].key === 'string') {
          return parsed[key].key;
        }
      }
    } catch {
      // Ignore unreadable/missing config files.
    }
  }
  return null;
}

/** Builds the LLM config from the environment, or null if no API key is available. */
export function loadLlmConfig(): LlmConfig | null {
  const apiKey =
    process.env.FUZZ_LLM_API_KEY && process.env.FUZZ_LLM_API_KEY.length > 0
      ? process.env.FUZZ_LLM_API_KEY
      : readKeyFromOpenCodeConfig();

  if (!apiKey) {
    return null;
  }

  const baseUrl = process.env.FUZZ_LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL;
  const model = process.env.FUZZ_LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const ratePerMinute = Number(process.env.FUZZ_LLM_RATE_PER_MINUTE ?? 30);

  return {
    baseUrl,
    apiKey,
    model,
    ratePerMinute: Number.isFinite(ratePerMinute) && ratePerMinute > 0 ? ratePerMinute : 30,
    timeoutMs: 120_000,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a chat completion request and returns the model's text content.
 * Applies simple client-side rate limiting and a few retries on failure.
 */
export async function chatComplete(
  config: LlmConfig,
  messages: Array<ChatMessage>,
  options: { jsonMode?: boolean } = {},
): Promise<string> {
  if (config.ratePerMinute > 0) {
    const intervalMs = Math.max(1000, 60_000 / config.ratePerMinute);
    const now = Date.now();
    const waitMs = state.lastRequestAt + intervalMs - now;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    state.lastRequestAt = Date.now();
    state.minIntervalMs = intervalMs;
  }

  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: 0,
  };
  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 500)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('LLM returned empty content');
      }
      return content;
    } catch (e) {
      lastError = e;
      // Backoff: 2s, 5s, then give up.
      await sleep(2000 * Math.pow(2, attempt));
    }
  }

  throw new Error(`LLM request failed after retries: ${String(lastError)}`);
}

/** Attempts to parse a JSON object out of a possibly-noisy LLM response. */
export function extractJsonObject<T>(content: string): T {
  const trimmed = content.trim();
  try {
    const parsed = JSON.parse(trimmed) as T;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Fall through to block extraction.
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      // ignore
    }
  }

  throw new Error(`Could not extract JSON from LLM response: ${trimmed.slice(0, 300)}`);
}
