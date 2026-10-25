/**
 * Minimal client for OpenAI-compatible Chat Completions APIs. Supported providers:
 * - DeepSeek: https://api-docs.deepseek.com/ (base URL, models, JSON output, error codes)
 * - Gemini:   https://ai.google.dev/gemini-api/docs/openai (OpenAI-compatible endpoint)
 * Pick one with LLM_PROVIDER in .env.
 */

const REQUEST_TIMEOUT_MS = 60_000;

interface ProviderSettings {
  label: string;
  keyVar: string;
  baseUrlVar: string;
  modelVar: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Whether the provider documents response_format: { type: 'json_object' } on this endpoint. */
  jsonMode: boolean;
}

const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    keyVar: 'DEEPSEEK_API_KEY',
    baseUrlVar: 'DEEPSEEK_BASE_URL',
    modelVar: 'DEEPSEEK_MODEL',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    jsonMode: true,
  },
  gemini: {
    label: 'Gemini',
    keyVar: 'GEMINI_API_KEY',
    baseUrlVar: 'GEMINI_BASE_URL',
    modelVar: 'GEMINI_MODEL',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    // Not documented for Gemini's OpenAI-compatible endpoint; the prompt asks for JSON instead.
    jsonMode: false,
  },
} satisfies Record<string, ProviderSettings>;

export type ProviderName = keyof typeof PROVIDERS;
export const DEFAULT_PROVIDER: ProviderName = 'deepseek';

export class LlmError extends Error {
  constructor(
    /** Plain-English reason, safe to show in the report. */
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmConfig {
  provider: ProviderName;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  jsonMode: boolean;
}

/**
 * Reads the provider settings from the environment (.env).
 * Returns the config, or a plain-English reason why the AI analysis cannot run.
 */
export function resolveLlmConfig(): { config: LlmConfig } | { problem: string } {
  const requested = (process.env.LLM_PROVIDER?.trim().toLowerCase() || DEFAULT_PROVIDER) as string;
  if (!(requested in PROVIDERS)) {
    return {
      problem: `LLM_PROVIDER="${requested}" is not supported. Use one of: ${Object.keys(PROVIDERS).join(', ')}.`,
    };
  }
  const provider = requested as ProviderName;
  const settings: ProviderSettings = PROVIDERS[provider];
  const apiKey = process.env[settings.keyVar]?.trim();
  if (!apiKey) {
    return {
      problem: `no ${settings.label} API key. Set ${settings.keyVar} in .env to turn on AI failure analysis (LLM_PROVIDER=${provider}).`,
    };
  }
  return {
    config: {
      provider,
      label: settings.label,
      apiKey,
      baseUrl: (process.env[settings.baseUrlVar]?.trim() || settings.defaultBaseUrl).replace(/\/+$/, ''),
      model: process.env[settings.modelVar]?.trim() || settings.defaultModel,
      jsonMode: settings.jsonMode,
    },
  };
}

/** Turns the providers' documented HTTP error codes into plain words for the report. */
function describeHttpError(config: LlmConfig, status: number, detail: string): string {
  const name = config.label;
  const keyVar = PROVIDERS[config.provider].keyVar;
  // Gemini reports a bad key as 400 INVALID_ARGUMENT "Please pass a valid API key".
  if (status === 401 || /api key not valid|invalid api key|valid api key|API_KEY_INVALID/i.test(detail)) {
    return `${name} rejected the API key (${status}). Check ${keyVar} in .env.`;
  }
  switch (status) {
    case 402:
      return `The ${name} account has no balance or credits left (402). Top up the account to get AI analysis.`;
    case 403:
      return `${name} refused access (403): the key has no permission, billing is not set up, or the key was blocked. Check the account.`;
    case 404:
      return `${name} does not know the model "${config.model}" (404). Check the model name in .env.`;
    case 429: {
      // Gemini explains which quota ran out and when it resets; pass that on.
      const quota = detail.match(/description: ([^.\\]+)\./)?.[1];
      const retry = detail.match(/retry in ([\dhms]+)/i)?.[1];
      const reason = [quota, retry && `resets in about ${retry}`].filter(Boolean).join('; ');
      return `${name} quota or rate limit reached (429)${reason ? `: ${reason}` : ''}. Wait, use another model, or check the account's quota and billing.`;
    }
    case 500:
    case 502:
    case 503:
    case 504:
      return `${name} is down or overloaded (${status}). Try again later.`;
    default:
      return `${name} returned an error (${status}): ${detail.slice(0, 200)}`;
  }
}

/**
 * Sends one prompt and returns the model's text answer.
 * Throws LlmError with a readable message on any failure.
 */
export async function chatCompletion(
  config: LlmConfig,
  prompt: string,
  options: { json?: boolean; maxTokens?: number } = {},
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: options.maxTokens ?? 1000,
        ...(options.json && config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError'
      ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} s`
      : String((error as Error)?.message ?? error);
    throw new LlmError(`Could not reach ${config.label} (${reason}). The service may be down or the network blocked.`);
  }

  const text = await response.text();
  if (!response.ok) throw new LlmError(describeHttpError(config, response.status, text), response.status);

  let content: unknown;
  try {
    content = JSON.parse(text)?.choices?.[0]?.message?.content;
  } catch {
    throw new LlmError(`${config.label} sent a response that is not valid JSON.`);
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmError(`${config.label} returned an empty answer.`);
  }
  return content;
}
