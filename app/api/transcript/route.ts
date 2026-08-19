import { fetchTranscript } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const videoId = (body?.videoId || "").trim();
  if (!videoId) {
    return Response.json({ error: "Missing 'videoId'." }, { status: 400 });
  }

  try {
    const transcript = await fetchTranscript(videoId);
    return Response.json({ transcript });
  } catch (e: any) {
    return Response.json(
      { error: e?.message || `Failed to fetch transcript for ${videoId}.` },
      { status: 502 }
    );
  }
}
