# Question-Answer Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js website that turns a `.docx`/`.txt` document into a grounded `question`/`text` Q&A table (`.xlsx`/`.csv`) for xinren-rag, using Claude or OpenAI.

**Architecture:** One Next.js app in `question-answer-generator/`. A POST route parses the upload, splits it into chunks, and runs a two-stage LLM pipeline. Stage 1 extracts short, grounded answers with verbatim evidence; deterministic checks drop anything unsupported. Stage 2 writes N questions per answer. The route streams NDJSON progress. A second route exports rows to xlsx/csv. The pipeline depends only on an `LlmClient` interface, so every test runs offline with a fake.

**Tech Stack:** Next.js 16.3.4 (App Router, standalone output), React 19.3, Tailwind 4, TypeScript 5, `@anthropic-ai/sdk` 0.125.0, `openai` 7.14.0, `zod` 4.6.1, `mammoth` 1.12.2, `exceljs` 4.4.0, `vitest` 5.0.0.

**Spec:** `docs/superpowers/specs/2026-09-10-question-answer-generator-design.md` (requirements: `docs/requirements.md`)

## Global Constraints

- All paths below are relative to `question-answer-generator/` unless they start with `../` (the evoindexer root).
- **Not a git repository:** skip commits. Each task ends with a checkpoint (tests + typecheck green).
- Output columns are exactly `question`, `text`; one question per row; the answer is repeated on each row.
- Upload limit 10 MB (`10 * 1024 * 1024` bytes); extracted text limit 200,000 characters (code points). Reject larger input, never truncate.
- `variants` (questions per answer): integer 1–6, default 3.
- `ANSWER_MAX_CHARS`: integer ≥ 20, default 100, read from env on each request.
- Anthropic default model `claude-opus-5`. Requests use `fallbacks: "default"` + beta `server-side-fallback-2026-07-01`, streaming with `max_tokens: 64000`.
- `OPENAI_MODEL` has no default; it is required when `LLM_PROVIDER=openai`.
- Pipeline concurrency 3; chunk size 6,000 chars; question batch size 15.
- Native: app port 3001, nginx 8082. Docker: container port 3000, shared nginx publishes 8082.
- Do not modify `../frontend/` or `../xinren-rag/`.
- Imports inside the app use the `@/` alias (`@/lib/...`); vitest resolves it via `vitest.config.ts`.
- Typecheck command: `npx tsc --noEmit`. Test command: `npx vitest run`.

---

### Task 1: Scaffold the Next.js app and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.example`, `public/.gitkeep`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`

**Interfaces:**
- Produces: working `npm run build`, `npx vitest run`, `@/` import alias in both Next and vitest.

- [ ] **Step 1: Create `package.json` (scripts only) and install pinned dependencies**

```json
{
  "name": "question-answer-generator",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "eslint",
    "test": "vitest run"
  }
}
```

Run:

```bash
npm install --save-exact next@16.3.4 react@19.3.0 react-dom@19.3.0 @anthropic-ai/sdk@0.125.0 openai@7.14.0 zod@4.6.1 mammoth@1.12.2 exceljs@4.4.0
npm install --save-dev --save-exact vitest@5.0.0 eslint-config-next@16.3.4
npm install --save-dev "@tailwindcss/postcss@^4" "tailwindcss@^4" "typescript@^5" "@types/node@^22" "@types/react@^19" "@types/react-dom@^19" "eslint@^9"
```

Expected: `package.json` has the dependencies, `package-lock.json` exists, no peer-dependency errors.

- [ ] **Step 2: Create config files**

`tsconfig.json` (same as `../frontend/tsconfig.json`):

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Loaded from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["mammoth", "exceljs"],
};

export default nextConfig;
```

`postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

`eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
```

`vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

`.gitignore`:

```gitignore
/node_modules
/.next/
/out/
/build
/coverage
.DS_Store
*.pem
npm-debug.log*
.env*
!.env.example
*.tsbuildinfo
next-env.d.ts
```

`.env.example`:

```bash
# LLM provider: anthropic or openai
LLM_PROVIDER=anthropic

# Anthropic (Claude)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5

# OpenAI, or any OpenAI-compatible API (e.g. OpenRouter: https://openrouter.ai/api/v1)
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=

# Maximum characters per generated answer (answers are spoken by a digital human)
ANSWER_MAX_CHARS=100
```

`public/.gitkeep`: empty file (the Dockerfile copies `public/`).

- [ ] **Step 3: Create the app shell**

`app/globals.css`:

```css
@import "tailwindcss";

:root {
  --background: #fafafa;
  --foreground: #18181b;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #09090b;
    --foreground: #f4f4f5;
  }
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
```

`app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Q&A Generator",
  description: "Generate question/answer tables for EvoIndexer retrievers from documents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
```

`app/page.tsx` (placeholder, replaced in Task 12):

```tsx
export default function Home() {
  return <main className="p-10 text-2xl font-semibold">Q&amp;A Generator</main>;
}
```

- [ ] **Step 4: Verify tooling**

Run: `npx vitest run --passWithNoTests`
Expected: exits 0 ("No test files found").

Run: `npm run build`
Expected: build succeeds and `.next/standalone/server.js` exists.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Checkpoint** — tooling green.

---

### Task 2: Environment configuration

**Files:**
- Create: `lib/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  - `type Provider = "anthropic" | "openai"`
  - `interface AppConfig { provider: Provider; anthropic: { apiKey: string; model: string }; openai: { apiKey: string; baseURL?: string; model: string }; answerMaxChars: number }`
  - `class ConfigError extends Error`
  - `loadConfig(env?: Record<string, string | undefined>): AppConfig` (defaults to `process.env`)

- [ ] **Step 1: Write the failing test** — `tests/config.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL (cannot resolve `@/lib/config`).

- [ ] **Step 3: Implement** — `lib/config.ts`

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/config.test.ts && npx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 5: Checkpoint.**

---

### Task 3: Document parsing

**Files:**
- Create: `lib/parse.ts`
- Test: `tests/parse.test.ts`

**Interfaces:**
- Produces:
  - `MAX_UPLOAD_BYTES = 10 * 1024 * 1024`, `MAX_TEXT_CHARS = 200_000`
  - `class InputError extends Error` (message is shown to the user)
  - `fileKind(filename: string): "docx" | "txt"` (throws `InputError`)
  - `decodeText(bytes: Uint8Array): string`
  - `extractText(filename: string, bytes: Uint8Array): Promise<string>` — non-empty text, `\n` line endings, trimmed, ≤ `MAX_TEXT_CHARS` code points; throws `InputError`

- [ ] **Step 1: Write the failing test** — `tests/parse.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeText, extractText, fileKind, InputError, MAX_TEXT_CHARS } from "@/lib/parse";

// "首钢模式是以厂矿为基础的慢病防治网络。" encoded as GB18030 (not valid UTF-8).
const GBK_TEXT = "首钢模式是以厂矿为基础的慢病防治网络。";
const GBK_BYTES = Uint8Array.from([
  0xca, 0xd7, 0xb8, 0xd6, 0xc4, 0xa3, 0xca, 0xbd, 0xca, 0xc7, 0xd2, 0xd4, 0xb3, 0xa7, 0xbf, 0xf3, 0xce, 0xaa, 0xbb,
  0xf9, 0xb4, 0xa1, 0xb5, 0xc4, 0xc2, 0xfd, 0xb2, 0xa1, 0xb7, 0xc0, 0xd6, 0xce, 0xcd, 0xf8, 0xc2, 0xe7, 0xa1, 0xa3,
]);

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("fileKind", () => {
  it("accepts docx and txt in any case", () => {
    expect(fileKind("a.docx")).toBe("docx");
    expect(fileKind("A.DOCX")).toBe("docx");
    expect(fileKind("notes.txt")).toBe("txt");
  });

  it("rejects other types", () => {
    expect(() => fileKind("a.pdf")).toThrow(InputError);
    expect(() => fileKind("noext")).toThrow(/\.docx and \.txt/);
  });
});

describe("decodeText", () => {
  it("decodes UTF-8 and strips a BOM", () => {
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("展厅")]))).toBe("展厅");
  });

  it("falls back to GB18030 for GBK files", () => {
    expect(decodeText(GBK_BYTES)).toBe(GBK_TEXT);
  });
});

