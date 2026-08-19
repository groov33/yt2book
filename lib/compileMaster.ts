/**
 * Master Book Compiler (pdf-lib port of the CLI's core/compiler.py).
 *
 * Takes the individually-rendered part PDFs (in order) and:
 *   1. Measures each part's page count.
 *   2. Builds a Table of Contents page (with real page numbers, computed
 *      via a short convergence loop since the TOC's own length affects the
 *      offsets of everything after it).
 *   3. Merges TOC + all parts into one PDF.
 *   4. Adds clickable internal links on the TOC entries AND a native PDF
 *      outline (sidebar bookmarks) -- pdf-lib has no high-level bookmark
 *      API, so the outline dictionary is constructed manually via its
 *      low-level PDFDict/PDFArray/PDFRef primitives, following the PDF
 *      spec's /Outlines structure.
 */
import {
  PDFDocument,
  PDFPage,
  StandardFonts,
  rgb,
  PDFName,
  PDFDict,
  PDFRef,
  PDFString,
} from "pdf-lib";

export interface PartInput {
  label: string;
  pdfBytes: Uint8Array;
}

const PAGE_MARGIN = 56; // ~2cm at 72dpi
const TOC_TITLE_SIZE = 26;
const TOC_ENTRY_SIZE = 12;
const TOC_LINE_HEIGHT = 22;
const A4: [number, number] = [595.28, 841.89];

async function countPages(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}

function wrapTextToLines(
  text: string,
  font: any,
  size: number,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  // If there's leftover text beyond what maxLines can hold, ellipsize the
  // last line rather than silently dropping words.
  const consumedText = lines.join(" ");
  if (consumedText.length < text.replace(/\s+/g, " ").length && lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (font.widthOfTextAtSize(`${last}\u2026`, size) > maxWidth && last.length > 0) {
      last = last.slice(0, -1).trimEnd();
    }
    lines[maxLines - 1] = `${last}\u2026`;
  }

  return lines;
}

async function buildTocPdf(
  entries: { label: string; page: number }[],
  bookTitle: string
): Promise<{ bytes: Uint8Array; titleBlockHeight: number }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);

  let page = doc.addPage(A4);
  let y = A4[1] - PAGE_MARGIN - 20;

  const maxTitleWidth = A4[0] - PAGE_MARGIN * 2;
  const titleLines = wrapTextToLines(bookTitle, font, TOC_TITLE_SIZE, maxTitleWidth, 2);
  const titleLineHeight = TOC_TITLE_SIZE * 1.15;

  for (const line of titleLines) {
    page.drawText(line, {
      x: PAGE_MARGIN,
      y,
      size: TOC_TITLE_SIZE,
      font,
      color: rgb(0.06, 0.14, 0.24),
    });
    y -= titleLineHeight;
  }
  const titleBlockHeight = titleLines.length * titleLineHeight;
  y -= 6;

  page.drawText("Table of Contents", {
    x: PAGE_MARGIN,
    y,
    size: 16,
    font,
    color: rgb(0.11, 0.25, 0.4),
  });
  y -= 16 + 24;

  const bottomLimit = PAGE_MARGIN + 20;

  for (const entry of entries) {
    if (y < bottomLimit) {
      page = doc.addPage(A4);
      y = A4[1] - PAGE_MARGIN;
    }
    const label = entry.label.length > 78 ? entry.label.slice(0, 75) + "..." : entry.label;
    page.drawText(label, {
      x: PAGE_MARGIN,
      y,
      size: TOC_ENTRY_SIZE,
      font: bodyFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    const pageNumText = String(entry.page);
    const numWidth = font.widthOfTextAtSize(pageNumText, TOC_ENTRY_SIZE);
    page.drawText(pageNumText, {
      x: A4[0] - PAGE_MARGIN - numWidth,
      y,
      size: TOC_ENTRY_SIZE,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= TOC_LINE_HEIGHT;
  }

  return { bytes: await doc.save(), titleBlockHeight };
}

/** Adds a clickable Link annotation on `fromPage` that jumps to the top of `toPageRef`. */
function addInternalLink(
  doc: PDFDocument,
  fromPage: PDFPage,
  rect: [number, number, number, number],
  toPageRef: PDFRef
) {
  const linkDict = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: rect,
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "GoTo",
      D: [toPageRef, "XYZ", null, null, null],
    },
  });
  const linkRef = doc.context.register(linkDict);
  const existingAnnots = fromPage.node.Annots();
  if (existingAnnots) {
    existingAnnots.push(linkRef);
  } else {
    fromPage.node.set(PDFName.of("Annots"), doc.context.obj([linkRef]));
  }
}

/** Manually builds a PDF /Outlines tree (the sidebar bookmark panel) since
 * pdf-lib has no high-level API for it. One flat-level entry per part. */
