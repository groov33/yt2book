"use client";

export type ChunkStatus = "pending" | "generating" | "rendering" | "done" | "error";

export interface SignatureItem {
  label: string;
  status: ChunkStatus;
  provider?: string;
  error?: string;
}

const STATUS_STYLES: Record<ChunkStatus, string> = {
  pending: "bg-paper border-line",
  generating: "bg-gilt/40 border-gilt animate-pulse",
  rendering: "bg-reel/40 border-reel animate-pulse",
  done: "bg-press border-press",
  error: "bg-ink border-ink",
};

/**
 * The app's signature visual element: each tab represents one "signature"
 * in the bookbinding sense -- a folded, gathered section of a book. As
 * each chunk is generated and rendered, its tab fills in, so the strip
 * reads left-to-right exactly like the book's own table of contents will.
 */
export default function SignatureStrip({ items }: { items: SignatureItem[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="list" aria-label="Chapter generation progress">
      {items.map((item, i) => (
        <div key={i} className="group relative" role="listitem">
          <div
            className={`h-7 w-4 rounded-[2px] border-2 transition-colors duration-300 ${STATUS_STYLES[item.status]}`}
            aria-label={`${item.label}: ${item.status}`}
          />
          <div
            className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-max max-w-xs -translate-x-1/2
                       rounded-sm border border-line bg-paper px-2.5 py-1.5 text-xs font-body text-ink opacity-0
                       shadow-md transition-opacity duration-150 group-hover:opacity-100"
          >
            <div className="font-semibold">{item.label}</div>
            <div className="text-ink-soft capitalize">
              {item.status}
              {item.provider ? ` · via ${item.provider}` : ""}
            </div>
            {item.error && <div className="mt-0.5 max-w-[220px] text-press-dark">{item.error}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
