export type Provider = "anthropic" | "openai";

export interface AppConfig {
  provider: Provider;
  anthropic: { apiKey: string; model: string };
  openai: { apiKey: string; baseURL?: string; model: string };
  answerMaxChars: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function value(env: Env, key: string): string {
  return env[key]?.trim() ?? "";
}

export function loadConfig(env: Env = process.env): AppConfig {
  const provider = (value(env, "LLM_PROVIDER") || "anthropic").toLowerCase();
  if (provider !== "anthropic" && provider !== "openai") {
    throw new ConfigError(`LLM_PROVIDER must be "anthropic" or "openai", got "${provider}"`);
  }

  const rawMax = value(env, "ANSWER_MAX_CHARS") || "100";
  const answerMaxChars = Number(rawMax);
  if (!Number.isInteger(answerMaxChars) || answerMaxChars < 20) {
    throw new ConfigError(`ANSWER_MAX_CHARS must be a whole number of at least 20, got "${rawMax}"`);
  }

  const config: AppConfig = {
    provider,
    anthropic: {
      apiKey: value(env, "ANTHROPIC_API_KEY"),
      model: value(env, "ANTHROPIC_MODEL") || "claude-opus-5",
    },
    openai: {
      apiKey: value(env, "OPENAI_API_KEY"),
      baseURL: value(env, "OPENAI_BASE_URL") || undefined,
      model: value(env, "OPENAI_MODEL"),
    },
    answerMaxChars,
  };

  if (provider === "anthropic" && !config.anthropic.apiKey) {
    throw new ConfigError("ANTHROPIC_API_KEY is not set");
  }
  if (provider === "openai" && !config.openai.apiKey) {
    throw new ConfigError("OPENAI_API_KEY is not set");
  }
  if (provider === "openai" && !config.openai.model) {
    throw new ConfigError("OPENAI_MODEL is not set");
  }
  return config;
}