function addOutline(doc: PDFDocument, items: { title: string; pageRef: PDFRef }[]) {
  if (items.length === 0) return;

  const itemRefs: PDFRef[] = items.map(() => doc.context.nextRef());

  items.forEach((item, i) => {
    const entry = doc.context.obj({
      Title: PDFString.of(item.title),
      Dest: [item.pageRef, "XYZ", null, null, null],
    }) as PDFDict;

    if (i > 0) entry.set(PDFName.of("Prev"), itemRefs[i - 1]);
    if (i < items.length - 1) entry.set(PDFName.of("Next"), itemRefs[i + 1]);

    doc.context.assign(itemRefs[i], entry);
  });

  const outlineRootDict = doc.context.obj({
    Type: "Outlines",
    First: itemRefs[0],
    Last: itemRefs[itemRefs.length - 1],
    Count: items.length,
  });
  const outlineRootRef = doc.context.register(outlineRootDict);

  // Give every item a Parent pointing at the root.
  items.forEach((_, i) => {
    const entry = doc.context.lookup(itemRefs[i]) as PDFDict;
    entry.set(PDFName.of("Parent"), outlineRootRef);
  });

  doc.catalog.set(PDFName.of("Outlines"), outlineRootRef);
  // PageMode /UseOutlines makes viewers open with the bookmark sidebar
  // visible, so the navigation is discoverable rather than hidden.
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

export async function compileMasterBook(parts: PartInput[], bookTitle: string): Promise<Uint8Array> {
  if (parts.length === 0) {
    throw new Error("compileMasterBook: no parts provided");
  }

  const pageCounts = await Promise.all(parts.map((p) => countPages(p.pdfBytes)));

  // Two/three-pass convergence: the TOC's own page count affects where
  // every part starts, so measure, rebuild, and settle.
  let tocPageCountGuess = 1;
  let finalTocBytes: Uint8Array | null = null;
  let finalTitleBlockHeight = TOC_TITLE_SIZE * 1.15;
  let finalEntries: { label: string; page: number }[] = [];

  for (let pass = 0; pass < 4; pass++) {
    let runningPage = tocPageCountGuess + 1; // 1-indexed first content page
    const entries = parts.map((p, i) => {
      const entry = { label: p.label, page: runningPage };
      runningPage += pageCounts[i];
      return entry;
    });
    const { bytes: tocBytes, titleBlockHeight } = await buildTocPdf(entries, bookTitle);
    const actualTocPages = await countPages(tocBytes);

    finalTocBytes = tocBytes;
    finalTitleBlockHeight = titleBlockHeight;
    finalEntries = entries;

    if (actualTocPages === tocPageCountGuess) break;
    tocPageCountGuess = actualTocPages;
  }

  // --- Merge everything -------------------------------------------------
  const masterDoc = await PDFDocument.create();
  const tocDoc = await PDFDocument.load(finalTocBytes!);
  const tocPageIndices = tocDoc.getPageIndices();
  const copiedTocPages = await masterDoc.copyPages(tocDoc, tocPageIndices);
  copiedTocPages.forEach((p) => masterDoc.addPage(p));

  const outlineItems: { title: string; pageRef: PDFRef }[] = [];
  let masterPageCursor = copiedTocPages.length;

  for (let i = 0; i < parts.length; i++) {
    const partDoc = await PDFDocument.load(parts[i].pdfBytes);
    const indices = partDoc.getPageIndices();
    const copied = await masterDoc.copyPages(partDoc, indices);
    copied.forEach((p) => masterDoc.addPage(p));

    const firstPageOfPart = masterDoc.getPage(masterPageCursor);
    outlineItems.push({
      title: parts[i].label,
      pageRef: firstPageOfPart.ref,
    });
    masterPageCursor += copied.length;
  }

  // Clickable TOC entries -> jump to each part's first page. We know the
  // exact layout because buildTocPdf uses fixed, deterministic geometry.
  const tocPages = masterDoc.getPages().slice(0, copiedTocPages.length);
  let entryIdx = 0;
  for (const page of tocPages) {
    const { width } = page.getSize();
    let y =
      page === tocPages[0]
        ? A4[1] - PAGE_MARGIN - 20 - finalTitleBlockHeight - 6 - 16 - 24
        : A4[1] - PAGE_MARGIN;
    while (entryIdx < finalEntries.length && y >= PAGE_MARGIN + 20) {
      addInternalLink(
        masterDoc,
        page,
        [PAGE_MARGIN - 4, y - 5, width - PAGE_MARGIN + 4, y + TOC_ENTRY_SIZE + 3],
        outlineItems[entryIdx].pageRef
      );
      y -= TOC_LINE_HEIGHT;
      entryIdx++;
    }
  }

  addOutline(masterDoc, outlineItems);

  return masterDoc.save();
}
