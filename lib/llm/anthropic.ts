import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { LlmOutputError, LlmRefusalError } from "./errors";
import type { JsonRequest, LlmClient } from "./types";

export function createAnthropicLlm(
  opts: { apiKey: string; model: string },
  api: Anthropic["beta"]["messages"] = new Anthropic({ apiKey: opts.apiKey }).beta.messages,
): LlmClient {
  return {
    async generateJson<T>({ system, user, schema, signal }: JsonRequest<T>): Promise<T> {
      // Streaming, so a large max_tokens (room for adaptive thinking + long JSON) never hits HTTP timeouts.
      const message = await api
        .stream(
          {
            model: opts.model,
            max_tokens: 64000,
            // If Claude declines, the API re-runs the request on Anthropic's recommended fallback model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system,
            messages: [{ role: "user", content: user }],
            output_config: { format: betaZodOutputFormat(schema) },
          },
          { signal },
        )
        .finalMessage()
        .catch((err: unknown) => {
          if (err instanceof Anthropic.APIError) throw err;
          throw new LlmOutputError(`Could not read the model output: ${err instanceof Error ? err.message : String(err)}`);
        });

      if (message.stop_reason === "refusal") throw new LlmRefusalError();
      if (message.stop_reason === "max_tokens") throw new LlmOutputError("The model output was cut off (max_tokens)");
      const parsed = schema.safeParse(message.parsed_output);
      if (!parsed.success) throw new LlmOutputError("The model output did not match the expected format");
      return parsed.data;
    },
  };
}
