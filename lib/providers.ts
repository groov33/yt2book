/**
 * Provider configuration for the multi-provider LLM fallback chain.
 *
 * All five providers are reachable through an OpenAI-compatible
 * `/chat/completions` endpoint, which is what makes a single unified
 * caller (see llmRouter.ts) possible instead of five different SDKs:
 *   - Groq:        native OpenAI-compatible API
 *   - OpenRouter:  native OpenAI-compatible API (that's its whole design)
 *   - Gemini:      Google's OpenAI-compatibility layer
 *   - GitHub Models: OpenAI-compatible inference endpoint
 *   - Ollama:      OpenAI-compatible mode, for a *reachable* Ollama host
 *                  (a Vercel function cannot reach your actual laptop's
 *                  localhost -- set OLLAMA_BASE_URL to a publicly
 *                  reachable tunnel/host if you want this fallback to work
 *                  from a deployed site)
 *
 * Provider/model identifiers shift over time -- if one of these starts
 * erroring outright, this is the one place to update it.
 */

export type ProviderKey = "GROQ" | "OPENROUTER" | "GEMINI" | "GITHUB" | "OLLAMA";

export interface ProviderConfig {
  key: ProviderKey;
  label: string;
  baseUrl: string;
  model: string;
  requiresKey: boolean;
  /** Extra headers some providers want beyond the Authorization bearer token. */
  extraHeaders?: Record<string, string>;
}

// Fallback priority: if every key for a provider fails, the router moves
// on to the next provider in this list.
export const PROVIDER_PRIORITY_ORDER: ProviderKey[] = [
  "GROQ",
  "OPENROUTER",
  "GEMINI",
  "GITHUB",
  "OLLAMA",
];

export function getProviderConfigs(ollamaBaseUrl?: string): Record<ProviderKey, ProviderConfig> {
  return {
    GROQ: {
      key: "GROQ",
      label: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      requiresKey: true,
    },
    OPENROUTER: {
      key: "OPENROUTER",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "meta-llama/llama-3.3-70b-instruct:free",
      requiresKey: true,
      extraHeaders: {
        "HTTP-Referer": "https://github.com/",
        "X-Title": "YouTube to Textbook",
      },
    },
    GEMINI: {
      key: "GEMINI",
      label: "Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.6-flash",
      requiresKey: true,
    },
    GITHUB: {
      key: "GITHUB",
      label: "GitHub Models",
      baseUrl: "https://models.github.ai/inference",
      model: "openai/gpt-4o-mini",
      requiresKey: true,
    },
    OLLAMA: {
      key: "OLLAMA",
      label: "Ollama",
      baseUrl: `${(ollamaBaseUrl || "http://localhost:11434").replace(/\/$/, "")}/v1`,
      model: "llama3.1",
      requiresKey: false,
    },
  };
}

export const MAX_OUTPUT_TOKENS = 8000;
