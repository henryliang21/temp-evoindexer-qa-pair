import type { z } from "zod";

export interface JsonRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

/** One structured-output LLM call. Implementations validate the result against `schema`. */
export interface LlmClient {
  generateJson<T>(req: JsonRequest<T>): Promise<T>;
}
