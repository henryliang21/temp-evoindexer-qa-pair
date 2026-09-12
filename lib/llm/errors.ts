/** The model answered, but the output was unusable (cut off, unparseable, wrong shape). Retried once. */
export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

/** The model (and any fallback) declined the request. Not retried. */
export class LlmRefusalError extends Error {
  constructor(message = "The model declined to process this part of the document") {
    super(message);
    this.name = "LlmRefusalError";
  }
}

/** A message for the user. Both SDKs' API errors carry a numeric `status`. */
export function describeLlmError(err: unknown): string {
  const status = typeof err === "object" && err !== null && "status" in err ? (err as { status?: unknown }).status : undefined;
  if (status === 401 || status === 403) return "The LLM API rejected the API key. Check the API key in .env.";
  if (status === 404) return "The LLM model was not found. Check ANTHROPIC_MODEL / OPENAI_MODEL in .env.";
  if (status === 429) return "The LLM API rate limit was reached. Wait a minute and try again.";
  if (typeof status === "number" && status >= 500) return `The LLM service had an error (${status}). Try again later.`;
  return err instanceof Error ? err.message : String(err);
}
