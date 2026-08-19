"use client";

import { useEffect, useState } from "react";
import { parseApiKeysText } from "@/lib/keys";

const LS_KEYS_TEXT = "yt2textbook:apiKeysText";
const LS_OLLAMA_URL = "yt2textbook:ollamaBaseUrl";

export function loadStoredSettings() {
  if (typeof window === "undefined") return { apiKeysText: "", ollamaBaseUrl: "" };
  return {
    apiKeysText: window.localStorage.getItem(LS_KEYS_TEXT) || "",
    ollamaBaseUrl: window.localStorage.getItem(LS_OLLAMA_URL) || "",
  };
}

const EXAMPLE = `GROQ=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GROQ=gsk_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
OPENROUTER=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GEMINI=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;

export default function SettingsDrawer({
  open,
  onClose,
  apiKeysText,
  setApiKeysText,
  ollamaBaseUrl,
  setOllamaBaseUrl,
}: {
  open: boolean;
  onClose: () => void;
  apiKeysText: string;
  setApiKeysText: (v: string) => void;
  ollamaBaseUrl: string;
  setOllamaBaseUrl: (v: string) => void;
}) {
  const [draft, setDraft] = useState(apiKeysText);
  const [ollamaDraft, setOllamaDraft] = useState(ollamaBaseUrl);

  useEffect(() => {
    setDraft(apiKeysText);
    setOllamaDraft(ollamaBaseUrl);
  }, [open, apiKeysText, ollamaBaseUrl]);

  if (!open) return null;

  const { keys, warnings } = parseApiKeysText(draft);
  const providerSummary = Object.entries(keys).map(([provider, list]) => ({
    provider,
    count: (list || []).length,
  }));

  function handleSave() {
    setApiKeysText(draft);
    setOllamaBaseUrl(ollamaDraft);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LS_KEYS_TEXT, draft);
      window.localStorage.setItem(LS_OLLAMA_URL, ollamaDraft);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-paper p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold text-ink">Provider keys</h2>
          <button
            onClick={onClose}
            className="rounded-sm px-2 py-1 text-ink-soft hover:bg-ink/5"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>
        <p className="mb-5 text-sm text-ink-soft">
          Same format as the CLI tool&apos;s <code className="font-mono text-xs">api_keys.txt</code> — one{" "}
          <code className="font-mono text-xs">PROVIDER=key</code> pair per line. Repeat a provider to build a
          rotation pool. Stored only in this browser&apos;s local storage; sent only to this app&apos;s own API
          routes when generating a chapter, never anywhere else.
        </p>

        <label className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Keys
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={EXAMPLE}
          rows={10}
          spellCheck={false}
          className="field-input mb-3 font-mono text-xs leading-relaxed"
        />

        {providerSummary.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {providerSummary.map(({ provider, count }) => (
              <span
                key={provider}
                className="rounded-sm border border-reel/40 bg-reel/10 px-2 py-1 font-mono text-xs text-reel-dark"
              >
                {provider} · {count} key{count !== 1 ? "s" : ""}
              </span>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-3 rounded-sm border border-press/30 bg-press/5 p-3 text-xs text-press-dark">
            {warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        <label className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Ollama base URL <span className="normal-case text-ink-soft/70">(optional, last-resort fallback)</span>
        </label>
        <input
          value={ollamaDraft}
          onChange={(e) => setOllamaDraft(e.target.value)}
          placeholder="http://localhost:11434 (only reachable if publicly tunneled)"
          className="field-input mb-1 font-mono text-xs"
        />
        <p className="mb-5 text-xs text-ink-soft/80">
          A deployed site can&apos;t reach your own laptop&apos;s localhost — only set this if you&apos;ve
          tunneled a real Ollama server (e.g. via Cloudflare Tunnel or ngrok) to a public URL.
        </p>

        <div className="mt-auto flex gap-3 pt-4">
          <button onClick={handleSave} className="btn-primary flex-1">
            Save
          </button>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
