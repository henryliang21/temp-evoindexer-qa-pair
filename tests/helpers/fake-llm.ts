import type { JsonRequest, LlmClient } from "@/lib/llm/types";
import { ExtractSchema, QuestionsSchema } from "@/lib/pipeline/schemas";

type Units = { id: string; answer: string }[];

export interface FakeLlmOptions {
  /** Handles extract and repair calls; `call` counts ExtractSchema calls from 0. */
  extract?: (req: JsonRequest<unknown>, call: number) => unknown;
  questions?: (units: Units, req: JsonRequest<unknown>) => unknown;
}

export const defaultQuestions = (units: Units) => ({
  items: units.map((u) => ({ id: u.id, questions: [`${u.answer}是什么？`, `请问${u.answer}？`] })),
});

/** Payload after the "Document: ...\n\n" header that every prompt starts with. */
export function promptPayload(req: JsonRequest<unknown>): string {
  return req.user.slice(req.user.indexOf("\n\n") + 2);
}

export function fakeLlm(opts: FakeLlmOptions = {}): LlmClient & { calls: JsonRequest<unknown>[] } {
  const calls: JsonRequest<unknown>[] = [];
  let extractCalls = 0;
  return {
    calls,
    async generateJson<T>(req: JsonRequest<T>): Promise<T> {
      const r = req as JsonRequest<unknown>;
      calls.push(r);
      if (r.schema === ExtractSchema) {
        if (!opts.extract) throw new Error("fakeLlm: no extract handler");
        return (await opts.extract(r, extractCalls++)) as T;
      }
      if (r.schema === QuestionsSchema) {
        const units = JSON.parse(promptPayload(r)) as Units;
        return (await (opts.questions ?? defaultQuestions)(units, r)) as T;
      }
      throw new Error("fakeLlm: unexpected schema");
    },
  };
}
