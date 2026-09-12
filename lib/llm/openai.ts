import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { LlmOutputError, LlmRefusalError } from "./errors";
import type { JsonRequest, LlmClient } from "./types";

export function createOpenAiLlm(
  opts: { apiKey: string; baseURL?: string; model: string },
  api: OpenAI["chat"]["completions"] = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL }).chat.completions,
): LlmClient {
  return {
    async generateJson<T>({ system, user, schema, signal }: JsonRequest<T>): Promise<T> {
      const completion = await api
        .parse(
          {
            model: opts.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            response_format: zodResponseFormat(schema, "result"),
          },
          { signal },
        )
        .catch((err: unknown) => {
          if (err instanceof OpenAI.APIError) throw err;
          throw new LlmOutputError(`Could not read the model output: ${err instanceof Error ? err.message : String(err)}`);
        });

      const message = completion.choices[0]?.message;
      if (message?.refusal) throw new LlmRefusalError();
      const parsed = schema.safeParse(message?.parsed);
      if (!parsed.success) throw new LlmOutputError("The model output did not match the expected format");
      return parsed.data;
    },
  };
}
