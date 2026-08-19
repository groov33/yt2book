export type ChunkStatus = "pending" | "generating" | "rendering" | "done" | "error";

export interface ChunkState {
  index: number;
  label: string;
  chunkText: string;
  status: ChunkStatus;
  markdown?: string;
  pdfBlob?: Blob;
  provider?: string;
  error?: string;
}

export interface VideoState {
  id: string;
  title: string;
  transcript?: string;
  transcriptError?: string;
  manualTranscriptDraft: string;
  chunks: ChunkState[];
}

export interface SourceMeta {
  type: "video" | "playlist";
  id: string;
  title: string;
  entries: { id: string; title: string }[];
}
