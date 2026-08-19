/**
 * Shared PDF styling -- ported from the CLI's config.PDF_CSS, adapted for
 * Puppeteer's print-to-PDF (which supports CSS Paged Media similarly to
 * WeasyPrint, including @page rules and page-break-before).
 */
export const PDF_CSS = `
@page {
  size: A4;
  margin: 2.5cm 2.2cm 2.8cm 2.2cm;
}
* { box-sizing: border-box; }
body {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 11.5pt;
  line-height: 1.6;
  color: #1a1a1a;
  margin: 0;
}
h1 {
  font-size: 26pt;
  color: #10233c;
  border-bottom: 3px solid #10233c;
  padding-bottom: 8px;
  margin-top: 0.2em;
}
h2 {
  font-size: 18pt;
  color: #1c3f66;
  margin-top: 1.4em;
}
h3 {
  font-size: 14pt;
  color: #2c5686;
  margin-top: 1.1em;
}
p { margin: 0.7em 0; text-align: justify; }
blockquote {
  border-left: 4px solid #d4a017;
  background: #fdf6e3;
  margin: 1em 0;
  padding: 0.6em 1em;
  font-style: italic;
  color: #4a4a4a;
}
code {
  font-family: Consolas, Menlo, monospace;
  background: #f2f2f2;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.92em;
}
pre {
  background: #282c34;
  color: #e6e6e6;
  padding: 12px 14px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 9.5pt;
  line-height: 1.45;
  white-space: pre-wrap;
  word-wrap: break-word;
}
pre code { background: none; color: inherit; padding: 0; }
ul, ol { margin: 0.6em 0; padding-left: 1.6em; }
li { margin: 0.3em 0; }
a { color: #1c5fa8; text-decoration: none; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #ccc; padding: 6px 10px; }
th { background: #eef2f7; }
hr { border: none; border-top: 1px solid #ccc; margin: 2em 0; }
`;