describe("extractText", () => {
  it("reads all paragraphs of the sample docx, including tracked insertions", async () => {
    const text = await extractText("01-input.docx", new Uint8Array(readFileSync("materials/01-input.docx")));
    expect(text.startsWith("国家心血管病中心")).toBe(true);
    for (const phrase of ["首钢模式", "五进、六进", "4.9万条视频", "感谢您的参观指导"]) {
      expect(text).toContain(phrase);
    }
  });

  it("normalizes line endings and trims txt", async () => {
    expect(await extractText("a.txt", utf8("  第一段\r\n第二段\r\n\r\n"))).toBe("第一段\n第二段");
  });

  it("reads GBK txt", async () => {
    expect(await extractText("a.txt", GBK_BYTES)).toBe(GBK_TEXT);
  });

  it("rejects an empty document", async () => {
    await expect(extractText("a.txt", utf8(" \n "))).rejects.toThrow(/no text/);
  });

  it("rejects text over the limit and accepts text at the limit", async () => {
    await expect(extractText("a.txt", utf8("字".repeat(MAX_TEXT_CHARS + 1)))).rejects.toThrow(/200,000/);
    await expect(extractText("a.txt", utf8("字".repeat(MAX_TEXT_CHARS)))).resolves.toHaveLength(MAX_TEXT_CHARS);
  });

  it("rejects a corrupt docx", async () => {
    await expect(extractText("a.docx", utf8("not a zip"))).rejects.toThrow(InputError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/parse.test.ts`
Expected: FAIL (cannot resolve `@/lib/parse`).

- [ ] **Step 3: Implement** — `lib/parse.ts`

```ts
import mammoth from "mammoth";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;

/** An input problem whose message can be shown to the user as-is. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function fileKind(filename: string): "docx" | "txt" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".txt")) return "txt";
  throw new InputError("Only .docx and .txt files are supported");
}

/** UTF-8 first; Chinese text files are often GBK, which GB18030 decodes. */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("gb18030").decode(bytes);
  }
  return text.replace(/^\uFEFF/, "");
}

export async function extractText(filename: string, bytes: Uint8Array): Promise<string> {
  let text: string;
  if (fileKind(filename) === "docx") {
    try {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } catch {
      throw new InputError("Could not read the .docx file. Is it a valid Word document?");
    }
  } else {
    text = decodeText(bytes);
  }

  text = text.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new InputError("The document contains no text");

  const chars = [...text].length;
  if (chars > MAX_TEXT_CHARS) {
    throw new InputError(
      `The document has ${chars.toLocaleString("en-US")} characters of text; the limit is ${MAX_TEXT_CHARS.toLocaleString("en-US")}`,
    );
  }
  return text;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/parse.test.ts && npx tsc --noEmit`
Expected: all PASS; no type errors.

- [ ] **Step 5: Checkpoint.**

---

### Task 4: Chunking

**Files:**
- Create: `lib/chunk.ts`
- Test: `tests/chunk.test.ts`

**Interfaces:**
- Produces: `DEFAULT_CHUNK_CHARS = 6000`; `chunkText(text: string, maxChars?: number): string[]`. Whole paragraphs are joined with `\n`; an over-long paragraph is split at sentence ends (`。！？!?`, or `.` followed by whitespace); a sentence over the limit is hard-split. Every chunk is ≤ `maxChars` code points.

- [ ] **Step 1: Write the failing test** — `tests/chunk.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/chunk";

const strip = (s: string) => s.replace(/\s+/g, "");
const len = (s: string) => [...s].length;

describe("chunkText", () => {
  it("returns one chunk for short text and drops blank lines", () => {
    expect(chunkText("一。\n\n\n二。", 100)).toEqual(["一。\n二。"]);
  });

  it("groups whole paragraphs without exceeding the limit", () => {
    const paragraphs = ["甲".repeat(40), "乙".repeat(40), "丙".repeat(40)];
    expect(chunkText(paragraphs.join("\n\n"), 100)).toEqual([`${paragraphs[0]}\n${paragraphs[1]}`, paragraphs[2]]);
  });

  it("splits an over-long paragraph at sentence ends", () => {
    const paragraph = "这是一个测试句子，用来检查切分。".repeat(10); // 16 chars per sentence
    const chunks = chunkText(paragraph, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(len(chunk)).toBeLessThanOrEqual(50);
      expect(chunk.endsWith("。")).toBe(true);
    }
    expect(strip(chunks.join(""))).toBe(strip(paragraph));
  });

  it("does not split decimals such as 4.9万", () => {
    const paragraph = "数据库中目前已有4.9万条视频。" + "补充说明文字。".repeat(10);
    expect(chunkText(paragraph, 30).some((c) => c.includes("数据库中目前已有4.9万条视频。"))).toBe(true);
  });

  it("hard-splits a single sentence longer than the limit", () => {
    expect(chunkText("字".repeat(120), 50).map(len)).toEqual([50, 50, 20]);
  });

  it("keeps all text", () => {
    const text = Array.from({ length: 30 }, (_, i) => `第${i}段。${"内容很多。".repeat(i)}`).join("\n\n");
    const chunks = chunkText(text, 60);
    expect(chunks.every((c) => len(c) <= 60)).toBe(true);
    expect(strip(chunks.join(""))).toBe(strip(text));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/chunk.test.ts`
Expected: FAIL (cannot resolve `@/lib/chunk`).

- [ ] **Step 3: Implement** — `lib/chunk.ts`

```ts
export const DEFAULT_CHUNK_CHARS = 6000;

const length = (s: string) => [...s].length;

function hardSplit(s: string, maxChars: number): string[] {
  const chars = [...s];
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) parts.push(chars.slice(i, i + maxChars).join(""));
  return parts;
}

/** Split after Chinese/Western sentence enders; "." only counts before whitespace, so 4.9 stays whole. */
function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[。！？!?])|(?<=\.\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function chunkText(text: string, maxChars = DEFAULT_CHUNK_CHARS): string[] {
  const pieces: string[] = [];
  for (const paragraph of text.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    if (length(paragraph) <= maxChars) {
      pieces.push(paragraph);
      continue;
    }
    for (const sentence of splitSentences(paragraph)) {
      if (length(sentence) <= maxChars) pieces.push(sentence);
      else pieces.push(...hardSplit(sentence, maxChars));
    }
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  for (const piece of pieces) {
    const pieceLength = length(piece);
    if (current.length > 0 && currentLength + 1 + pieceLength > maxChars) {
      chunks.push(current.join("\n"));
      current = [];
      currentLength = 0;
    }
    currentLength += (current.length > 0 ? 1 : 0) + pieceLength;
    current.push(piece);
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/chunk.test.ts && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Checkpoint.**

---

### Task 5: Grounding checks

**Files:**
- Create: `lib/pipeline/ground.ts`
- Test: `tests/ground.test.ts`

**Interfaces:**
- Produces:
  - `type DropReason = "evidence" | "numbers" | "length"`
  - `normalize(s: string): string` — NFKC, removes zero-width characters (U+200B–U+200D, U+FEFF) and all whitespace
  - `charLength(s: string): number` — code points
  - `numbersIn(s: string): string[]` — Arabic numbers (after NFKC; thousands commas removed; decimals kept)
  - `checkUnit(unit: { answer: string; evidence: string[] }, normalizedSource: string, maxChars: number): "ok" | DropReason` — checks in the order evidence → numbers → length. Evidence quotes must be ≥ 4 normalized chars and appear in the source.

- [ ] **Step 1: Write the failing test** — `tests/ground.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { charLength, checkUnit, normalize, numbersIn } from "@/lib/pipeline/ground";

const SOURCE =
  "第一阶段始于1959年，以专家的探索和实践为主。\n“阜外说心脏”吸引超17万用户关注，数据库中目前已有4.9万条视频。 学校共有12个校区，\u200C芳古园校区。";
const source = normalize(SOURCE);

describe("normalize / numbersIn / charLength", () => {
  it("normalizes width, whitespace and zero-width characters", () => {
    expect(normalize("Ａ Ｂ\u200B\n１２\uFEFF")).toBe("AB12");
  });

  it("finds Arabic numbers including full-width digits, decimals and thousands separators", () => {
    expect(numbersIn("始于1959年，已有4.9万条，１７万，1,500家")).toEqual(["1959", "4.9", "17", "1500"]);
  });

  it("counts code points", () => {
    expect(charLength("首钢😀")).toBe(3);
  });
});

describe("checkUnit", () => {
  it("accepts a grounded unit", () => {
    expect(checkUnit({ answer: "我国心血管疾病防控第一阶段始于1959年。", evidence: ["第一阶段始于1959年"] }, source, 100)).toBe("ok");
  });

  it("ignores whitespace and zero-width differences in evidence", () => {
    expect(checkUnit({ answer: "学校共有12个校区。", evidence: ["学校共有12个校区，芳古园校区"] }, source, 100)).toBe("ok");
  });

  it("accepts numbers drawn from any of the quotes", () => {
    const unit = { answer: "有17万用户和4.9万条视频。", evidence: ["吸引超17万用户关注", "已有4.9万条视频"] };
    expect(checkUnit(unit, source, 100)).toBe("ok");
  });

  it.each([
    ["quote not in source", { answer: "第三阶段始于2009年。", evidence: ["第三阶段始于2009年"] }],
    ["no quotes", { answer: "第一阶段很早。", evidence: [] }],
    ["trivially short quote", { answer: "第一阶段很早。", evidence: ["第一"] }],
  ])("rejects evidence: %s", (_name, unit) => {
    expect(checkUnit(unit, source, 100)).toBe("evidence");
  });

  it("rejects a number that is not in the evidence", () => {
    expect(checkUnit({ answer: "第一阶段始于1960年。", evidence: ["第一阶段始于1959年"] }, source, 100)).toBe("numbers");
  });

  it("rejects an answer over the length limit", () => {
    expect(checkUnit({ answer: "甲".repeat(21), evidence: ["以专家的探索和实践为主"] }, source, 20)).toBe("length");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ground.test.ts`
Expected: FAIL (cannot resolve module).

- [ ] **Step 3: Implement** — `lib/pipeline/ground.ts`

```ts
export type DropReason = "evidence" | "numbers" | "length";

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const MIN_EVIDENCE_CHARS = 4;

export function normalize(s: string): string {
  return s.normalize("NFKC").replace(ZERO_WIDTH, "").replace(/\s+/g, "");
}

export function charLength(s: string): number {
  return [...s].length;
}

export function numbersIn(s: string): string[] {
  const text = normalize(s).replace(/(\d),(?=\d{3})/g, "$1");
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

export function checkUnit(
  unit: { answer: string; evidence: string[] },
  normalizedSource: string,
  maxChars: number,
): "ok" | DropReason {
  if (unit.evidence.length === 0) return "evidence";
  for (const quote of unit.evidence) {
    const normalized = normalize(quote);
    if (charLength(normalized) < MIN_EVIDENCE_CHARS || !normalizedSource.includes(normalized)) return "evidence";
  }

  const evidenceNumbers = new Set(unit.evidence.flatMap(numbersIn));
  if (numbersIn(unit.answer).some((n) => !evidenceNumbers.has(n))) return "numbers";

  if (charLength(unit.answer.trim()) > maxChars) return "length";
  return "ok";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ground.test.ts && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Checkpoint.**

---

### Task 6: LLM clients (Anthropic, OpenAI, retry wrapper)

**Files:**
- Create: `lib/llm/types.ts`, `lib/llm/errors.ts`, `lib/llm/anthropic.ts`, `lib/llm/openai.ts`, `lib/llm/index.ts`
- Test: `tests/llm.test.ts`

**Interfaces:**
- Consumes: `AppConfig` (Task 2).
- Produces:
  - `interface JsonRequest<T> { system: string; user: string; schema: z.ZodType<T>; signal?: AbortSignal }`
  - `interface LlmClient { generateJson<T>(req: JsonRequest<T>): Promise<T> }`
  - `class LlmOutputError extends Error` (retried once), `class LlmRefusalError extends Error` (not retried)
  - `describeLlmError(err: unknown): string` — user-facing message; maps HTTP 401/403/404/429/5xx
  - `createAnthropicLlm(opts: { apiKey: string; model: string }, api?: Anthropic["beta"]["messages"]): LlmClient`
  - `createOpenAiLlm(opts: { apiKey: string; baseURL?: string; model: string }, api?: OpenAI["chat"]["completions"]): LlmClient`
  - `withOutputRetry(client: LlmClient): LlmClient`
  - `createLlm(config: AppConfig): LlmClient`

- [ ] **Step 1: Write the failing test** — `tests/llm.test.ts`

```ts
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLlm, withOutputRetry } from "@/lib/llm";
import { createAnthropicLlm } from "@/lib/llm/anthropic";
import { describeLlmError, LlmOutputError, LlmRefusalError } from "@/lib/llm/errors";
import { createOpenAiLlm } from "@/lib/llm/openai";
import type { LlmClient } from "@/lib/llm/types";
import type { AppConfig } from "@/lib/config";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/llm.test.ts`
Expected: FAIL (cannot resolve `@/lib/llm`).

- [ ] **Step 3: Implement**

`lib/llm/types.ts`:

```ts
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
```

`lib/llm/errors.ts`:

```ts
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
```

`lib/llm/anthropic.ts`:

```ts
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
```

`lib/llm/openai.ts`:

```ts
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
```

`lib/llm/index.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/llm.test.ts && npx tsc --noEmit`
Expected: all PASS; no type errors. If `tsc` rejects the `api.stream({...})` params (e.g. `fallbacks` not in `BetaMessageStreamParams`), check `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` for the correct property placement rather than casting to `any`.

- [ ] **Step 5: Checkpoint.**

---

### Task 7: Stage 1 — schemas, prompts, extraction with repair

**Files:**
- Create: `lib/pipeline/schemas.ts`, `lib/pipeline/prompts.ts`, `lib/pipeline/extract.ts`
- Create: `tests/helpers/fake-llm.ts`
- Test: `tests/extract.test.ts`

**Interfaces:**
- Consumes: `LlmClient`, `JsonRequest` (Task 6); `checkUnit`, `DropReason` (Task 5).
- Produces:
  - `ExtractSchema` (`{ units: { answer: string; evidence: string[] }[] }`) and `QuestionsSchema` (`{ items: { id: string; questions: string[] }[] }`)
  - `extractPrompt({ context, chunk, maxChars })`, `repairPrompt({ context, units, maxChars })`, `questionsPrompt({ context, units, variants })` → `{ system: string; user: string }`. Every user prompt is `Document: ${context}\n\n${payload}`.
  - `interface Unit { answer: string; evidence: string[] }`, `type DropCounts = Record<DropReason, number>`, `emptyDrops(): DropCounts`
  - `extractChunk(input: { llm; context; chunk; normalizedSource; maxChars; signal? }): Promise<{ units: Unit[]; dropped: DropCounts }>`
  - Test helper `fakeLlm({ extract?, questions? })` → `LlmClient & { calls: JsonRequest<unknown>[] }`

- [ ] **Step 1: Create schemas and prompts** (needed by the fake)

`lib/pipeline/schemas.ts`:

```ts
import { z } from "zod";

// Kept constraint-free so both providers' structured-output modes accept them; limits are enforced in code.
export const ExtractSchema = z.object({
  units: z.array(z.object({ answer: z.string(), evidence: z.array(z.string()) })),
});

export const QuestionsSchema = z.object({
  items: z.array(z.object({ id: z.string(), questions: z.array(z.string()) })),
});
```

`lib/pipeline/prompts.ts`:

```ts
export interface Prompt {
  system: string;
  user: string;
}

export function extractPrompt({ context, chunk, maxChars }: { context: string; chunk: string; maxChars: number }): Prompt {
  const system = [
    "You turn source documents into a knowledge base for a digital human that answers visitors' questions by speaking.",
    "From the document section you are given, extract every fact a visitor might ask about, as a list of units. Each unit has an answer and its evidence.",
    "",
    "Rules for each answer:",
    "- Use only what the section states. Do not add outside knowledge, guesses, or conclusions the text does not state.",
    "- Make it self-contained: it will be heard without the document, so name the subject explicitly instead of using words like 我们, 这里, 这个展厅, or 它.",
    `- Keep it short enough to speak: at most ${maxChars} characters. If a fact needs more, split it into several units that each stand alone.`,
    "- Write natural, complete spoken sentences. No lists, bullet points, markdown, bracketed notes, or URLs.",
    "- Write numbers, dates, and quantities exactly as the source writes them. Do not convert between Chinese and Arabic numerals.",
    "- Write in the same language as the document.",
    "",
    "Rules for evidence:",
    "- Give 1 to 3 quotes copied verbatim from the section. Each quote is a contiguous span of the original text. Together they support everything the answer says.",
    "",
    "Skip text that is only an instruction to the presenter or a stage direction (for example, a note to introduce something based on the wall content).",
    "Cover the whole section, not just its beginning.",
  ].join("\n");
  return { system, user: `Document: ${context}\n\n<section>\n${chunk}\n</section>` };
}

export function repairPrompt({
  context,
  units,
  maxChars,
}: {
  context: string;
  units: { answer: string; evidence: string[] }[];
  maxChars: number;
}): Prompt {
  const system = [
    "You rewrite answers that a digital human speaks aloud.",
    `Each answer below is longer than ${maxChars} characters. Rewrite each one into one or more units whose answers are at most ${maxChars} characters.`,
    "Use only the information in that answer's evidence. Keep every answer self-contained, in natural spoken sentences, in the same language.",
    "Write numbers exactly as the evidence writes them.",
    "For each new unit, give 1 to 3 quotes copied verbatim from the given evidence as its evidence.",
  ].join("\n");
  return { system, user: `Document: ${context}\n\n${JSON.stringify(units, null, 2)}` };
}

export function questionsPrompt({
  context,
  units,
  variants,
}: {
  context: string;
  units: { id: string; answer: string }[];
  variants: number;
}): Prompt {
  const system = [
    "You write the questions visitors would ask a digital human, for a question-matching knowledge base.",
    `For each answer below, write ${variants} different questions that this answer fully answers.`,
    "",
    "Rules:",
    "- Vary the angle and wording, not just synonyms. Mix styles such as a direct question, a casual spoken question a visitor would ask, a short keyword-style query, and why / how / when / who / how-many questions where the answer supports them.",
    "- Every question must be fully answered by its answer. Do not ask about anything the answer does not contain.",
    "- Each question must name its subject so it makes sense on its own; never rely on 它 or other context.",
    "- Write in the same language as the answers.",
    "- Return one item per answer, using the answer's id.",
  ].join("\n");
  return { system, user: `Document: ${context}\n\n${JSON.stringify(units, null, 2)}` };
}
```

- [ ] **Step 2: Create the fake LLM** — `tests/helpers/fake-llm.ts`

```ts
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
```

- [ ] **Step 3: Write the failing test** — `tests/extract.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { extractChunk } from "@/lib/pipeline/extract";
import { normalize } from "@/lib/pipeline/ground";
import { fakeLlm } from "./helpers/fake-llm";

const SOURCE = "第一阶段始于1959年，重点是高血压和冠心病。第二阶段是1987年开始，成立了全国心血管病防治研究办公室。";
const base = { context: "doc.txt — 标题", chunk: SOURCE, normalizedSource: normalize(SOURCE), maxChars: 40 };

describe("extractChunk", () => {
  it("keeps grounded units and counts dropped ones", async () => {
    const llm = fakeLlm({
      extract: () => ({
        units: [
          { answer: "我国心血管疾病防控第一阶段始于1959年。", evidence: ["第一阶段始于1959年"] },
          { answer: "第二阶段始于1988年。", evidence: ["第二阶段是1987年开始"] },
          { answer: "第三阶段始于2009年。", evidence: ["第三阶段始于2009年"] },
          { answer: "  ", evidence: ["第一阶段始于1959年"] },
        ],
      }),
    });

    const result = await extractChunk({ llm, ...base });

    expect(result.units).toEqual([{ answer: "我国心血管疾病防控第一阶段始于1959年。", evidence: ["第一阶段始于1959年"] }]);
    expect(result.dropped).toEqual({ evidence: 1, numbers: 1, length: 0 });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].system).toContain("at most 40 characters");
    expect(llm.calls[0].user).toContain("Document: doc.txt — 标题");
    expect(llm.calls[0].user).toContain(SOURCE);
  });

  it("repairs over-long answers once and re-checks the result", async () => {
    const long = {
      answer: SOURCE,
      evidence: ["第一阶段始于1959年，重点是高血压和冠心病。", "第二阶段是1987年开始，成立了全国心血管病防治研究办公室。"],
    };
    const llm = fakeLlm({
      extract: (_req, call) =>
        call === 0
          ? { units: [long] }
          : {
              units: [
                { answer: "第一阶段始于1959年，重点是高血压和冠心病。", evidence: ["第一阶段始于1959年，重点是高血压和冠心病。"] },
                { answer: "第二阶段始于1987年，成立了全国心血管病防治研究办公室。", evidence: ["第二阶段是1987年开始，成立了全国心血管病防治研究办公室。"] },
                { answer: "甲".repeat(41), evidence: ["第一阶段始于1959年"] },
              ],
            },
    });

    const result = await extractChunk({ llm, ...base });

    expect(result.units.map((u) => u.answer)).toEqual([
      "第一阶段始于1959年，重点是高血压和冠心病。",
      "第二阶段始于1987年，成立了全国心血管病防治研究办公室。",
    ]);
    expect(result.dropped).toEqual({ evidence: 0, numbers: 0, length: 1 });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].system).toContain("longer than 40 characters");
    expect(llm.calls[1].user).toContain(long.answer);
  });

  it("counts over-long units as dropped when the repair call fails", async () => {
    const llm = fakeLlm({
      extract: (_req, call) => {
        if (call === 0) return { units: [{ answer: "甲".repeat(41), evidence: ["第一阶段始于1959年"] }] };
        throw new Error("boom");
      },
    });

    const result = await extractChunk({ llm, ...base });

    expect(result.units).toEqual([]);
    expect(result.dropped).toEqual({ evidence: 0, numbers: 0, length: 1 });
  });

  it("keeps at most three trimmed evidence quotes", async () => {
    const quote = "第一阶段始于1959年";
    const llm = fakeLlm({
      extract: () => ({ units: [{ answer: "第一阶段始于1959年。", evidence: [` ${quote} `, "", quote, quote, quote] }] }),
    });

    const result = await extractChunk({ llm, ...base });

    expect(result.units[0].evidence).toEqual([quote, quote, quote]);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run tests/extract.test.ts`
Expected: FAIL (cannot resolve `@/lib/pipeline/extract`).

- [ ] **Step 5: Implement** — `lib/pipeline/extract.ts`

```ts
import type { LlmClient } from "../llm/types";
import { checkUnit, type DropReason } from "./ground";
import { extractPrompt, repairPrompt } from "./prompts";
import { ExtractSchema } from "./schemas";

export interface Unit {
  answer: string;
  evidence: string[];
}

export type DropCounts = Record<DropReason, number>;

export const emptyDrops = (): DropCounts => ({ evidence: 0, numbers: 0, length: 0 });

export interface ExtractInput {
  llm: LlmClient;
  context: string;
  chunk: string;
  normalizedSource: string;
  maxChars: number;
  signal?: AbortSignal;
}

function clean(units: Unit[]): Unit[] {
  return units
    .map((u) => ({ answer: u.answer.trim(), evidence: u.evidence.map((e) => e.trim()).filter(Boolean).slice(0, 3) }))
    .filter((u) => u.answer);
}

export async function extractChunk({ llm, context, chunk, normalizedSource, maxChars, signal }: ExtractInput) {
  const dropped = emptyDrops();
  const units: Unit[] = [];
  const tooLong: Unit[] = [];

  const first = await llm.generateJson({ ...extractPrompt({ context, chunk, maxChars }), schema: ExtractSchema, signal });
  for (const unit of clean(first.units)) {
    const result = checkUnit(unit, normalizedSource, maxChars);
    if (result === "ok") units.push(unit);
    else if (result === "length") tooLong.push(unit);
    else dropped[result]++;
  }

  if (tooLong.length > 0) {
    try {
      const repaired = await llm.generateJson({ ...repairPrompt({ context, units: tooLong, maxChars }), schema: ExtractSchema, signal });
      for (const unit of clean(repaired.units)) {
        const result = checkUnit(unit, normalizedSource, maxChars);
        if (result === "ok") units.push(unit);
        else dropped[result]++;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      dropped.length += tooLong.length;
    }
  }

  return { units, dropped };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run tests/extract.test.ts && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 7: Checkpoint.**

---

### Task 8: Stage 2 — question variants

**Files:**
- Create: `lib/pipeline/questions.ts`
- Test: `tests/questions.test.ts`

**Interfaces:**
- Consumes: `questionsPrompt`, `QuestionsSchema` (Task 7), `LlmClient`.
- Produces: `generateQuestions(input: { llm: LlmClient; context: string; units: { id: string; answer: string }[]; variants: number; signal?: AbortSignal }): Promise<Map<string, string[]>>`. Returns trimmed, non-empty questions, capped at `variants`, for known ids only.

- [ ] **Step 1: Write the failing test** — `tests/questions.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { generateQuestions } from "@/lib/pipeline/questions";
import { fakeLlm } from "./helpers/fake-llm";

describe("generateQuestions", () => {
  it("returns up to N trimmed questions for each known unit id", async () => {
    const llm = fakeLlm({
      questions: () => ({
        items: [
          { id: "u1", questions: [" 问题一？ ", "问题二？", "", "问题三？"] },
          { id: "u2", questions: ["问题四？"] },
          { id: "zzz", questions: ["不存在？"] },
        ],
      }),
    });

    const result = await generateQuestions({
      llm,
      context: "doc.txt — 标题",
      units: [
        { id: "u1", answer: "答一" },
        { id: "u2", answer: "答二" },
      ],
      variants: 2,
    });

    expect(Object.fromEntries(result)).toEqual({ u1: ["问题一？", "问题二？"], u2: ["问题四？"] });
    expect(llm.calls[0].system).toContain("write 2 different questions");
    expect(llm.calls[0].user).toContain("答一");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/questions.test.ts`
Expected: FAIL (cannot resolve module).

- [ ] **Step 3: Implement** — `lib/pipeline/questions.ts`

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/questions.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Checkpoint.**

---

### Task 9: Pipeline orchestration

**Files:**
- Create: `lib/pipeline/run.ts`
- Test: `tests/run.test.ts`

**Interfaces:**
- Consumes: `chunkText`, `DEFAULT_CHUNK_CHARS` (Task 4); `normalize` (Task 5); `describeLlmError`, `LlmClient` (Task 6); `extractChunk`, `emptyDrops`, `DropCounts`, `Unit` (Task 7); `generateQuestions` (Task 8).
- Produces:
  - `interface QaRow { question: string; text: string }`
  - `interface RunStats { chunks: number; units: number; dropped: DropCounts; failedChunks: number; failedBatches: number; failureReason: string | null; rows: number }`
  - `type ProgressEvent = { type: "parsed"; chars: number; chunks: number } | { type: "extract"; done: number; total: number; units: number } | { type: "questions"; done: number; total: number }`
  - `type StreamEvent = ProgressEvent | { type: "result"; rows: QaRow[]; stats: RunStats } | { type: "error"; message: string }`
  - `class PipelineError extends Error`
  - `mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]>`
  - `documentContext(filename: string, text: string): string` → `"<filename> — <first non-empty line, ≤100 chars>"`
  - `runPipeline(input: RunInput): Promise<{ rows: QaRow[]; stats: RunStats }>`, where `RunInput = { text; filename; variants; maxChars; llm; emit: (e: ProgressEvent) => void; signal?; chunkChars?; batchSize?; concurrency? }`. Throws `PipelineError` if every chunk, or every question batch, fails.

- [ ] **Step 1: Write the failing test** — `tests/run.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { LlmRefusalError } from "@/lib/llm/errors";
import type { JsonRequest } from "@/lib/llm/types";
import { documentContext, mapLimit, PipelineError, runPipeline, type ProgressEvent } from "@/lib/pipeline/run";
import { fakeLlm } from "./helpers/fake-llm";

// With chunkChars 40: chunk 1 = title + first paragraph (27 chars), chunk 2 = second paragraph (30 chars).
const TEXT = ["标题行", "第一阶段始于1959年，重点是高血压和冠心病。", "第二阶段是1987年开始，成立了全国心血管病防治研究办公室。"].join("\n\n");
const unitA = { answer: "第一阶段始于1959年，重点是高血压和冠心病。", evidence: ["第一阶段始于1959年"] };
const unitB = { answer: "第二阶段始于1987年。", evidence: ["第二阶段是1987年开始"] };
const byChunk = (req: JsonRequest<unknown>) => ({ units: req.user.includes("1959") ? [unitA] : [unitB] });
const twoEach = (units: { id: string }[]) => ({ items: units.map((u) => ({ id: u.id, questions: [`${u.id}问法一？`, `${u.id}问法二？`] })) });
const small = { filename: "doc.txt", variants: 2, maxChars: 100, chunkChars: 40, batchSize: 1, concurrency: 1 };

describe("runPipeline", () => {
  it("emits progress and fans each answer out into one row per question", async () => {
    const events: ProgressEvent[] = [];
    const llm = fakeLlm({ extract: byChunk, questions: twoEach });

    const result = await runPipeline({ ...small, text: TEXT, llm, emit: (e) => events.push(e) });

    expect(result.rows).toEqual([
      { question: "u1问法一？", text: unitA.answer },
      { question: "u1问法二？", text: unitA.answer },
      { question: "u2问法一？", text: unitB.answer },
      { question: "u2问法二？", text: unitB.answer },
    ]);
    expect(result.stats).toEqual({
      chunks: 2,
      units: 2,
      dropped: { evidence: 0, numbers: 0, length: 0 },
      failedChunks: 0,
      failedBatches: 0,
      failureReason: null,
      rows: 4,
    });
    expect(events).toEqual([
      { type: "parsed", chars: [...TEXT].length, chunks: 2 },
      { type: "extract", done: 1, total: 2, units: 1 },
      { type: "extract", done: 2, total: 2, units: 2 },
      { type: "questions", done: 1, total: 2 },
      { type: "questions", done: 2, total: 2 },
    ]);
    expect(llm.calls[0].user).toContain("Document: doc.txt — 标题行");
  });

  it("removes duplicate answers and duplicate questions", async () => {
    const llm = fakeLlm({
      extract: (req) => ({ units: req.user.includes("1959") ? [unitA, unitB] : [unitA] }),
      questions: (units) => ({ items: units.map((u) => ({ id: u.id, questions: ["这是什么？", `${u.id}？`] })) }),
    });

    const result = await runPipeline({ ...small, text: TEXT, llm, emit: () => {} });

    expect(result.stats.units).toBe(2);
    expect(result.rows).toEqual([
      { question: "这是什么？", text: unitA.answer },
      { question: "u1？", text: unitA.answer },
      { question: "u2？", text: unitB.answer },
    ]);
  });

  it("keeps going when a chunk fails and reports why", async () => {
    const llm = fakeLlm({
      extract: (req) => {
        if (req.user.includes("1987")) throw new LlmRefusalError("The model declined");
        return { units: [unitA] };
      },
      questions: twoEach,
    });

    const result = await runPipeline({ ...small, text: TEXT, llm, emit: () => {} });

    expect(result.rows.map((r) => r.text)).toEqual([unitA.answer, unitA.answer]);
    expect(result.stats.failedChunks).toBe(1);
    expect(result.stats.failureReason).toBe("The model declined");
  });

  it("fails when every chunk fails", async () => {
    const llm = fakeLlm({ extract: () => { throw Object.assign(new Error("401"), { status: 401 }); } });
    const run = runPipeline({ ...small, text: TEXT, llm, emit: () => {} });
    await expect(run).rejects.toBeInstanceOf(PipelineError);
    await expect(run).rejects.toThrow(/API key/);
  });

  it("keeps going when a question batch fails", async () => {
    const llm = fakeLlm({
      extract: byChunk,
      questions: (units) => {
        if (units[0].id === "u2") throw new Error("batch failed");
        return twoEach(units);
      },
    });

    const result = await runPipeline({ ...small, text: TEXT, llm, emit: () => {} });

    expect(result.rows).toHaveLength(2);
    expect(result.stats.failedBatches).toBe(1);
    expect(result.stats.failureReason).toBe("batch failed");
  });

  it("fails when every question batch fails", async () => {
    const llm = fakeLlm({ extract: byChunk, questions: () => { throw new Error("all down"); } });
    await expect(runPipeline({ ...small, text: TEXT, llm, emit: () => {} })).rejects.toThrow("all down");
  });

  it("returns no rows when the document has no facts", async () => {
    const events: ProgressEvent[] = [];
    const llm = fakeLlm({ extract: () => ({ units: [] }) });

    const result = await runPipeline({ ...small, text: TEXT, llm, emit: (e) => events.push(e) });

    expect(result.rows).toEqual([]);
    expect(result.stats.units).toBe(0);
    expect(events.some((e) => e.type === "questions")).toBe(false);
  });
});

describe("mapLimit", () => {
  it("never runs more than the limit at once and settles every item in order", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (n === 4) throw new Error("four");
      return n * 2;
    });

    expect(peak).toBe(3);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : "x"))).toEqual([2, 4, 6, "x", 10, 12, 14]);
  });
});

describe("documentContext", () => {
  it("uses the filename and the first non-empty line", () => {
    expect(documentContext("a.docx", "\n\n  展厅串讲词  \n正文")).toBe("a.docx — 展厅串讲词");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/run.test.ts`
Expected: FAIL (cannot resolve module).

- [ ] **Step 3: Implement** — `lib/pipeline/run.ts`

```ts
import { chunkText, DEFAULT_CHUNK_CHARS } from "../chunk";
import { describeLlmError } from "../llm/errors";
import type { LlmClient } from "../llm/types";
import { emptyDrops, extractChunk, type DropCounts, type Unit } from "./extract";
import { normalize } from "./ground";
import { generateQuestions } from "./questions";

export interface QaRow {
  question: string;
  text: string;
}

export interface RunStats {
  chunks: number;
  units: number;
  dropped: DropCounts;
  failedChunks: number;
  failedBatches: number;
  failureReason: string | null;
  rows: number;
}

export type ProgressEvent =
  | { type: "parsed"; chars: number; chunks: number }
  | { type: "extract"; done: number; total: number; units: number }
  | { type: "questions"; done: number; total: number };

export type StreamEvent = ProgressEvent | { type: "result"; rows: QaRow[]; stats: RunStats } | { type: "error"; message: string };

export interface RunInput {
  text: string;
  filename: string;
  variants: number;
  maxChars: number;
  llm: LlmClient;
  emit: (event: ProgressEvent) => void;
  signal?: AbortSignal;
  chunkChars?: number;
  batchSize?: number;
  concurrency?: number;
}

export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function documentContext(filename: string, text: string): string {
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return `${filename} — ${[...firstLine].slice(0, 100).join("")}`;
}

export async function runPipeline(input: RunInput): Promise<{ rows: QaRow[]; stats: RunStats }> {
  const { text, filename, variants, maxChars, llm, emit, signal } = input;
  const concurrency = input.concurrency ?? 3;
  const batchSize = input.batchSize ?? 15;
  const chunks = chunkText(text, input.chunkChars ?? DEFAULT_CHUNK_CHARS);
  const normalizedSource = normalize(text);
  const context = documentContext(filename, text);
  let firstFailure: unknown = null;

  emit({ type: "parsed", chars: [...text].length, chunks: chunks.length });

  // Stage 1: extract grounded units per chunk.
  let chunksDone = 0;
  let unitsFound = 0;
  const extracted = await mapLimit(chunks, concurrency, async (chunk) => {
    try {
      const result = await extractChunk({ llm, context, chunk, normalizedSource, maxChars, signal });
      unitsFound += result.units.length;
      return result;
    } finally {
      chunksDone++;
      emit({ type: "extract", done: chunksDone, total: chunks.length, units: unitsFound });
    }
  });

  const dropped = emptyDrops();
  const units: Unit[] = [];
  const seenAnswers = new Set<string>();
  let failedChunks = 0;
  for (const result of extracted) {
    if (result.status === "rejected") {
      failedChunks++;
      firstFailure ??= result.reason;
      continue;
    }
    dropped.evidence += result.value.dropped.evidence;
    dropped.numbers += result.value.dropped.numbers;
    dropped.length += result.value.dropped.length;
    for (const unit of result.value.units) {
      const key = normalize(unit.answer);
      if (seenAnswers.has(key)) continue;
      seenAnswers.add(key);
      units.push(unit);
    }
  }
  if (chunks.length > 0 && failedChunks === chunks.length) throw new PipelineError(describeLlmError(firstFailure));

  // Stage 2: question variants per batch of answers.
  const numbered = units.map((unit, i) => ({ id: `u${i + 1}`, answer: unit.answer }));
  const batches: (typeof numbered)[] = [];
  for (let i = 0; i < numbered.length; i += batchSize) batches.push(numbered.slice(i, i + batchSize));

  let batchesDone = 0;
  const asked = await mapLimit(batches, concurrency, async (batch) => {
    try {
      return await generateQuestions({ llm, context, units: batch, variants, signal });
    } finally {
      batchesDone++;
      emit({ type: "questions", done: batchesDone, total: batches.length });
    }
  });

  const questionsById = new Map<string, string[]>();
  let failedBatches = 0;
  for (const result of asked) {
    if (result.status === "rejected") {
      failedBatches++;
      firstFailure ??= result.reason;
      continue;
    }
    for (const [id, questions] of result.value) questionsById.set(id, questions);
  }
  if (batches.length > 0 && failedBatches === batches.length) throw new PipelineError(describeLlmError(firstFailure));

  // Fan out: one row per question, answer repeated; drop duplicate questions.
  const rows: QaRow[] = [];
  const seenQuestions = new Set<string>();
  for (const unit of numbered) {
    for (const question of questionsById.get(unit.id) ?? []) {
      const key = normalize(question);
      if (seenQuestions.has(key)) continue;
      seenQuestions.add(key);
      rows.push({ question, text: unit.answer });
    }
  }

  return {
    rows,
    stats: {
      chunks: chunks.length,
      units: numbered.length,
      dropped,
      failedChunks,
      failedBatches,
      failureReason: firstFailure === null ? null : describeLlmError(firstFailure),
      rows: rows.length,
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/run.test.ts && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 5: Checkpoint.**

---

### Task 10: Export (xlsx/csv) and the export route

**Files:**
- Create: `lib/filename.ts`, `lib/export.ts`, `app/api/export/route.ts`
- Test: `tests/export.test.ts`, `tests/api-export.test.ts`

**Interfaces:**
- Consumes: `QaRow` (Task 9).
- Produces:
  - `exportFilename(source: string, format: "xlsx" | "csv"): string` (browser-safe; used by the page)
  - `toCsv(rows: QaRow[]): string`, `toXlsx(rows: QaRow[]): Promise<Buffer>`
  - `POST /api/export?format=xlsx|csv` with a JSON body `{ filename: string; rows: QaRow[] }` → file download

- [ ] **Step 1: Write the failing tests**

`tests/export.test.ts`:

```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { toCsv, toXlsx } from "@/lib/export";
import { exportFilename } from "@/lib/filename";

const rows = [
  { question: "首钢模式是什么？", text: '它是一种模式，"很有名"。\n第二行' },
  { question: "简单", text: "答案" },
];

describe("toCsv", () => {
  it("writes a BOM, the header, and RFC 4180 quoting", () => {
    expect(toCsv(rows)).toBe('\uFEFFquestion,text\r\n首钢模式是什么？,"它是一种模式，""很有名""。\n第二行"\r\n简单,答案\r\n');
  });
});

describe("toXlsx", () => {
  it("writes one sheet named qa with header question,text", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await toXlsx(rows));

    const values: unknown[][] = [];
    workbook.getWorksheet("qa")!.eachRow((row) => values.push((row.values as unknown[]).slice(1)));

    expect(workbook.worksheets).toHaveLength(1);
    expect(values).toEqual([["question", "text"], [rows[0].question, rows[0].text], ["简单", "答案"]]);
  });
});

describe("exportFilename", () => {
  it.each([
    ["01-input.docx", "xlsx", "qa-01-input.xlsx"],
    ["展厅串讲词.txt", "csv", "qa-展厅串讲词.csv"],
    ["a/b:c.txt", "csv", "qa-a_b_c.csv"],
    ["", "csv", "qa-document.csv"],
  ] as const)("%s → %s", (source, format, expected) => {
    expect(exportFilename(source, format)).toBe(expected);
  });
});
```

`tests/api-export.test.ts`:

```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/export/route";

const rows = [{ question: "问？", text: "答。" }];

function post(format: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/export?format=${format}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/export", () => {
  it("returns csv as a download", async () => {
    const res = await post("csv", { filename: "展厅.docx", rows });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent("qa-展厅.csv")}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("returns xlsx as a download", async () => {
    const res = await post("xlsx", { filename: "展厅.docx", rows });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    expect(workbook.getWorksheet("qa")!.getRow(2).values).toEqual([undefined, "问？", "答。"]);
  });

  it("rejects an unknown format", async () => {
    expect((await post("pdf", { filename: "a", rows })).status).toBe(400);
  });

  it("rejects a malformed body", async () => {
    expect((await post("csv", { filename: "a", rows: "nope" })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/export.test.ts tests/api-export.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`lib/filename.ts`:

```ts
export function exportFilename(source: string, format: "xlsx" | "csv"): string {
  const base = source.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "document";
  return `qa-${base}.${format}`;
}
```

`lib/export.ts`:

```ts
import ExcelJS from "exceljs";
import type { QaRow } from "./pipeline/run";

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** UTF-8 with BOM so Excel shows Chinese correctly. */
export function toCsv(rows: QaRow[]): string {
  const lines = [["question", "text"], ...rows.map((r) => [r.question, r.text])].map((cells) => cells.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function toXlsx(rows: QaRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("qa");
  sheet.columns = [
    { header: "question", key: "question", width: 48 },
    { header: "text", key: "text", width: 80 },
  ];
  for (const row of rows) sheet.addRow(row);
  sheet.getColumn("text").alignment = { wrapText: true, vertical: "top" };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
```

`app/api/export/route.ts`:

```ts
import { z } from "zod";
import { toCsv, toXlsx } from "@/lib/export";
import { exportFilename } from "@/lib/filename";

const BodySchema = z.object({
  filename: z.string().max(255),
  rows: z.array(z.object({ question: z.string(), text: z.string() })).max(50_000),
});

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function POST(req: Request): Promise<Response> {
  const format = new URL(req.url).searchParams.get("format");
  if (format !== "xlsx" && format !== "csv") {
    return Response.json({ detail: "format must be xlsx or csv" }, { status: 400 });
  }
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ detail: "Invalid export request" }, { status: 400 });
  }

  const disposition = contentDisposition(exportFilename(body.data.filename, format));
  if (format === "csv") {
    return new Response(toCsv(body.data.rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition },
    });
  }
  const xlsx = await toXlsx(body.data.rows);
  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition,
    },
  });
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/export.test.ts tests/api-export.test.ts && npx tsc --noEmit`
Expected: all PASS. If `tsc` rejects `workbook.xlsx.load(...)`'s argument type in the tests, pass `await toXlsx(rows) as unknown as ExcelJS.Buffer`.

- [ ] **Step 5: Checkpoint.**

---

### Task 11: The generate route (validation + NDJSON stream)

**Files:**
- Create: `app/api/generate/route.ts`
- Test: `tests/api-generate.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `ConfigError` (Task 2); `extractText`, `InputError`, `MAX_UPLOAD_BYTES` (Task 3); `createLlm` (Task 6); `runPipeline`, `StreamEvent` (Task 9); `describeLlmError` (Task 6).
- Produces: `POST /api/generate` taking multipart `file` + `variants`.
  - 400 `{detail}` for bad input; 500 `{detail}` for bad server config.
  - Otherwise 200 `application/x-ndjson`: progress events, then a final `result` or `error` event.

- [ ] **Step 1: Write the failing test** — `tests/api-generate.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate/route";
import { createLlm } from "@/lib/llm";
import type { StreamEvent } from "@/lib/pipeline/run";
import { fakeLlm } from "./helpers/fake-llm";

vi.mock("@/lib/llm", () => ({ createLlm: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANSWER_MAX_CHARS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(createLlm).mockReset();
});

const txt = (content: string, name = "doc.txt") => new File([content], name, { type: "text/plain" });

function upload(file: File | null, variants = "2") {
  const form = new FormData();
  if (file) form.set("file", file);
  form.set("variants", variants);
  return POST(new Request("http://localhost/api/generate", { method: "POST", body: form }));
}

async function events(res: Response): Promise<StreamEvent[]> {
  return (await res.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as StreamEvent);
}

describe("POST /api/generate", () => {
  it("rejects a request without a file", async () => {
    const res = await upload(null);
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/No file/);
  });

  it("rejects unsupported file types", async () => {
    const res = await upload(txt("内容。", "doc.pdf"));
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/\.docx and \.txt/);
  });

  it("rejects an invalid questions-per-answer value", async () => {
    const res = await upload(txt("内容。"), "9");
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/1 to 6/);
  });

  it("rejects an empty document", async () => {
    const res = await upload(txt("   "));
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/no text/);
  });

  it("reports a missing API key as a server configuration error", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await upload(txt("内容。"));
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("streams progress and the final rows", async () => {
    const unit = { answer: "第一阶段始于1959年。", evidence: ["第一阶段始于1959年"] };
    vi.mocked(createLlm).mockReturnValue(fakeLlm({ extract: () => ({ units: [unit] }) }));

    const res = await upload(txt("第一阶段始于1959年，重点是高血压和冠心病。"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const all = await events(res);
    expect(all.map((e) => e.type)).toEqual(["parsed", "extract", "questions", "result"]);
    const result = all.at(-1);
    expect(result).toMatchObject({
      type: "result",
      rows: [
        { question: "第一阶段始于1959年。是什么？", text: unit.answer },
        { question: "请问第一阶段始于1959年。？", text: unit.answer },
      ],
    });
  });

  it("streams an error event when generation fails", async () => {
    vi.mocked(createLlm).mockReturnValue(
      fakeLlm({ extract: () => { throw Object.assign(new Error("401"), { status: 401 }); } }),
    );
    const all = await events(await upload(txt("内容。")));
    expect(all.at(-1)).toEqual({ type: "error", message: expect.stringMatching(/API key/) });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/api-generate.test.ts`
Expected: FAIL (route module not found).

- [ ] **Step 3: Implement** — `app/api/generate/route.ts`

```ts
import { ConfigError, loadConfig, type AppConfig } from "@/lib/config";
import { createLlm } from "@/lib/llm";
import { describeLlmError } from "@/lib/llm/errors";
import { extractText, InputError, MAX_UPLOAD_BYTES } from "@/lib/parse";
import { runPipeline, type StreamEvent } from "@/lib/pipeline/run";

function fail(detail: string, status = 400): Response {
  return Response.json({ detail }, { status });
}

export async function POST(req: Request): Promise<Response> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) return fail(`Server configuration error: ${err.message}`, 500);
    throw err;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Expected a multipart form upload");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("No file uploaded");
  if (file.size > MAX_UPLOAD_BYTES) return fail("The file is larger than 10 MB");

  const variants = Number(form.get("variants") ?? 3);
  if (!Number.isInteger(variants) || variants < 1 || variants > 6) {
    return fail("Questions per answer must be a whole number from 1 to 6");
  }

  let text: string;
  try {
    text = await extractText(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }

  const llm = createLlm(config);
  // Stop LLM spending when the browser goes away (request aborted or stream cancelled).
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        const { rows, stats } = await runPipeline({
          text,
          filename: file.name,
          variants,
          maxChars: config.answerMaxChars,
          llm,
          emit: send,
          signal: abort.signal,
        });
        send({ type: "result", rows, stats });
      } catch (err) {
        if (!abort.signal.aborted) send({ type: "error", message: describeLlmError(err) });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by a cancelled client
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run && npx tsc --noEmit`
Expected: the whole suite PASSES.

- [ ] **Step 5: Checkpoint.**

---

### Task 12: The page (upload, progress, preview, download)

**Files:**
- Create: `lib/ndjson.ts`
- Modify: `app/page.tsx` (replace the placeholder)
- Test: `tests/ndjson.test.ts`

**Interfaces:**
- Consumes: `exportFilename` (Task 10); types `QaRow`, `RunStats`, `ProgressEvent`, `StreamEvent` (Task 9); routes from Tasks 10–11.
- Produces: `splitLines(buffer: string): { lines: string[]; rest: string }`; the UI.

- [ ] **Step 1: Write the failing test** — `tests/ndjson.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { splitLines } from "@/lib/ndjson";

describe("splitLines", () => {
  it.each([
    ["a\nb\nc", ["a", "b"], "c"],
    ["a\n", ["a"], ""],
    ["", [], ""],
    ["a\n\n  \nb\n", ["a", "b"], ""],
  ])("%j", (buffer, lines, rest) => {
    expect(splitLines(buffer)).toEqual({ lines, rest });
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement** — `lib/ndjson.ts`

Run: `npx vitest run tests/ndjson.test.ts` → FAIL (module not found).

```ts
/** Split complete lines off a streaming buffer; `rest` is the unfinished tail. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((line) => line.trim()).filter(Boolean), rest };
}
```

Run: `npx vitest run tests/ndjson.test.ts` → PASS.

- [ ] **Step 3: Write the page** — `app/page.tsx`

```tsx
"use client";

import { useRef, useState } from "react";
import { exportFilename } from "@/lib/filename";
import { splitLines } from "@/lib/ndjson";
import type { ProgressEvent, QaRow, RunStats, StreamEvent } from "@/lib/pipeline/run";

type Phase = "idle" | "running" | "done" | "error";

interface Progress {
  label: string;
  fraction: number;
}

function progressFrom(event: ProgressEvent): Progress {
  switch (event.type) {
    case "parsed":
      return { label: `Read ${event.chars.toLocaleString()} characters in ${event.chunks} section(s). Extracting facts…`, fraction: 0.02 };
    case "extract":
      return {
        label: `Extracting facts: section ${event.done} of ${event.total} (${event.units} answers so far)`,
        fraction: 0.02 + 0.68 * (event.done / event.total),
      };
    case "questions":
      return { label: `Writing questions: batch ${event.done} of ${event.total}`, fraction: 0.7 + 0.3 * (event.done / event.total) };
  }
}

async function errorDetail(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { detail?: string } | null;
  return data?.detail ?? `${fallback} (HTTP ${res.status})`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [variants, setVariants] = useState(3);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<Progress>({ label: "", fraction: 0 });
  const [rows, setRows] = useState<QaRow[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<"xlsx" | "csv" | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function generate() {
    if (!file) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase("running");
    setError("");
    setRows([]);
    setStats(null);
    setSourceName(file.name);
    setProgress({ label: "Uploading and reading the document…", fraction: 0 });

    try {
      const form = new FormData();
      form.set("file", file);
      form.set("variants", String(variants));
      const res = await fetch("/api/generate", { method: "POST", body: form, signal: abort.signal });
      if (!res.ok || !res.body) throw new Error(await errorDetail(res, "Request failed"));

      let finished = false;
      const handle = (line: string) => {
        const event = JSON.parse(line) as StreamEvent;
        if (event.type === "result") {
          setRows(event.rows);
          setStats(event.stats);
          setPhase("done");
          finished = true;
        } else if (event.type === "error") {
          throw new Error(event.message);
        } else {
          setProgress(progressFrom(event));
        }
      };

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const { lines, rest } = splitLines(buffer + value);
        buffer = rest;
        lines.forEach(handle);
      }
      if (buffer.trim()) handle(buffer.trim());
      if (!finished) throw new Error("The connection closed before generation finished.");
    } catch (err) {
      if (abort.signal.aborted) {
        setPhase("idle");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }

  async function download(format: "xlsx" | "csv") {
    setDownloading(format);
    try {
      const res = await fetch(`/api/export?format=${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: sourceName, rows }),
      });
      if (!res.ok) throw new Error(await errorDetail(res, "Export failed"));
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(sourceName, format);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(null);
    }
  }

  const running = phase === "running";
  const droppedTotal = stats ? stats.dropped.evidence + stats.dropped.numbers + stats.dropped.length : 0;
  const partial = stats !== null && (stats.failedChunks > 0 || stats.failedBatches > 0);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Q&amp;A Generator</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Upload a .docx or .txt document to generate a question / answer table for an EvoIndexer retriever. Answers come
          only from the document.
        </p>

        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-end gap-6">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Document</span>
              <input
                type="file"
                accept=".docx,.txt"
                disabled={running}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-zinc-800"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Questions per answer: {variants}</span>
              <input
                type="range"
                min={1}
                max={6}
                value={variants}
                disabled={running}
                onChange={(e) => setVariants(Number(e.target.value))}
                className="w-48"
              />
            </label>

            {running ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={generate}
                disabled={!file}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Generate
              </button>
            )}
          </div>

          {running && (
            <div className="mt-5">
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="h-full bg-zinc-900 transition-all dark:bg-zinc-100" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
              </div>
              <p className="mt-2 text-sm text-zinc-500">{progress.label}</p>
            </div>
          )}

          {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
        </section>

        {phase === "done" && stats && (
          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm">
                <p>
                  <span className="font-medium">{stats.units}</span> answers · <span className="font-medium">{stats.rows}</span> rows
                </p>
                {droppedTotal > 0 && (
                  <p className="text-zinc-500">
                    Discarded {droppedTotal}: {stats.dropped.evidence} quote not found in document · {stats.dropped.numbers} number not
                    in source · {stats.dropped.length} too long
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {(["xlsx", "csv"] as const).map((format) => (
                  <button
                    key={format}
                    onClick={() => download(format)}
                    disabled={rows.length === 0 || downloading !== null}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    {downloading === format ? "Preparing…" : `Download .${format}`}
                  </button>
                ))}
              </div>
            </div>

            {partial && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {stats.failedChunks} section(s) and {stats.failedBatches} question batch(es) failed: {stats.failureReason}. The results
                below are partial.
              </p>
            )}

            {rows.length === 0 ? (
              <p className="mt-6 text-sm text-zinc-500">No question / answer pairs were generated from this document.</p>
            ) : (
              <div className="mt-4 max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">question</th>
                      <th className="px-3 py-2 font-medium">text</th>
                      <th className="px-3 py-2 font-medium">chars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                        <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                        <td className="px-3 py-2">{row.question}</td>
                        <td className="px-3 py-2">{row.text}</td>
                        <td className="px-3 py-2 text-zinc-400">{[...row.text].length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green.

Smoke check the UI without an LLM key: run `npm run dev`, open `http://localhost:3001`, upload `materials/01-input.docx`, click Generate. Expected: a red "Server configuration error: ANTHROPIC_API_KEY is not set" message (there's no `.env` yet). The page loads without console errors.

- [ ] **Step 5: Checkpoint.**

---

### Task 13: Hosting — native (PM2 + nginx) and Docker

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `ecosystem.config.js`, `qa-generator.nginx.conf`
- Modify: `../docker-compose.yml`, `../nginx/nginx.conf`, `../README.md`

**Interfaces:**
- Consumes: the built app from Tasks 1–12.
- Produces: native deployment files and Docker service `qa-generator` behind nginx on port 8082.

- [ ] **Step 1: Create the native deployment files**

`ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: "evoindexer-qa-generator",
      script: "node_modules/.bin/next",
      args: "start -p 3001",
      cwd: "/opt/question-answer-generator",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      merge_logs: true,
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
  ],
};
```

`qa-generator.nginx.conf`:

```nginx
server {
    listen 8082;
    server_name evovor.adaptivemake.com;  # or the EC2 public IP

    # Document uploads (the app itself rejects files over 10 MB)
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;

        # Progress is streamed while the LLM works; don't hold it back
        proxy_buffering off;

        # Generation of a long document can take several minutes
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

- [ ] **Step 2: Create the Docker files**

`Dockerfile` (same three-stage build as `../frontend/Dockerfile`):

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

`.dockerignore`:

```gitignore
node_modules
.next
.env*
!.env.example
ecosystem.config.js
qa-generator.nginx.conf
*.md
docs
materials
tests
vitest.config.ts
```

- [ ] **Step 3: Wire into the root compose and nginx**

`../docker-compose.yml` — in the `nginx` service, add the port and the dependency:

```yaml
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "8082:8082"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - frontend
      - qa-generator
    restart: unless-stopped
    networks:
      - app-network
```

Add a new service after `frontend`:

```yaml
  qa-generator:
    build:
      context: ./question-answer-generator
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
    # The app's own .env (same file as native hosting); keeps its keys apart from xinren-rag's
    env_file:
      - path: ./question-answer-generator/.env
        required: false
    restart: unless-stopped
    networks:
      - app-network
```

`../nginx/nginx.conf` — append:

```nginx
upstream qa_generator {
    server qa-generator:3000;
}

server {
    listen 8082;
    server_name _;

    # Document uploads (the app itself rejects files over 10 MB)
    client_max_body_size 10M;

    location / {
        proxy_pass         http://qa_generator;
        proxy_http_version 1.1;

        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Progress is streamed while the LLM works; don't hold it back
        proxy_buffering off;

        # Generation of a long document can take several minutes
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

- [ ] **Step 4: Update `../README.md`**

1. In "Prepare hosting server", change the port line to: `- Allow port 22 (ssh), 80 (web for FastAPI), 8081 (web for Next.js), 8082 (web for the Q&A generator)`.
2. In "Build app", change the copy line to: `- Copy the \`frontend\`, \`xinren-rag\` and \`question-answer-generator\` directories into \`/opt\` directory of the server`.
3. After the "Setup PM2 for the frontend" section, add:

```markdown
### Build question-answer-generator app
- Run `cd question-answer-generator`
- Copy `.env.example` to `.env` and fill in the LLM settings: `LLM_PROVIDER` (`anthropic` or `openai`), the API key and model for that provider, and optionally `ANSWER_MAX_CHARS` (default 100)
- Run `npm install` to install all dependencies
- Run `npm run build` to build the app
- Run `pm2 start ecosystem.config.js` to start it on port 3001, then run `pm2 save`
- Run `pm2 list` to ensure `evoindexer-qa-generator` is up and running
- After changing `.env`, run `pm2 restart evoindexer-qa-generator`
```

4. In "Setup Nginx", after the xinren-rag bullet, add: `- Go to \`question-answer-generator\` directory and copy \`qa-generator.nginx.conf\` to \`/etc/nginx/sites-available\`, ensure the \`server_name\` in the config file is correct`. Then change "Create 2 symbolic links pointing the 2 conf file" to "Create 3 symbolic links pointing the 3 conf files".
5. Append:

```markdown
## Run with Docker
- Create `question-answer-generator/.env` from `question-answer-generator/.env.example` and fill in the LLM settings
- Run `docker compose up -d --build`
- The retriever dashboard is served on port 80 and the Q&A generator on port 8082
```

- [ ] **Step 5: Verify**

Run from the evoindexer root:

```bash
docker compose config -q && echo compose-ok
MSYS_NO_PATHCONV=1 docker run --rm --add-host frontend:127.0.0.1 --add-host qa-generator:127.0.0.1 \
  -v "$(pwd -W)/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W)/question-answer-generator/qa-generator.nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
docker compose build qa-generator
```

Expected: `compose-ok`; both `nginx -t` runs report "syntax is ok" and "test is successful"; the image builds.

Then smoke-run the image on its own (the full stack would also build xinren-rag):

```bash
docker run --rm -d --name qa-smoke -p 3099:3000 evoindexer-qa-generator
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3099/
docker rm -f qa-smoke
```

Expected: `200`. The image name comes from compose (`<project>-qa-generator`); check `docker images | grep qa-generator` if it differs.

- [ ] **Step 6: Checkpoint.**

---

### Task 14: End-to-end run with a real LLM and acceptance checks

**Files:** none (verification only; outputs go to the session scratchpad).

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Get a real API key into `.env`** — ask the user to create `question-answer-generator/.env` from `.env.example` and fill in their key. Never paste keys into chat. Confirm before spending tokens.

- [ ] **Step 2: Run the production build locally**

```bash
npm run build && npm start   # background; serves http://localhost:3001
```

- [ ] **Step 3: Generate from the sample document**

```bash
curl -sN -F "file=@materials/01-input.docx" -F "variants=3" http://localhost:3001/api/generate > "$SCRATCH/run-01.ndjson"
```

- [ ] **Step 4: Check the result against the acceptance criteria**

Save as `$SCRATCH/check-run.mjs`:

```js
// Usage: node check-run.mjs <run.ndjson> <maxChars> <variants>
import { readFileSync } from "node:fs";

const [file, maxChars = "100", variants = "3"] = process.argv.slice(2);
const events = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const last = events.at(-1);
if (last.type !== "result") {
  console.error("Run failed:", last);
  process.exit(1);
}

const { rows, stats } = last;
const questionsPerAnswer = new Map();
for (const row of rows) questionsPerAnswer.set(row.text, (questionsPerAnswer.get(row.text) ?? 0) + 1);
const longest = Math.max(...[...questionsPerAnswer.keys()].map((a) => [...a].length));
const complete = [...questionsPerAnswer.values()].filter((n) => n === Number(variants)).length;
const sections = ["历史沿革", "科学论据", "健康生活", "宣传教育", "未来展望", "协作网络"];
const missing = sections.filter((s) => !rows.some((r) => r.text.includes(s) || r.question.includes(s)));

console.log("stats:", JSON.stringify(stats));
console.log(`answers: ${questionsPerAnswer.size}, rows: ${rows.length}`);
console.log(`longest answer: ${longest} chars (limit ${maxChars}) -> ${longest <= Number(maxChars) ? "OK" : "FAIL"}`);
console.log(`answers with ${variants} questions: ${complete}/${questionsPerAnswer.size}`);
console.log(`sections missing: ${missing.length ? missing.join(", ") : "none"}`);
console.log("\n--- 20 random rows for grounding review ---\n");
for (const row of [...rows].sort(() => Math.random() - 0.5).slice(0, 20)) console.log(`Q: ${row.question}\nA: ${row.text}\n`);
```

Run: `node "$SCRATCH/check-run.mjs" "$SCRATCH/run-01.ndjson" 100 3`
Expected: `longest answer … OK`; most answers have 3 questions; `sections missing: none` (criteria 2, 4, 5). Then review the 20 rows against the docx by hand and note any answer with information that isn't in the source (criterion 3).

- [ ] **Step 5: Export and verify the xlsx**

```bash
node -e "const fs=require('fs');const r=fs.readFileSync(process.argv[1],'utf8').trim().split('\n').map(JSON.parse).at(-1);fs.writeFileSync(process.argv[2],JSON.stringify({filename:'01-input.docx',rows:r.rows}))" "$SCRATCH/run-01.ndjson" "$SCRATCH/rows.json"
curl -s -X POST -H "Content-Type: application/json" --data-binary "@$SCRATCH/rows.json" "http://localhost:3001/api/export?format=xlsx" -o "$SCRATCH/qa-01-input.xlsx"
node -e "const E=require('exceljs');const w=new E.Workbook();w.xlsx.readFile(process.argv[1]).then(()=>{const s=w.getWorksheet('qa');console.log(s.getRow(1).values.slice(1),'rows:',s.rowCount-1)})" "$SCRATCH/qa-01-input.xlsx"
```

Expected: `[ 'question', 'text' ]` and the same row count as the run. If Python is available, also check what xinren-rag does (criterion 6):

```bash
python -m venv "$SCRATCH/venv" && "$SCRATCH/venv/Scripts/pip" install -q pandas openpyxl
"$SCRATCH/venv/Scripts/python" -c "import pandas as pd,sys;df=pd.read_excel(sys.argv[1]);print(list(df.columns),len(df))" "$SCRATCH/qa-01-input.xlsx"
```

Expected: `['question', 'text']` and the row count.

- [ ] **Step 6: GBK text file** (criterion 7; UTF-8 decoding uses the same code path and is covered by unit tests)

```bash
node -e "require('mammoth').extractRawText({path:'materials/01-input.docx'}).then(r=>require('fs').writeFileSync(process.argv[1],r.value))" "$SCRATCH/01-utf8.txt"
python -c "import sys;open(sys.argv[2],'wb').write(open(sys.argv[1],encoding='utf-8').read().encode('gb18030'))" "$SCRATCH/01-utf8.txt" "$SCRATCH/01-gbk.txt"
curl -sN -F "file=@$SCRATCH/01-gbk.txt" -F "variants=1" http://localhost:3001/api/generate > "$SCRATCH/run-gbk.ndjson"
node "$SCRATCH/check-run.mjs" "$SCRATCH/run-gbk.ndjson" 100 1
```

Expected: a `result` event whose answers are readable Chinese (no mojibake).

- [ ] **Step 7: Browser check** — open `http://localhost:3001` and run one generation through the UI. Confirm the progress bar moves, the preview table and discard counts show, and both downloads work. Take a screenshot.

- [ ] **Step 8: Report** — the stats, max answer length, coverage findings, spot-check results, and anything not verified (e.g. the OpenAI provider if there's no key, the full `docker compose up` stack).
