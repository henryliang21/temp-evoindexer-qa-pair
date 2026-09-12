import type { LlmClient } from "../llm/types";
import { checkUnit, type DropReason } from "./ground";
import { extractPrompt, repairPrompt } from "./prompts";
import { ExtractSchema } from "./schemas";

export interface Unit {
  answer: string;
  evidence: string[];
}

export type DropCounts = Record<DropReason, number>;

export const emptyDrops = (): DropCounts => ({ evidence: 0, numbers: 0, length: 0 });

export interface ExtractInput {
  llm: LlmClient;
  context: string;
  chunk: string;
  normalizedSource: string;
  maxChars: number;
  signal?: AbortSignal;
}

function clean(units: Unit[]): Unit[] {
  return units
    .map((u) => ({ answer: u.answer.trim(), evidence: u.evidence.map((e) => e.trim()).filter(Boolean).slice(0, 3) }))
    .filter((u) => u.answer);
}

export async function extractChunk({ llm, context, chunk, normalizedSource, maxChars, signal }: ExtractInput) {
  const dropped = emptyDrops();
  const units: Unit[] = [];
  const tooLong: Unit[] = [];

  const first = await llm.generateJson({ ...extractPrompt({ context, chunk, maxChars }), schema: ExtractSchema, signal });
  for (const unit of clean(first.units)) {
    const result = checkUnit(unit, normalizedSource, maxChars);
    if (result === "ok") units.push(unit);
    else if (result === "length") tooLong.push(unit);
    else dropped[result]++;
  }

  if (tooLong.length > 0) {
    try {
      const repaired = await llm.generateJson({ ...repairPrompt({ context, units: tooLong, maxChars }), schema: ExtractSchema, signal });
      for (const unit of clean(repaired.units)) {
        const result = checkUnit(unit, normalizedSource, maxChars);
        if (result === "ok") units.push(unit);
        else dropped[result]++;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      dropped.length += tooLong.length;
    }
  }

  return { units, dropped };
}
