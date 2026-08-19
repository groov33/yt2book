/**
 * YouTube metadata + transcript fetching via youtubei.js (the actively
 * maintained InnerTube API client for Node -- same underlying approach
 * yt-dlp uses, but as a JS library so it runs in a Vercel serverless
 * function without shelling out to a Python/binary dependency).
 *
 * IMPORTANT OPERATIONAL NOTE: YouTube actively rate-limits and sometimes
 * blocks automated requests from cloud/datacenter IPs (which is exactly
 * what a Vercel serverless function's outbound IP is). This can surface as
 * intermittent failures that have nothing to do with this code being
 * wrong -- see README "Notes & Limitations". Because of this, both the
 * metadata and transcript flows in the UI (app/page.tsx) offer a manual
 * fallback: paste a playlist's video titles/IDs, or paste a transcript
 * directly, bypassing this module entirely when it's blocked.
 */
import { Innertube } from "youtubei.js";
import { extractPlaylistId, extractVideoId, toText } from "./youtubeUrl";

export { extractPlaylistId, extractVideoId };

let clientPromise: Promise<any> | null = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = Innertube.create({ generate_session_locally: true });
  }
  return clientPromise;
}

export type SourceType = "video" | "playlist";

export interface VideoEntry {
  id: string;
  title: string;
}

export interface SourceMetadata {
  type: SourceType;
  id: string;
  title: string;
  entries: VideoEntry[];
}

const MAX_PLAYLIST_VIDEOS = 300;

export async function getSourceMetadata(url: string): Promise<SourceMetadata> {
  const playlistId = extractPlaylistId(url);
  const yt = await getClient();

  if (playlistId) {
    const playlist = await yt.getPlaylist(playlistId);
    const entries: VideoEntry[] = [];
    let current = playlist;

    while (current) {
      const videos = current.videos || current.items || [];
      for (const v of videos) {
        const id = v.id || v.video_id;
        if (!id) continue;
        entries.push({ id, title: toText(v.title) || id });
      }
      if (entries.length >= MAX_PLAYLIST_VIDEOS) break;
      if (current.has_continuation) {
        current = await current.getContinuation();
      } else {
        break;
      }
    }

    return {
      type: "playlist",
      id: playlistId,
      title: toText(playlist.info?.title) || toText(playlist.header?.title) || "Playlist",
      entries,
    };
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(
      "Could not find a video or playlist ID in that URL. Paste a standard " +
        "youtube.com/watch?v=... , youtu.be/... , or youtube.com/playlist?list=... URL."
    );
  }

  const info = await yt.getBasicInfo(videoId);
  const title = toText(info.basic_info?.title) || videoId;

  return {
    type: "video",
    id: videoId,
    title,
    entries: [{ id: videoId, title }],
  };
}

/** Flattens youtubei.js's nested transcript segment tree into plain text,
 * one caption per line (mirrors the CLI's transcript format so chunker.ts
 * behaves identically). */
export async function fetchTranscript(videoId: string): Promise<string> {
  const yt = await getClient();
  const info = await yt.getInfo(videoId);

  let transcriptData;
  try {
    transcriptData = await info.getTranscript();
  } catch (e: any) {
    throw new Error(
      `No transcript available for video ${videoId} (captions may be disabled). ` +
        `Original error: ${e?.message || e}`
    );
  }

  const segments =
    transcriptData?.transcript?.content?.body?.initial_segments ||
    transcriptData?.transcript?.content?.body?.initialSegments ||
    [];

  const lines: string[] = [];
  for (const seg of segments) {
    const text = toText(seg.snippet).trim();
    if (text) lines.push(text.replace(/\n+/g, " "));
  }

  if (lines.length === 0) {
    throw new Error(
      `Transcript for video ${videoId} came back empty. Captions may be disabled ` +
        `for this video -- try pasting the transcript manually instead.`
    );
  }

  return lines.join("\n");
}
