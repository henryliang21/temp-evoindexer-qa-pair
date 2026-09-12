import { chunkText, DEFAULT_CHUNK_CHARS } from "../chunk";
import { describeLlmError } from "../llm/errors";
import type { LlmClient } from "../llm/types";
import { emptyDrops, extractChunk, type DropCounts, type Unit } from "./extract";
import { normalize } from "./ground";
import { generateQuestions } from "./questions";

export interface QaRow {
  question: string;
  text: string;
}

export interface RunStats {
  chunks: number;
  units: number;
  dropped: DropCounts;
  failedChunks: number;
  failedBatches: number;
  failureReason: string | null;
  rows: number;
}

export type ProgressEvent =
  | { type: "parsed"; chars: number; chunks: number }
  | { type: "extract"; done: number; total: number; units: number }
  | { type: "questions"; done: number; total: number };

export type StreamEvent = ProgressEvent | { type: "result"; rows: QaRow[]; stats: RunStats } | { type: "error"; message: string };

export interface RunInput {
  text: string;
  filename: string;
  variants: number;
  maxChars: number;
  llm: LlmClient;
  emit: (event: ProgressEvent) => void;
  signal?: AbortSignal;
  chunkChars?: number;
  batchSize?: number;
  concurrency?: number;
}

export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function documentContext(filename: string, text: string): string {
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return `${filename} — ${[...firstLine].slice(0, 100).join("")}`;
}

export async function runPipeline(input: RunInput): Promise<{ rows: QaRow[]; stats: RunStats }> {
  const { text, filename, variants, maxChars, llm, emit, signal } = input;
  const concurrency = input.concurrency ?? 3;
  const batchSize = input.batchSize ?? 15;
  const chunks = chunkText(text, input.chunkChars ?? DEFAULT_CHUNK_CHARS);
  const normalizedSource = normalize(text);
  const context = documentContext(filename, text);
  let firstFailure: unknown = null;

  emit({ type: "parsed", chars: [...text].length, chunks: chunks.length });

  // Stage 1: extract grounded units per chunk.
  let chunksDone = 0;
  let unitsFound = 0;
  const extracted = await mapLimit(chunks, concurrency, async (chunk) => {
    try {
      const result = await extractChunk({ llm, context, chunk, normalizedSource, maxChars, signal });
      unitsFound += result.units.length;
      return result;
    } finally {
      chunksDone++;
      emit({ type: "extract", done: chunksDone, total: chunks.length, units: unitsFound });
    }
  });

  const dropped = emptyDrops();
  const units: Unit[] = [];
  const seenAnswers = new Set<string>();
  let failedChunks = 0;
  for (const result of extracted) {
    if (result.status === "rejected") {
      failedChunks++;
      firstFailure ??= result.reason;
      continue;
    }
    dropped.evidence += result.value.dropped.evidence;
    dropped.numbers += result.value.dropped.numbers;
    dropped.length += result.value.dropped.length;
    for (const unit of result.value.units) {
      const key = normalize(unit.answer);
      if (seenAnswers.has(key)) continue;
      seenAnswers.add(key);
      units.push(unit);
    }
  }
  if (chunks.length > 0 && failedChunks === chunks.length) throw new PipelineError(describeLlmError(firstFailure));

  // Stage 2: question variants per batch of answers.
  const numbered = units.map((unit, i) => ({ id: `u${i + 1}`, answer: unit.answer }));
  const batches: (typeof numbered)[] = [];
  for (let i = 0; i < numbered.length; i += batchSize) batches.push(numbered.slice(i, i + batchSize));

  let batchesDone = 0;
  const asked = await mapLimit(batches, concurrency, async (batch) => {
    try {
      return await generateQuestions({ llm, context, units: batch, variants, signal });
    } finally {
      batchesDone++;
      emit({ type: "questions", done: batchesDone, total: batches.length });
    }
  });

  const questionsById = new Map<string, string[]>();
  let failedBatches = 0;
  for (const result of asked) {
    if (result.status === "rejected") {
      failedBatches++;
      firstFailure ??= result.reason;
      continue;
    }
    for (const [id, questions] of result.value) questionsById.set(id, questions);
  }
  if (batches.length > 0 && failedBatches === batches.length) throw new PipelineError(describeLlmError(firstFailure));

  // Fan out: one row per question, answer repeated; drop duplicate questions.
  const rows: QaRow[] = [];
  const seenQuestions = new Set<string>();
  for (const unit of numbered) {
    for (const question of questionsById.get(unit.id) ?? []) {
      const key = normalize(question);
      if (seenQuestions.has(key)) continue;
      seenQuestions.add(key);
      rows.push({ question, text: unit.answer });
    }
  }

  return {
    rows,
    stats: {
      chunks: chunks.length,
      units: numbered.length,
      dropped,
      failedChunks,
      failedBatches,
      failureReason: firstFailure === null ? null : describeLlmError(firstFailure),
      rows: rows.length,
    },
  };
}
