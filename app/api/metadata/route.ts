import { getSourceMetadata } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const url = (body?.url || "").trim();
  if (!url) {
    return Response.json({ error: "Missing 'url'." }, { status: 400 });
  }

  try {
    const meta = await getSourceMetadata(url);
    return Response.json(meta);
  } catch (e: any) {
    // YouTube frequently rate-limits or blocks automated requests from
    // cloud/datacenter IPs -- this is a real, expected failure mode, not
    // necessarily a bug. Surface the real error so the UI can offer the
    // manual-entry fallback.
    return Response.json(
      { error: e?.message || "Failed to fetch video/playlist metadata." },
      { status: 502 }
    );
  }
}
