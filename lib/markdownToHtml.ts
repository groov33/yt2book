import { marked } from "marked";
import { PDF_CSS } from "./pdfStyles";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function markdownToFullHtml(markdownText: string, pageTitle: string): string {
  const bodyHtml = marked.parse(markdownText, { async: false }) as string;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(pageTitle)}</title>
<style>${PDF_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
