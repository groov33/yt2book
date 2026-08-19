# Signatures — YouTube → Textbook, on Vercel

A Vercel-deployable web app with the same core function as the
[`youtube_to_textbook` CLI tool](#relationship-to-the-cli-tool): paste a
YouTube video or playlist URL, and get back a detailed, beautifully
formatted PDF textbook — built by an LLM behind a multi-provider fallback
chain (Groq → OpenRouter → Gemini → GitHub Models → Ollama), with a
compiled master book (table of contents + real PDF bookmarks) once every
chapter is done.

## Why this isn't a literal port

The CLI is one long-running process with a `progress.json` file on a real
filesystem. Vercel serverless functions are short-lived, stateless between
invocations, and have no persistent filesystem — so this app is built
around a different (and, for this use case, genuinely better-suited)
architecture:

- **The browser orchestrates, the server does short units of work.** Each
  API route does one small thing (fetch a transcript, generate one chapter,
  render one PDF, compile the final book) and returns — nothing runs longer
  than a single request. The browser calls these in sequence, chunk by
  chunk, showing progress as it goes.
- **"Resumability" lives in the browser, not on disk.** Every completed
  chunk's markdown + rendered PDF is cached in IndexedDB, keyed by
  video/chunk. A page refresh, closed tab, or failed request doesn't lose
  work — clicking **Resume** picks up exactly where it left off, and
  already-completed chunks are served from cache instantly with zero API
  calls.
- **Multi-provider fallback is immediate, not backoff-and-retry.** The CLI
  waits out real cooldowns because it's one long process with time to
  spare. Here, a failure on one provider/key moves on to the *next*
  provider immediately (see `lib/llmRouter.ts`) — there's no point waiting
  out a rate limit when four other providers are one HTTP call away.

## Architecture

```
Browser (app/page.tsx)
  │
  ├─▶ POST /api/metadata        → yt-dlp equivalent, via youtubei.js
  ├─▶ POST /api/transcript      → per-video transcript, via youtubei.js
  ├─▶ POST /api/generate-chapter → LLM call, multi-provider fallback chain
  ├─▶ POST /api/render-pdf      → markdown → styled PDF (Puppeteer + Chromium)
  └─▶ POST /api/compile-master  → merge parts + TOC + bookmarks (pdf-lib)
```

Chunking (`lib/chunker.ts`) is a direct line-for-line port of the CLI's
`core/chunker.py` — same balanced-splitting algorithm, same behavior.

## ⚠️ Before every deploy: check for Next.js/React security patches

Next.js and React have been through a serious, ongoing security saga since December 2025 — starting with a CVSS 10.0 unauthenticated RCE in the App Router's React Server Components protocol (CVE-2025-55182 / CVE-2025-66478), followed by several more rounds of high-severity DoS, SSRF, and cache-poisoning fixes roughly **monthly** since (Next.js has since formalized this into a scheduled monthly security-release program). This isn't a one-time fix.

`package.json` here uses caret ranges (`^15.5.21`, `^19.2.6`) rather than exact pins specifically so `npm install` picks up new patch releases automatically — the original version of this file exact-pinned `next@15.1.6`, which is exactly why a real `vercel build` log surfaced a CVE warning during review. **Don't repeat that mistake**: never exact-pin `next`/`react`/`react-dom` in this project.

Even so, caret ranges only help within the same minor-version line and only if you re-run `npm install` reasonably often — they won't save you if you deploy once and never touch the project again while new CVEs pile up. Before any deploy that matters:
1. Check https://nextjs.org/blog for the latest security release.
2. Run `npm outdated` / `npm update` (or Vercel's official `npx fix-react2shell-next` tool) to confirm you're on the current patched line.
3. If it's been a while since your last deploy, assume you're behind and update first.

## Deploying to Vercel

1. **Push this folder to a GitHub repo**, then import it in Vercel
   (New Project → import the repo). Vercel auto-detects Next.js — no
   build config needed beyond what's already in `vercel.json`.
2. **Environment variables are optional.** By default, every visitor
   enters their own provider keys in the app's Settings drawer (stored
   only in their browser, sent only to your deployment's own API routes).
   If this is a *personal* deployment, you can instead set
   `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`,
   `GITHUB_API_KEY` in Vercel's Project Settings → Environment Variables
   (see `.env.example`) so it works without opening Settings at all —
   client-entered keys and env-var keys are merged, not either/or.
3. **Deploy.** That's it — `vercel.json` already configures the
   Puppeteer-based routes (`render-pdf`, `compile-master`) with more
   memory (1536MB / 1024MB) and a longer duration (60s), since headless
   Chrome needs real resources.

### If PDF rendering times out on the Hobby plan

Vercel's Hobby plan caps serverless functions more tightly than Pro.
`render-pdf` launching headless Chromium can be slow on a cold start. If
you hit timeouts, either upgrade to Pro (60s+ durations, more memory), or
reduce `--parts`-equivalent (the "Split into N parts" field) so each
chapter's markdown is shorter and renders faster.

## Local development

```bash
npm install
npm run dev
```

Puppeteer's local dev path uses the same `@sparticuz/chromium` binary as
production — no separate local Chrome install needed, though a full
`puppeteer` install with a bundled browser is a reasonable swap for faster
local iteration if you prefer (`npm install puppeteer` and adjust
`app/api/render-pdf/route.ts` to use it when `NODE_ENV === "development"`).

## Notes & limitations (read this before assuming something is "broken")

- **YouTube blocking cloud IPs is a real, expected failure mode.** YouTube
  actively rate-limits and sometimes blocks automated metadata/transcript
  requests from datacenter IPs — which is exactly what Vercel's serverless
  functions have. This can surface as intermittent `/api/metadata` or
  `/api/transcript` failures that have nothing to do with a bug. Both
  failure paths in the UI fall back to **manual entry**: paste
  `videoId, Title` lines to build a playlist by hand, or paste a
  transcript directly for a video whose auto-fetch failed. This isn't a
  workaround bolted on as an afterthought — treat it as the normal path
  whenever auto-fetch is flaky, not just a last resort.
- **Provider/model churn.** Exactly like the CLI (see its README), the
  exact model ID string per provider in `lib/providers.ts` will go stale
  over time as providers rename or retire models. If one starts erroring
  outright, that's the one place to fix it — everything else routes
  around a single dead provider automatically anyway.
- **Request body size.** `/api/compile-master` sends every completed part
  PDF as base64 in one JSON request. For a very long book (many parts),
  this can approach Vercel's request body limit (~4.5MB by default for
  Node functions). If you hit this compiling a very large book, either
  reduce parts-per-video or compile in batches (not currently built in —
  flagging as a known ceiling, not a silent failure).
- **Ollama** is included as the final fallback but is only reachable if
  `OLLAMA_BASE_URL` (Settings drawer or env var) points at a *publicly
  reachable* address — a deployed Vercel function cannot reach your own
  laptop's `localhost`. Tunnel a real Ollama server (Cloudflare Tunnel,
  ngrok) if you want this fallback to actually work from production.
