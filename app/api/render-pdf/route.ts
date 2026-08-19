import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { markdownToFullHtml } from "@/lib/markdownToHtml";

export const runtime = "nodejs";
export const maxDuration = 60;

// @sparticuz/chromium ships a brotli-compressed Chromium build sized for
// AWS Lambda / Vercel's serverless environment (this is the standard,
// widely-used combo for headless-Chrome-on-Vercel -- puppeteer alone
// bundles a full local Chromium that's too large to deploy). If you ever
// bump puppeteer-core's version, check that it's still paired with a
// matching @sparticuz/chromium release -- their version numbers need to
// stay in sync (see https://github.com/Sparticuz/chromium#readme).
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: true,
  });
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const markdown = body?.markdown;
  const title = body?.title || "Untitled";

  if (!markdown || typeof markdown !== "string") {
    return Response.json({ error: "Missing 'markdown' (string)." }, { status: 400 });
  }

  let browser;
  try {
    const html = markdownToFullHtml(markdown, title);

    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
    });

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(title)}.pdf"`,
      },
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "PDF rendering failed." }, { status: 500 });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }
}
