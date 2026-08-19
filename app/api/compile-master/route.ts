import { compileMasterBook, type PartInput } from "@/lib/compileMaster";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const bookTitle = body?.bookTitle || "Textbook";
  const parts = body?.parts;

  if (!Array.isArray(parts) || parts.length === 0) {
    return Response.json({ error: "Missing 'parts' (non-empty array)." }, { status: 400 });
  }

  try {
    const partInputs: PartInput[] = parts.map((p: any, i: number) => {
      if (!p?.label || !p?.pdfBase64) {
        throw new Error(`Part ${i} is missing 'label' or 'pdfBase64'.`);
      }
      return { label: p.label, pdfBytes: Buffer.from(p.pdfBase64, "base64") };
    });

    const masterBytes = await compileMasterBook(partInputs, bookTitle);

    return new Response(masterBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(bookTitle)} - Master Textbook.pdf"`,
      },
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "Master book compilation failed." }, { status: 500 });
  }
}