- **Key storage.** Provider keys entered in Settings live in
  `localStorage` only, and are sent exclusively to this deployment's own
  API routes as part of each chapter-generation request — never persisted
  server-side, never sent anywhere else.

## Testing & verification

Being upfront about exactly what's been verified here, and how, so you know what to trust versus what to watch for on first deploy.

**Environment constraint:** `npm install` is blocked at the sandbox's network-policy level (`403 host_not_allowed` on every package, confirmed via direct `curl` to the registry — not a transient issue). This means no `next build` or real Vercel dry-run happened. Everything below was verified by other means: unit tests against the actual shipped modules using `tsx` with dependencies available in this sandbox (`pdf-lib`, `playwright`, `marked`), direct invocation of the actual route handler functions with real `Request`/`Response` objects, and `esbuild` syntax validation across all 22 TypeScript/TSX files (zero failures, checked twice — once before and once after the fixes below, to catch regressions).

**Two real bugs were found and fixed, not just anticipated:**
1. `compileMaster.ts` — PDF bookmark titles were silently rendering as `null`. Root cause: pdf-lib's `context.obj()` converts plain JS strings to PDF *Names*, but `/Title` requires a PDF *String*. Fixed by wrapping with `PDFString.of()`. Caught by dumping bookmark data with `pdftk` and actually reading the output, not by inspection.
2. `compileMaster.ts` — long book titles overflowed the page margin. Font-shrinking alone wasn't enough for very long titles; needed real word-wrapping with ellipsis truncation. Caught by stress-testing with a 116-character title and looking at the rendered page.

