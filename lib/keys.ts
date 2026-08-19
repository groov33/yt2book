/**
 * Parses api_keys.txt-style text (same format as the CLI tool) into a
 * rotation pool of API keys per provider.
 *
 * Format -- one `PROVIDER=key` pair per line:
 *
 *   GROQ=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxx
 *   GROQ=gsk_yyyyyyyyyyyyyyyyyyyyyyyyyy
 *   OPENROUTER=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   GEMINI=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   GITHUB=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *
 * Repeating the same PROVIDER on multiple lines builds a rotation pool of
 * several keys for that provider. Blank lines and lines starting with `#`
 * are ignored. This is intentionally the exact same format as the CLI's
 * api_keys.txt, so keys can be copy-pasted between the two.
 */

import type { ProviderKey } from "./providers";

export interface ParsedKeys {
  keys: Partial<Record<ProviderKey, string[]>>;
  warnings: string[];
}

const KNOWN_PROVIDERS: ProviderKey[] = ["GROQ", "OPENROUTER", "GEMINI", "GITHUB", "OLLAMA"];

export function parseApiKeysText(text: string): ParsedKeys {
  const keys: Partial<Record<ProviderKey, string[]>> = {};
  const warnings: string[] = [];

  const lines = (text || "").split("\n");

  lines.forEach((rawLine, idx) => {
    const lineno = idx + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      warnings.push(`line ${lineno}: skipped -- expected PROVIDER=KEY, got: ${JSON.stringify(line)}`);
      return;
    }

    const provider = line.slice(0, eqIdx).trim().toUpperCase();
    const key = line.slice(eqIdx + 1).trim();

    if (!provider) {
      warnings.push(`line ${lineno}: skipped -- missing provider name`);
      return;
    }
    if (!KNOWN_PROVIDERS.includes(provider as ProviderKey)) {
      warnings.push(
        `line ${lineno}: unknown provider '${provider}' (expected one of ${KNOWN_PROVIDERS.join(", ")}) -- skipped`
      );
      return;
    }
    if (!key && provider !== "OLLAMA") {
      warnings.push(`line ${lineno}: skipped -- '${provider}' has an empty key`);
      return;
    }

    const p = provider as ProviderKey;
    if (!keys[p]) keys[p] = [];
    if (!keys[p]!.includes(key)) {
      keys[p]!.push(key);
    }
  });

  return { keys, warnings };
}
