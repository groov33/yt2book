/**
 * Multi-provider LLM fallback caller for the "generate a textbook chapter"
 * task, run server-side inside a single API route invocation.
 *
 * Design note (why this differs from the CLI's litellm.Router): the CLI is
 * one long-lived process, so it's worth waiting out real cooldowns and
 * retrying the *same* key with exponential backoff. A Vercel serverless
 * function is short-lived and stateless between invocations, and -- unlike
 * the CLI -- this app has multiple genuinely different providers on tap.
 * So instead of sleeping and retrying the same key, a failure here moves
 * on immediately to the next key/provider in priority order. Only once
 * every configured key across every provider has failed does this
 * function give up and return a combined error. The browser-side caller
 * is responsible for pacing/retrying a whole chunk if it wants to (e.g.
 * after the person adds more keys).
 */

import {
  PROVIDER_PRIORITY_ORDER,
  getProviderConfigs,
  MAX_OUTPUT_TOKENS,
  type ProviderKey,
} from "./providers";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AttemptResult {
  provider: ProviderKey;
  ok: boolean;
  error?: string;
  status?: number;
}

export class AllProvidersExhaustedError extends Error {
  attempts: AttemptResult[];
  constructor(message: string, attempts: AttemptResult[]) {
    super(message);
    this.name = "AllProvidersExhaustedError";
    this.attempts = attempts;
  }
}

interface CallOptions {
  providerKeys: Partial<Record<ProviderKey, string[]>>;
  ollamaBaseUrl?: string;
  timeoutMs?: number;
}

async function callOpenAICompatible(
  baseUrl: string,
  model: string,
  apiKey: string | undefined,
  messages: ChatMessage[],
  extraHeaders: Record<string, string> | undefined,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(extraHeaders || {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.text();
        detail = body.slice(0, 500);
      } catch {
        // ignore
      }
      const err: any = new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || typeof text !== "string") {
      throw new Error("Provider returned an empty or malformed response.");
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tries every key for every provider in priority order (Groq -> OpenRouter
 * -> Gemini -> GitHub Models -> Ollama) until one succeeds. Returns the
 * generated text plus which provider actually served the request (useful
 * for the UI to show, e.g., "generated via Groq").
 */
export async function generateChapterText(
  messages: ChatMessage[],
  options: CallOptions
): Promise<{ text: string; provider: ProviderKey }> {
  const providerConfigs = getProviderConfigs(options.ollamaBaseUrl);
  const timeoutMs = options.timeoutMs ?? 55_000;
  const attempts: AttemptResult[] = [];

  for (const providerKey of PROVIDER_PRIORITY_ORDER) {
    const config = providerConfigs[providerKey];
    const keysForProvider = options.providerKeys[providerKey] || [];

    // Ollama needs no key -- treat it as having exactly one "slot" to try.
    const candidateKeys = config.requiresKey ? keysForProvider : [""];
    if (config.requiresKey && candidateKeys.length === 0) {
      continue; // no keys configured for this provider, skip entirely
    }

    for (const apiKey of candidateKeys) {
      try {
        const text = await callOpenAICompatible(
          config.baseUrl,
          config.model,
          config.requiresKey ? apiKey : undefined,
          messages,
          config.extraHeaders,
          timeoutMs
        );
        attempts.push({ provider: providerKey, ok: true });
        return { text, provider: providerKey };
      } catch (e: any) {
        attempts.push({
          provider: providerKey,
          ok: false,
          error: e?.message || String(e),
          status: e?.status,
        });
        // Any failure (rate limit, server error, bad key, timeout) moves
        // on to the next key/provider immediately -- see module doc above
        // for why this differs from the CLI's backoff-and-retry approach.
        continue;
      }
    }
  }

  const summary = attempts
    .map((a) => `${a.provider}${a.status ? ` (HTTP ${a.status})` : ""}: ${a.error}`)
    .join(" | ");

  throw new AllProvidersExhaustedError(
    attempts.length === 0
      ? "No providers are configured. Add at least one PROVIDER=key line in Settings."
      : `Every configured provider/key failed for this chunk. ${summary}`,
    attempts
  );
}
