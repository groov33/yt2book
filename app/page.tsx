"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SettingsDrawer, { loadStoredSettings } from "@/components/SettingsDrawer";
import SignatureStrip from "@/components/SignatureStrip";
import { chunkTranscript } from "@/lib/chunker";
import { parseApiKeysText } from "@/lib/keys";
import { processChunk } from "@/lib/processChunk";
import { blobToBase64 } from "@/lib/blobBase64";
import type { ChunkState, VideoState, SourceMeta } from "@/lib/pipelineTypes";

function extractTailContext(markdown: string, maxChars = 300): string {
  const plain = markdown.trim().replace(/\n/g, " ");
  return plain.slice(-maxChars);
}

function labelFor(meta: SourceMeta, videoIdx: number, videoTitle: string, partIdx: number): string {
  return meta.type === "video"
    ? `Part ${String(partIdx + 1).padStart(2, "0")}`
    : `Video ${String(videoIdx + 1).padStart(2, "0")}: ${videoTitle}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}

export default function Page() {
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<SourceMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [showManualMeta, setShowManualMeta] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualEntries, setManualEntries] = useState("");

  const [parts, setParts] = useState(10);
  const [videos, setVideos] = useState<VideoState[]>([]);
  const videosRef = useRef<VideoState[]>([]);
  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeysText, setApiKeysText] = useState("");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("");

  const [masterBlob, setMasterBlob] = useState<Blob | null>(null);
  const [compilingMaster, setCompilingMaster] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadStoredSettings();
    setApiKeysText(stored.apiKeysText);
    setOllamaBaseUrl(stored.ollamaBaseUrl);
  }, []);

  const { keys: parsedKeys } = useMemo(() => parseApiKeysText(apiKeysText), [apiKeysText]);
  const hasAnyKeys = Object.keys(parsedKeys).length > 0 || !!ollamaBaseUrl.trim();

  function updateChunk(videoIdx: number, chunkIdx: number, patch: Partial<ChunkState>) {
    setVideos((prev) => {
      const next = prev.slice();
      const v = { ...next[videoIdx] };
      const chunks = v.chunks.slice();
      chunks[chunkIdx] = { ...chunks[chunkIdx], ...patch };
      v.chunks = chunks;
      next[videoIdx] = v;
      return next;
    });
  }

  function updateVideo(videoIdx: number, patch: Partial<VideoState>) {
    setVideos((prev) => {
      const next = prev.slice();
      next[videoIdx] = { ...next[videoIdx], ...patch };
      return next;
    });
  }

  function applyMeta(m: SourceMeta) {
    setMeta(m);
    setVideos(
      m.entries.map((e) => ({
        id: e.id,
        title: e.title,
        manualTranscriptDraft: "",
        chunks: [],
      }))
    );
    setMasterBlob(null);
    setMasterError(null);
    setRunError(null);
    setShowManualMeta(false);
  }

  async function handleLoadMetadata() {
    if (!url.trim()) return;
    setLoadingMeta(true);
    setMetaError(null);
    setMeta(null);
    try {
      const res = await fetch("/api/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      applyMeta(data);
    } catch (e: any) {
      setMetaError(e?.message || "Failed to load metadata.");
      setShowManualMeta(true);
    } finally {
      setLoadingMeta(false);
    }
  }

  function handleManualMetadataSubmit() {
    const lines = manualEntries
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const isPlaylist = lines.length > 1;
    const entries = lines.map((line) => {
      const [id, ...rest] = line.split(",");
      const trimmedId = id.trim();
      return { id: trimmedId, title: rest.join(",").trim() || trimmedId };
    });
    const m: SourceMeta = {
      type: isPlaylist ? "playlist" : "video",
      id: entries[0].id,
      title: manualTitle.trim() || (isPlaylist ? "Manual Playlist" : entries[0].title),
      entries,
    };
    applyMeta(m);
  }

  async function fetchTranscriptForVideo(videoIdx: number, videoId: string): Promise<string | null> {
    try {
      const res = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      return data.transcript as string;
    } catch (e: any) {
      updateVideo(videoIdx, { transcriptError: e?.message || "Failed to fetch transcript." });
      return null;
    }
  }

  async function handleStart() {
    if (!meta) return;
    if (!hasAnyKeys) {
      setSettingsOpen(true);
      return;
    }

    stopRef.current = false;
    setRunning(true);
    setRunError(null);

    const numPartsPerVideo = meta.type === "video" ? Math.max(1, parts) : 1;

    for (let vIdx = 0; vIdx < meta.entries.length; vIdx++) {
      if (stopRef.current) break;
      const entry = meta.entries[vIdx];
      const snapshot = videosRef.current[vIdx];

      let transcript = snapshot?.transcript;
      if (!transcript) {
        const manualDraft = snapshot?.manualTranscriptDraft?.trim();
        transcript = manualDraft || (await fetchTranscriptForVideo(vIdx, entry.id)) || undefined;
        if (!transcript) continue; // error already recorded on the video; skip to next
        updateVideo(vIdx, { transcript, transcriptError: undefined });
      }

      const chunkTexts = chunkTranscript(transcript, numPartsPerVideo);
      const initialChunks: ChunkState[] = chunkTexts.map((text, i) => ({
        index: i,
        label: labelFor(meta, vIdx, entry.title, i),
        chunkText: text,
        status: "pending",
      }));
      updateVideo(vIdx, { chunks: initialChunks });

      let prevContext = "";
      for (let cIdx = 0; cIdx < chunkTexts.length; cIdx++) {
        if (stopRef.current) break;
        const chunkText = chunkTexts[cIdx];
        const label = labelFor(meta, vIdx, entry.title, cIdx);

        if (!chunkText.trim()) {
          const md = `# ${label}\n\n*(No transcript content for this section.)*\n`;
          updateChunk(vIdx, cIdx, { status: "done", markdown: md });
          prevContext = extractTailContext(md);
          continue;
        }

        updateChunk(vIdx, cIdx, { status: "generating" });
        try {
          const result = await processChunk(
            {
              projectId: `${meta.type}-${meta.id}`,
              videoId: entry.id,
              chunkIndex: cIdx,
              chunkText,
              partNum: cIdx + 1,
              totalParts: chunkTexts.length,
              videoTitle: entry.title,
              prevContext,
              label,
              providerKeysRaw: apiKeysText,
              providerKeys: parsedKeys as Record<string, string[]>,
              ollamaBaseUrl,
            },
            (status) => updateChunk(vIdx, cIdx, { status })
          );
          updateChunk(vIdx, cIdx, {
            status: "done",
            markdown: result.markdown,
            pdfBlob: result.pdfBlob,
            provider: result.provider,
          });
          prevContext = extractTailContext(result.markdown);
        } catch (e: any) {
          const message = e?.message || "Generation failed.";
          updateChunk(vIdx, cIdx, { status: "error", error: message });
          setRunError(message);
          setRunning(false);
          return;
        }
      }
    }

    setRunning(false);
  }

  function handleStop() {
    stopRef.current = true;
  }

  const allChunks = videos.flatMap((v) => v.chunks);
  const totalChunks = allChunks.length;
  const doneChunks = allChunks.filter((c) => c.status === "done").length;
  const anyDone = doneChunks > 0;
  const allDone = totalChunks > 0 && doneChunks === totalChunks && !running;

  async function handleCompileMaster() {
    if (!meta) return;
    setCompilingMaster(true);
    setMasterError(null);
    try {
      const partsPayload: { label: string; pdfBase64: string }[] = [];
      for (const v of videos) {
        for (const c of v.chunks) {
          if (c.status === "done" && c.pdfBlob) {
            partsPayload.push({ label: c.label, pdfBase64: await blobToBase64(c.pdfBlob) });
          }
        }
      }
      if (partsPayload.length === 0) throw new Error("No completed parts to compile.");

      const res = await fetch("/api/compile-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookTitle: meta.title, parts: partsPayload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      setMasterBlob(blob);
    } catch (e: any) {
      setMasterError(e?.message || "Failed to compile master book.");
    } finally {
      setCompilingMaster(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-14">
      <header className="mb-10 flex items-start justify-between">
        <div>
          <h1 className="font-display text-4xl font-semibold text-ink">Signatures</h1>
          <p className="mt-1 font-body text-sm text-ink-soft">
            Turn any lecture into a book. Paste a YouTube video or playlist below.
          </p>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="btn-secondary shrink-0"
          aria-label="Provider key settings"
        >
          Keys{" "}
          {Object.keys(parsedKeys).length > 0 && (
            <span className="ml-1 rounded-full bg-reel px-1.5 py-0.5 text-[10px] text-paper">
              {Object.keys(parsedKeys).length}
            </span>
          )}
        </button>
      </header>

      {/* URL input */}
      <section className="card mb-8">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
          YouTube video or playlist URL
        </label>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLoadMetadata()}
            placeholder="https://youtube.com/watch?v=... or /playlist?list=..."
            className="field-input font-mono text-sm"
          />
          <button onClick={handleLoadMetadata} disabled={loadingMeta || !url.trim()} className="btn-primary shrink-0">
            {loadingMeta ? "Loading…" : "Load"}
          </button>
        </div>

        {metaError && (
          <div className="mt-3 rounded-sm border border-press/30 bg-press/5 p-3 text-sm text-press-dark">
            {metaError}
            <div className="mt-1 text-xs text-ink-soft">
              YouTube sometimes blocks automated requests from cloud servers — this can happen even when
              nothing is wrong with the URL. Enter the video/playlist details manually below instead.
            </div>
          </div>
        )}

        {showManualMeta && (
          <div className="mt-4 border-t border-line pt-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Book title
            </label>
            <input
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              placeholder="e.g. The Complete Next.js Course"
              className="field-input mb-3 text-sm"
            />
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Video ID, Title — one per line (multiple lines = playlist)
            </label>
            <textarea
              value={manualEntries}
              onChange={(e) => setManualEntries(e.target.value)}
              placeholder={"dQw4w9WgXcQ, Introduction to Next.js\nctBJuUXZJUc, Creating Our First App"}
              rows={4}
              className="field-input mb-3 font-mono text-xs"
            />
            <button onClick={handleManualMetadataSubmit} className="btn-secondary">
              Use this instead
            </button>
          </div>
        )}
      </section>

      {/* Configuration + parts selector */}
      {meta && (
        <section className="card mb-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-xl font-semibold text-ink">{meta.title}</div>
              <div className="mt-0.5 font-mono text-xs uppercase tracking-wide text-ink-soft">
                {meta.type} · {meta.entries.length} video{meta.entries.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>

          {meta.type === "video" && (
            <div className="mt-4 flex items-center gap-3">
              <label className="text-sm text-ink-soft">Split into</label>
              <input
                type="number"
                min={1}
                max={60}
                value={parts}
                onChange={(e) => setParts(Math.max(1, parseInt(e.target.value) || 1))}
                className="field-input w-20 text-center"
              />
              <span className="text-sm text-ink-soft">parts</span>
            </div>
          )}

          {!hasAnyKeys && (
            <div className="mt-4 rounded-sm border border-gilt/40 bg-gilt/10 p-3 text-sm text-ink">
              Add at least one provider key before starting.{" "}
              <button onClick={() => setSettingsOpen(true)} className="font-semibold underline">
                Open settings
              </button>
            </div>
          )}

          <div className="mt-5 flex gap-3">
            <button onClick={handleStart} disabled={running} className="btn-primary">
              {running ? "Generating…" : totalChunks > 0 ? "Resume" : "Start"}
            </button>
            {running && (
              <button onClick={handleStop} className="btn-secondary">
                Stop
              </button>
            )}
          </div>

          {runError && (
            <div className="mt-4 rounded-sm border border-press/30 bg-press/5 p-3 text-sm text-press-dark">
              <div className="font-semibold">Stopped: every configured provider failed.</div>
              <div className="mt-1">{runError}</div>
              <div className="mt-2 text-xs text-ink-soft">
                Nothing is lost — completed parts are cached in this browser. Add more keys and click{" "}
                <strong>Resume</strong>.
              </div>
            </div>
          )}
        </section>
      )}

      {/* Progress + per-video breakdown */}
      {videos.length > 0 && videos.some((v) => v.chunks.length > 0) && (
        <section className="mb-8 space-y-6">
          {videos.map((video, vIdx) => {
            if (video.chunks.length === 0 && !video.transcriptError) return null;
            return (
              <div key={video.id} className="card">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-body text-sm font-semibold text-ink">
                    {meta?.type === "playlist" ? `${vIdx + 1}. ${video.title}` : video.title}
                  </div>
                  {video.chunks.length > 0 && (
                    <div className="font-mono text-xs text-ink-soft">
                      {video.chunks.filter((c) => c.status === "done").length}/{video.chunks.length}
                    </div>
                  )}
                </div>

                {video.transcriptError && (
                  <div className="mb-3 rounded-sm border border-press/30 bg-press/5 p-3 text-xs text-press-dark">
                    {video.transcriptError}
                    <textarea
                      value={video.manualTranscriptDraft}
                      onChange={(e) => updateVideo(vIdx, { manualTranscriptDraft: e.target.value })}
                      placeholder="Paste the transcript text here, then click Resume above."
                      rows={3}
                      className="field-input mt-2 font-mono text-xs"
                    />
                  </div>
                )}

                {video.chunks.length > 0 && (
                  <>
                    <SignatureStrip
                      items={video.chunks.map((c) => ({
                        label: c.label,
                        status: c.status,
                        provider: c.provider,
                        error: c.error,
                      }))}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {video.chunks
                        .filter((c) => c.status === "done" && c.pdfBlob)
                        .map((c) => (
                          <button
                            key={c.index}
                            onClick={() => downloadBlob(c.pdfBlob!, `${c.label}.pdf`)}
                            className="rounded-sm border border-line bg-paper px-2.5 py-1 font-mono text-xs
                                       text-ink-soft hover:border-press hover:text-press-dark"
                          >
                            ↓ {c.label}
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Master book compile */}
      {anyDone && (
        <section className="card">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-display text-lg font-semibold text-ink">Master textbook</div>
              <div className="text-sm text-ink-soft">
                {doneChunks} of {totalChunks} parts ready
                {allDone ? "" : running ? " (still generating…)" : " — some parts incomplete"}
              </div>
            </div>
            <button onClick={handleCompileMaster} disabled={compilingMaster} className="btn-primary shrink-0">
              {compilingMaster ? "Compiling…" : "Compile"}
            </button>
          </div>

          {masterError && <div className="mt-3 text-sm text-press-dark">{masterError}</div>}

          {masterBlob && (
            <button
              onClick={() => downloadBlob(masterBlob, `${meta?.title || "Textbook"}.pdf`)}
              className="btn-secondary mt-4 w-full"
            >
              ↓ Download {meta?.title}.pdf
            </button>
          )}
        </section>
      )}

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiKeysText={apiKeysText}
        setApiKeysText={setApiKeysText}
        ollamaBaseUrl={ollamaBaseUrl}
        setOllamaBaseUrl={setOllamaBaseUrl}
      />
    </main>
  );
}
