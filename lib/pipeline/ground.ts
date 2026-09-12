export type DropReason = "evidence" | "numbers" | "length";

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const MIN_EVIDENCE_CHARS = 4;

export function normalize(s: string): string {
  return s.normalize("NFKC").replace(ZERO_WIDTH, "").replace(/\s+/g, "");
}

export function charLength(s: string): number {
  return [...s].length;
}

export function numbersIn(s: string): string[] {
  const text = normalize(s).replace(/(\d),(?=\d{3})/g, "$1");
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

export function checkUnit(
  unit: { answer: string; evidence: string[] },
  normalizedSource: string,
  maxChars: number,
): "ok" | DropReason {
  if (unit.evidence.length === 0) return "evidence";
  for (const quote of unit.evidence) {
    const normalized = normalize(quote);
    if (charLength(normalized) < MIN_EVIDENCE_CHARS || !normalizedSource.includes(normalized)) return "evidence";
  }

  const evidenceNumbers = new Set(unit.evidence.flatMap(numbersIn));
  if (numbersIn(unit.answer).some((n) => !evidenceNumbers.has(n))) return "numbers";

  if (charLength(unit.answer.trim()) > maxChars) return "length";
  return "ok";
}
