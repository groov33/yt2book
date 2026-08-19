/**
 * Pure YouTube URL parsing -- deliberately zero dependencies (no
 * youtubei.js import) so this logic can be unit tested in isolation and
 * reused anywhere without pulling in the InnerTube client.
 */

export function extractPlaylistId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("list");
  } catch {
    return null;
  }
}

export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.slice(1) || null;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const shortsMatch = u.pathname.match(/\/shorts\/([^/?]+)/);
    if (shortsMatch) return shortsMatch[1];
    return null;
  } catch {
    return null;
  }
}

/** youtubei.js frequently returns rich "Text" run objects instead of plain
 * strings; this normalizes either shape to a plain string. */
export function toText(value: any): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") {
    const s = value.toString();
    if (s && s !== "[object Object]") return s;
  }
  if (typeof value.text === "string") return value.text;
  return "";
}
