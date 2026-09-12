import type { LlmClient } from "../llm/types";
import { questionsPrompt } from "./prompts";
import { QuestionsSchema } from "./schemas";

export interface QuestionsInput {
  llm: LlmClient;
  context: string;
  units: { id: string; answer: string }[];
  variants: number;
  signal?: AbortSignal;
}

export async function generateQuestions({ llm, context, units, variants, signal }: QuestionsInput): Promise<Map<string, string[]>> {
  const output = await llm.generateJson({ ...questionsPrompt({ context, units, variants }), schema: QuestionsSchema, signal });
  const ids = new Set(units.map((u) => u.id));
  const byId = new Map<string, string[]>();
  for (const item of output.items) {
    if (!ids.has(item.id)) continue;
    const questions = item.questions.map((q) => q.trim()).filter(Boolean);
    byId.set(item.id, [...(byId.get(item.id) ?? []), ...questions].slice(0, variants));
  }
  return byId;
}