**What was tested directly against the real shipped code:**
- `chunker.ts` — balanced-splitting behavior confirmed to match the Python CLI's output exactly, plus short-transcript and single-part edge cases.
- `keys.ts` — malformed lines, empty keys, unknown providers, duplicate-key dedup.
- `llmRouter.ts` — key rotation within a provider, fallthrough across providers, total-exhaustion handling, zero-providers-configured, **and** three failure modes beyond simple HTTP errors: thrown network exceptions (`ECONNREFUSED`), aborts/timeouts, HTTP 200 with a malformed/empty body, and HTTP 200 with a body that isn't even valid JSON. All correctly treated as a failed attempt and fall through to the next provider/key.
- `compileMaster.ts` — rendered real PDFs via Playwright and compiled them end-to-end, then inspected the output with `pdftk`/`qpdf`: correct page-accurate TOC numbering, correct bookmark titles, correct GoTo link destinations (verified all pointing to distinct page objects, not collapsed to one). Also specifically tested the **multi-page TOC branch** (40 chapters, forcing a 2-page TOC) — confirmed all 40 links present across both pages with unique destinations — and the single-part minimum case.
- `processChunk.ts` — full cache-miss → generate → render → cache-write cycle, and confirmed a second identical call is served entirely from cache with **zero** additional network calls. Also tested error propagation: a failed `/api/generate-chapter` response's detailed per-provider error message correctly reaches the caller unmangled.
- `blobBase64.ts` — round-trip byte-for-byte correctness on a 2MB payload (large enough to trigger the stack-overflow failure mode that a naive `String.fromCharCode.apply` implementation would hit; this implementation doesn't).
- `youtubeUrl.ts` — 10 real-world URL shapes (standard watch URLs, `youtu.be`, shorts, playlist URLs with/without extra query params, video-within-playlist URLs, garbage input) and the `toText()` normalizer against 10 different object shapes youtubei.js is known to return.
- **API route handlers themselves** (not just their underlying libraries) — imported the actual `POST` export from `render`-independent routes and called them with real `Request` objects: valid-request success paths, missing-field validation (400s), malformed JSON (400s), malformed nested data (500s with clear messages), and zero-providers-configured (502). Also stubbed `youtubei.js` to test `metadata`/`transcript` route validation and error-surfacing without needing real network access.
- **Playlist pagination** (`getSourceMetadata`'s continuation-page loop) — simulated a 3-page paginated playlist and confirmed all entries collected with no duplicates or gaps, and separately simulated an "infinite" playlist to confirm the `MAX_PLAYLIST_VIDEOS` safety cap actually stops it (300 entries, ~1ms, not an infinite loop).
- `render-pdf`'s Puppeteer options — empirically confirmed (by rendering both ways and diffing page dimensions) that `preferCSSPageSize: true` is needed for the shared `@page` CSS margins to be the single source of truth, rather than accidentally depending on Puppeteer's separate `format`/`margin` options matching the CSS by coincidence.

**What's still unverified (the honest gaps):**
- `lib/youtube.ts`'s actual integration with the real `youtubei.js` library and real YouTube responses — the pagination/URL-parsing *logic* is tested against realistic simulated shapes, but not against the live API, since there's no network access to YouTube from this sandbox. This is also the piece most exposed to YouTube's anti-automation measures in production regardless of correctness — see the dedicated note above.
- A real `next build` / Vercel deployment, React rendering correctness, and browser runtime behavior (IndexedDB in a real browser, actual file downloads, CSS layout as rendered by an actual browser rather than reasoned about from the Tailwind classes).
- Puppeteer + `@sparticuz/chromium` actually launching inside a real Vercel serverless container — the HTML→PDF *pipeline logic* was validated with Playwright's Chromium locally (same underlying rendering engine, different launch mechanism), but the serverless-specific packaging (`chromium.executablePath()`, memory/duration config in `vercel.json`) is unverified beyond following the standard, widely-used pattern for this combo.



This is the same underlying pipeline (manual chunking → multi-provider LLM
fallback → styled PDF → compiled master book with TOC/bookmarks) rebuilt
around Vercel's serverless model instead of a long-running local process.
If you want the original `progress.json`-based CLI instead — useful for
very large playlists where browser-side orchestration is less convenient,
or if you'd rather run it unattended overnight — that's the separate
`youtube_to_textbook` Python project.
