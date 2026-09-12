import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AppConfig } from "@/lib/config";
import { createLlm, withOutputRetry } from "@/lib/llm";
import { createAnthropicLlm } from "@/lib/llm/anthropic";
import { describeLlmError, LlmOutputError, LlmRefusalError } from "@/lib/llm/errors";
import { createOpenAiLlm } from "@/lib/llm/openai";
import type { LlmClient } from "@/lib/llm/types";

const Schema = z.object({ value: z.string() });
const request = { system: "sys", user: "hello", schema: Schema };

function anthropicStub(outcome: { stop_reason: string | null; parsed_output: unknown } | Error) {
  const stream = vi.fn(() => ({
    finalMessage: () => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)),
  }));
  return { stream, api: { stream } as unknown as Anthropic["beta"]["messages"] };
}

function openaiStub(outcome: unknown) {
  const parse = vi.fn(() => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)));
  return { parse, api: { parse } as unknown as OpenAI["chat"]["completions"] };
}

describe("createAnthropicLlm", () => {
  it("streams a structured-output request with default fallbacks and returns the parsed object", async () => {
    const { stream, api } = anthropicStub({ stop_reason: "end_turn", parsed_output: { value: "ok" } });
    const llm = createAnthropicLlm({ apiKey: "k", model: "claude-opus-5" }, api);
    const signal = new AbortController().signal;

    await expect(llm.generateJson({ ...request, signal })).resolves.toEqual({ value: "ok" });

    const [body, options] = stream.mock.calls[0] as unknown as [Record<string, unknown>, { signal: AbortSignal }];
    expect(body).toMatchObject({
      model: "claude-opus-5",
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(body.output_config).toHaveProperty("format");
    expect(options.signal).toBe(signal);
  });

  it("throws LlmRefusalError when the model refuses", async () => {
    const { api } = anthropicStub({ stop_reason: "refusal", parsed_output: null });
    await expect(createAnthropicLlm({ apiKey: "k", model: "m" }, api).generateJson(request)).rejects.toBeInstanceOf(LlmRefusalError);
  });

  it("throws LlmOutputError when the output is cut off", async () => {
    const { api } = anthropicStub({ stop_reason: "max_tokens", parsed_output: null });
    await expect(createAnthropicLlm({ apiKey: "k", model: "m" }, api).generateJson(request)).rejects.toBeInstanceOf(LlmOutputError);
  });

  it("throws LlmOutputError when the output does not match the schema", async () => {
    const { api } = anthropicStub({ stop_reason: "end_turn", parsed_output: { value: 3 } });
    await expect(createAnthropicLlm({ apiKey: "k", model: "m" }, api).generateJson(request)).rejects.toBeInstanceOf(LlmOutputError);
  });

  it("wraps parse failures as LlmOutputError", async () => {
    const { api } = anthropicStub(new SyntaxError("Unexpected token"));
    await expect(createAnthropicLlm({ apiKey: "k", model: "m" }, api).generateJson(request)).rejects.toBeInstanceOf(LlmOutputError);
  });

  it("passes API errors through unchanged", async () => {
    const apiError = new Anthropic.APIError(401, undefined, "bad key", new Headers());
    const { api } = anthropicStub(apiError);
    await expect(createAnthropicLlm({ apiKey: "k", model: "m" }, api).generateJson(request)).rejects.toBe(apiError);
  });
});

describe("createOpenAiLlm", () => {
  it("sends system and user messages with a JSON schema response format", async () => {
    const { parse, api } = openaiStub({ choices: [{ message: { parsed: { value: "ok" }, refusal: null } }] });
    const llm = createOpenAiLlm({ apiKey: "k", model: "gpt-x" }, api);

    await expect(llm.generateJson(request)).resolves.toEqual({ value: "ok" });

    const [body] = parse.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(body).toMatchObject({
      model: "gpt-x",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
      ],
    });
    expect(body.response_format).toMatchObject({ type: "json_schema" });
  });

  it("throws LlmRefusalError on a refusal", async () => {
    const { api } = openaiStub({ choices: [{ message: { parsed: null, refusal: "no" } }] });
    await expect(createOpenAiLlm({ apiKey: "k", model: "m" }, api).generateJson(request)).rejects.toBeInstanceOf(LlmRefusalError);
  });

  it("throws LlmOutputError on a schema mismatch or a non-API failure", async () => {
    const mismatch = openaiStub({ choices: [{ message: { parsed: { value: 1 }, refusal: null } }] });
    await expect(createOpenAiLlm({ apiKey: "k", model: "m" }, mismatch.api).generateJson(request)).rejects.toBeInstanceOf(LlmOutputError);
    const failure = openaiStub(new Error("Could not parse response content as the length limit was reached"));
    await expect(createOpenAiLlm({ apiKey: "k", model: "m" }, failure.api).generateJson(request)).rejects.toBeInstanceOf(LlmOutputError);
  });

  it("passes API errors through unchanged", async () => {
    const apiError = new OpenAI.APIError(429, undefined, "slow down", new Headers());
    const { api } = openaiStub(apiError);
    await expect(createOpenAiLlm({ apiKey: "k", model: "m" }, api).generateJson(request)).rejects.toBe(apiError);
  });
});

function scripted(errors: Error[], value: unknown): LlmClient & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    async generateJson<T>(): Promise<T> {
      calls++;
      const error = errors.shift();
      if (error) throw error;
      return value as T;
    },
  };
}

describe("withOutputRetry", () => {
  it("retries once after an output error", async () => {
    const inner = scripted([new LlmOutputError("bad")], { value: "ok" });
    await expect(withOutputRetry(inner).generateJson(request)).resolves.toEqual({ value: "ok" });
    expect(inner.calls()).toBe(2);
  });

  it("gives up after a second output error", async () => {
    const inner = scripted([new LlmOutputError("bad"), new LlmOutputError("bad again")], null);
    await expect(withOutputRetry(inner).generateJson(request)).rejects.toThrow("bad again");
    expect(inner.calls()).toBe(2);
  });

  it("does not retry refusals", async () => {
    const inner = scripted([new LlmRefusalError("no")], null);
    await expect(withOutputRetry(inner).generateJson(request)).rejects.toBeInstanceOf(LlmRefusalError);
    expect(inner.calls()).toBe(1);
  });

  it("does not retry once the request is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const inner = scripted([new LlmOutputError("bad")], null);
    await expect(withOutputRetry(inner).generateJson({ ...request, signal: controller.signal })).rejects.toBeInstanceOf(LlmOutputError);
    expect(inner.calls()).toBe(1);
  });
});

describe("createLlm", () => {
  it("builds a client for either provider without network access", () => {
    const base: AppConfig = {
      provider: "anthropic",
      anthropic: { apiKey: "k", model: "claude-opus-5" },
      openai: { apiKey: "k", model: "m" },
      answerMaxChars: 100,
    };
    expect(typeof createLlm(base).generateJson).toBe("function");
    expect(typeof createLlm({ ...base, provider: "openai" }).generateJson).toBe("function");
  });
});

describe("describeLlmError", () => {
  it.each([
    [{ status: 401 }, /API key/],
    [{ status: 403 }, /API key/],
    [{ status: 404 }, /MODEL/],
    [{ status: 429 }, /rate limit/],
    [{ status: 529 }, /529/],
    [new LlmRefusalError("The model declined"), /declined/],
    ["plain string", /plain string/],
  ])("describes %j", (error, message) => {
    expect(describeLlmError(error)).toMatch(message);
  });
});
