export const DEFAULT_CHUNK_CHARS = 6000;

const length = (s: string) => [...s].length;

function hardSplit(s: string, maxChars: number): string[] {
  const chars = [...s];
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) parts.push(chars.slice(i, i + maxChars).join(""));
  return parts;
}

/** Split after Chinese/Western sentence enders; "." only counts before whitespace, so 4.9 stays whole. */
function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[。！？!?])|(?<=\.\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function chunkText(text: string, maxChars = DEFAULT_CHUNK_CHARS): string[] {
  const pieces: string[] = [];
  for (const paragraph of text.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    if (length(paragraph) <= maxChars) {
      pieces.push(paragraph);
      continue;
    }
    for (const sentence of splitSentences(paragraph)) {
      if (length(sentence) <= maxChars) pieces.push(sentence);
      else pieces.push(...hardSplit(sentence, maxChars));
    }
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  for (const piece of pieces) {
    const pieceLength = length(piece);
    if (current.length > 0 && currentLength + 1 + pieceLength > maxChars) {
      chunks.push(current.join("\n"));
      current = [];
      currentLength = 0;
    }
    currentLength += (current.length > 0 ? 1 : 0) + pieceLength;
    current.push(piece);
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}
