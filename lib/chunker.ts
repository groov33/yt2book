/**
 * Manual chunking of a transcript into N roughly-equal parts.
 *
 * Splits on line boundaries (one caption line per line) so no caption is
 * ever cut in half, balancing chunk boundaries by character count so each
 * chunk is a comparable amount of work for the model. Direct port of the
 * CLI's core/chunker.py -- same algorithm, same behavior.
 */

export function chunkTranscript(transcriptText: string, numParts: number): string[] {
  if (numParts < 1) {
    throw new Error("numParts must be >= 1");
  }

  const lines = transcriptText.split("\n").filter((ln) => ln.trim().length > 0);
  if (lines.length === 0) {
    return new Array(numParts).fill("");
  }

  if (numParts === 1) {
    return [lines.join("\n")];
  }

  const totalChars = lines.reduce((sum, ln) => sum + ln.length, 0);
  const targetPerChunk = Math.max(1, Math.floor(totalChars / numParts));

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    current.push(line);
    currentLen += line.length;

    if (currentLen >= targetPerChunk && chunks.length < numParts - 1) {
      chunks.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }

  // Edge case: transcript shorter than numParts lines -- pad with empty
  // chunks so downstream indexing (progress tracking, filenames) stays
  // consistent with what the user requested.
  while (chunks.length < numParts) {
    chunks.push("");
  }

  return chunks.slice(0, numParts);
}
