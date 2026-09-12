import type { AppConfig } from "../config";
import { createAnthropicLlm } from "./anthropic";
import { LlmOutputError } from "./errors";
import { createOpenAiLlm } from "./openai";
import type { JsonRequest, LlmClient } from "./types";

/** Retry a call once when the output was unusable (the SDKs already retry network/429/5xx errors). */
export function withOutputRetry(client: LlmClient): LlmClient {
  return {
    async generateJson<T>(req: JsonRequest<T>): Promise<T> {
      try {
        return await client.generateJson(req);
      } catch (err) {
        if (err instanceof LlmOutputError && !req.signal?.aborted) return client.generateJson(req);
        throw err;
      }
    },
  };
}

export function createLlm(config: AppConfig): LlmClient {
  const client = config.provider === "openai" ? createOpenAiLlm(config.openai) : createAnthropicLlm(config.anthropic);
  return withOutputRetry(client);
}
