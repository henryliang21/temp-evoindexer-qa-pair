import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "@/lib/config";

describe("loadConfig", () => {
  it("uses anthropic defaults", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "sk-a" });
    expect(config.provider).toBe("anthropic");
    expect(config.anthropic).toEqual({ apiKey: "sk-a", model: "claude-opus-5" });
    expect(config.answerMaxChars).toBe(100);
  });

  it("reads openai settings", () => {
    const config = loadConfig({
      LLM_PROVIDER: "OpenAI",
      OPENAI_API_KEY: "sk-o",
      OPENAI_MODEL: "m1",
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
      ANSWER_MAX_CHARS: "80",
    });
    expect(config.provider).toBe("openai");
    expect(config.openai).toEqual({ apiKey: "sk-o", model: "m1", baseURL: "https://openrouter.ai/api/v1" });
    expect(config.answerMaxChars).toBe(80);
  });

  it("treats blank values as unset", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "sk-a", ANTHROPIC_MODEL: "  ", OPENAI_BASE_URL: "", ANSWER_MAX_CHARS: "" });
    expect(config.anthropic.model).toBe("claude-opus-5");
    expect(config.openai.baseURL).toBeUndefined();
    expect(config.answerMaxChars).toBe(100);
  });

  it.each([
    [{}, /ANTHROPIC_API_KEY/],
    [{ LLM_PROVIDER: "openai", OPENAI_MODEL: "m" }, /OPENAI_API_KEY/],
    [{ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" }, /OPENAI_MODEL/],
    [{ LLM_PROVIDER: "gemini", ANTHROPIC_API_KEY: "k" }, /LLM_PROVIDER/],
    [{ ANTHROPIC_API_KEY: "k", ANSWER_MAX_CHARS: "abc" }, /ANSWER_MAX_CHARS/],
    [{ ANTHROPIC_API_KEY: "k", ANSWER_MAX_CHARS: "10" }, /ANSWER_MAX_CHARS/],
  ])("rejects %j", (env, message) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(message);
  });
});
