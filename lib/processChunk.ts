import { idbGet, idbSet } from "./idb";
import { blobToBase64 } from "./blobBase64";

interface CachedChunk {
  markdown: string;
  pdfBase64: string;
  provider?: string;
}

export interface ProcessChunkParams {
  projectId: string;
  videoId: string;
  chunkIndex: number;
  chunkText: string;
  partNum: number;
  totalParts: number;
  videoTitle: string;
  prevContext: string;
  label: string;
  providerKeysRaw: string; // raw api_keys.txt-style text, parsed server-side too but we send parsed here
  providerKeys: Record<string, string[]>;
  ollamaBaseUrl: string;
}

export interface ProcessChunkResult {
  markdown: string;
  pdfBlob: Blob;
  provider?: string;
  fromCache: boolean;
}

function cacheKey(p: Pick<ProcessChunkParams, "projectId" | "videoId" | "chunkIndex">) {
  return `chunk:${p.projectId}:${p.videoId}:${p.chunkIndex}`;
}

export async function checkCachedChunk(
  p: Pick<ProcessChunkParams, "projectId" | "videoId" | "chunkIndex">
): Promise<ProcessChunkResult | null> {
  try {
    const cached = await idbGet<CachedChunk>(cacheKey(p));
    if (!cached) return null;
    const byteChars = atob(cached.pdfBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const pdfBlob = new Blob([bytes], { type: "application/pdf" });
    return { markdown: cached.markdown, pdfBlob, provider: cached.provider, fromCache: true };
  } catch {
    return null;
  }
}

/** Runs the two-step pipeline (generate chapter text, render it to a
 * styled PDF) for a single chunk, and caches the result in IndexedDB so a
 * page refresh doesn't re-generate work that's already done. */
export async function processChunk(
  params: ProcessChunkParams,
  onStatus?: (status: "generating" | "rendering") => void
): Promise<ProcessChunkResult> {
  const cached = await checkCachedChunk(params);
  if (cached) return cached;

  onStatus?.("generating");
  const genRes = await fetch("/api/generate-chapter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chunkText: params.chunkText,
      partNum: params.partNum,
      totalParts: params.totalParts,
      videoTitle: params.videoTitle,
      prevContext: params.prevContext,
      providerKeys: params.providerKeys,
      ollamaBaseUrl: params.ollamaBaseUrl,
    }),
  });
  const genData = await genRes.json();
  if (!genRes.ok) {
    throw new Error(genData?.error || `Chapter generation failed (HTTP ${genRes.status}).`);
  }
  const markdown: string = genData.markdown;
  const provider: string | undefined = genData.provider;

  onStatus?.("rendering");
  const pdfRes = await fetch("/api/render-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, title: params.label }),
  });
  if (!pdfRes.ok) {
    const errData = await pdfRes.json().catch(() => ({}));
    throw new Error(errData?.error || `PDF rendering failed (HTTP ${pdfRes.status}).`);
  }
  const pdfBlob = await pdfRes.blob();

  try {
    const pdfBase64 = await blobToBase64(pdfBlob);
    await idbSet(cacheKey(params), { markdown, pdfBase64, provider } as CachedChunk);
  } catch {
    // Caching is best-effort -- if IndexedDB is unavailable (e.g. private
    // browsing) the run still proceeds, just without resumability.
  }

  return { markdown, pdfBlob, provider, fromCache: false };
}
