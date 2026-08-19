import { generateChapterText, AllProvidersExhaustedError, type ChatMessage } from "@/lib/llmRouter";
import type { ProviderKey } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

// Optional server-side fallback: if this is a personal deployment, set
// these in Vercel's Project Settings -> Environment Variables and every
// visitor gets a working pool without needing to open Settings at all.
// Client-provided keys (from the browser's Settings drawer) are merged in
// alongside these, not replaced by them.
function mergeWithEnvKeys(
  clientKeys: Partial<Record<ProviderKey, string[]>>
): Partial<Record<ProviderKey, string[]>> {
  const merged: Partial<Record<ProviderKey, string[]>> = { ...clientKeys };
  const envMap: Partial<Record<ProviderKey, string | undefined>> = {
    GROQ: process.env.GROQ_API_KEY,
    OPENROUTER: process.env.OPENROUTER_API_KEY,
    GEMINI: process.env.GEMINI_API_KEY,
    GITHUB: process.env.GITHUB_API_KEY,
  };
  (Object.entries(envMap) as [ProviderKey, string | undefined][]).forEach(([provider, envKey]) => {
    if (!envKey) return;
    const existing = merged[provider] || [];
    if (!existing.includes(envKey)) {
      merged[provider] = [...existing, envKey];
    }
  });
  return merged;
}

const SYSTEM_PROMPT =
  "You are an expert technical author. Convert this video transcript chunk into a " +
  "detailed, comprehensive textbook chapter. Do NOT just summarize. Include every " +
  "concept, analogy, and important point. Format extensively with Markdown (H1, H2, " +
  "H3, bullet points, blockquotes for important notes). If the text implies code, " +
  "formulas, or physical setups (like microcontrollers or wiring), format them " +
  "clearly as code blocks or step-by-step physical procedures. The reader has no " +
  "visual access to the video, so describe the implied visual context perfectly " +
  "based on the audio.";

function buildPrompt(
  chunkText: string,
  partNum: number,
  totalParts: number,
  videoTitle: string,
  prevContext: string
): string {
  const continuity = prevContext
    ? `For continuity, the previous section ended by discussing: "${prevContext}". `
    : "";
  return (
    `You are writing Part ${partNum} of ${totalParts} of a textbook chapter derived ` +
    `from the video "${videoTitle}". ${continuity}Continue the material naturally as ` +
    `if this were the next section of an ongoing textbook. Do not repeat a fresh ` +
    `introduction unless this is Part 1.\n\n---TRANSCRIPT CHUNK---\n${chunkText}`
  );
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { chunkText, partNum, totalParts, videoTitle, prevContext, providerKeys, ollamaBaseUrl } =
    body || {};

  if (!chunkText || !partNum || !totalParts || !videoTitle) {
    return Response.json(
      { error: "Missing one of: chunkText, partNum, totalParts, videoTitle." },
      { status: 400 }
    );
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildPrompt(chunkText, partNum, totalParts, videoTitle, prevContext || "") },
  ];

  try {
    const { text, provider } = await generateChapterText(messages, {
      providerKeys: mergeWithEnvKeys(providerKeys || {}),
      ollamaBaseUrl,
    });
    return Response.json({ markdown: text, provider });
  } catch (e: any) {
    if (e instanceof AllProvidersExhaustedError) {
      return Response.json({ error: e.message, attempts: e.attempts }, { status: 502 });
    }
    return Response.json({ error: e?.message || "Chapter generation failed." }, { status: 500 });
  }
}
