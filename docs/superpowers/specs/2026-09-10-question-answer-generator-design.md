# Question-Answer Generator — Design

Date: 2026-09-10
Status: approved in chat, pending written-spec review
Requirements: [../../requirements.md](../../requirements.md)

## Purpose

A small Next.js website that takes a `.docx` or `.txt` document and generates a
question/answer table (`.xlsx` or `.csv`) for the xinren-rag app. An LLM
(Claude or OpenAI) finds the facts in the document and writes many likely
questions for each one. Answers must come **only** from the document. Each answer
gets several differently-worded questions, so retrieval covers the many ways
people might ask the same thing.

The answers will be **spoken aloud by a digital human**, so they must be short
and conversational.

## Decisions

| Topic | Decision |
| --- | --- |
| Stack | Next.js 16 (App Router, `output: "standalone"`), React 19, Tailwind 4, TypeScript — same as `../frontend` |
| LLM providers | Both. Choose with `LLM_PROVIDER=anthropic\|openai` in `.env` (default `anthropic`) |
| Output columns | `question`, `text` — one question phrasing per row, answer repeated. Loads directly into a `CachedSheet2Chroma` retriever with `key_field: question`, `meta_field: text` |
| Pipeline | Two stages: extract grounded facts → write N question variants per fact |
| User controls | Upload a file, plus a "questions per answer" slider (1–6, default 3). Nothing else |
| Answer length | At most `ANSWER_MAX_CHARS` characters (`.env`, default 100) |
| Limits | Upload ≤ 10 MB; extracted document text ≤ 200,000 characters (larger documents are rejected, never truncated) |
| Persistence | None. One request streams progress and returns the result; closing the tab ends the run |
| Auth | None (same as `frontend`) |
| Hosting | Native: PM2 on :3001 behind nginx :8082. Docker: new compose service behind the shared nginx on :8082 |

## Architecture

```text
question-answer-generator/
  app/layout.tsx, app/globals.css
  app/page.tsx                client UI: upload, slider, progress, preview, download
  app/api/generate/route.ts   POST multipart {file, variants} → NDJSON event stream
  app/api/export/route.ts     POST {rows, filename}?format=xlsx|csv → file download
  lib/config.ts               reads and validates env on each request
  lib/parse.ts                docx → mammoth.extractRawText; txt → UTF-8, fallback GB18030
  lib/chunk.ts                split on paragraph boundaries, ~6,000 chars per chunk
  lib/llm/types.ts            LlmClient interface
  lib/llm/anthropic.ts        Anthropic implementation
  lib/llm/openai.ts           OpenAI implementation
  lib/llm/index.ts            picks the implementation from LLM_PROVIDER
  lib/pipeline/prompts.ts     system/user prompt builders for both stages and the repair call
  lib/pipeline/schemas.ts     zod schemas for LLM outputs
  lib/pipeline/ground.ts      normalization, evidence check, number check, length check
  lib/pipeline/extract.ts     stage 1 (+ length repair)
  lib/pipeline/questions.ts   stage 2
  lib/pipeline/run.ts         orchestration, concurrency (3), events, dedupe, fan-out
  lib/export.ts               rows → CSV (UTF-8 BOM) / XLSX (exceljs); used by the export route
  tests/…                     vitest
  Dockerfile, .dockerignore, ecosystem.config.js, qa-generator.nginx.conf, .env.example
```

Each unit has one job. The pipeline only depends on the `LlmClient` interface,
so tests can run it with a fake client.

### LlmClient

```ts
interface LlmClient {
  generateJson<T>(req: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    signal?: AbortSignal;
  }): Promise<T>;
}
```

- **Anthropic** (`@anthropic-ai/sdk`)
  - Uses `messages.parse` with `output_config.format: zodOutputFormat(schema)`.
  - Model: `ANTHROPIC_MODEL`, default `claude-opus-5`, with adaptive thinking (Opus 5's default).
  - Refusal fallback: `fallbacks: "default"` + beta `server-side-fallback-2026-07-01`.
  - Checks `stop_reason === "refusal"` before reading the output, and throws a clear error if the request was refused.
- **OpenAI** (`openai` SDK)
  - Uses structured outputs with the same zod schema.
  - `OPENAI_BASE_URL` is optional (OpenRouter works). `OPENAI_MODEL` is required when `LLM_PROVIDER=openai`.
- **Both:** the SDKs retry network errors, 429s and 5xx up to 2 times. If output fails schema validation, that one call is retried once.

## Data flow

1. **Validate the upload.** The browser POSTs `multipart/form-data` (`file`, `variants`). The route checks the extension (`.docx`/`.txt`), size ≤ 10 MB, `variants` in 1–6, and the env config. Bad input → **HTTP 400 JSON** `{detail}`; bad server config → **HTTP 500 JSON** `{detail}`; both before streaming starts.
2. **Parse and check size.** Parse to plain text. Empty text → 400. Text > 200,000 chars → 400 with the actual size.
3. **Chunk.** Split on paragraph boundaries into ~6,000-character chunks. A single paragraph longer than that is split at sentence ends (`。！？.!?`).
4. **Stream events.** From here the route returns `Content-Type: application/x-ndjson` and emits one JSON event per line:
   - `{type:"parsed", chars, chunks}`
   - `{type:"extract", done, total, units}` — after each chunk
   - `{type:"questions", done, total}` — after each question batch
   - `{type:"result", rows:[{question,text}], stats}`
   - `{type:"error", message}`
5. **Stage 1: extract** (per chunk, up to 3 in parallel). Input: document context (filename + first non-empty line) + the chunk. Output: `{units:[{answer, evidence: string[1..3]}]}`.
6. **Grounding checks** on every unit:
   - **Evidence check:** every evidence quote, normalized, must be a substring of the normalized full source. Normalization: NFKC, remove all whitespace and zero-width characters (U+200B to U+200D, U+FEFF).
   - **Number check:** every run of Arabic digits in the answer must appear in the normalized evidence.
   - **Length check:** `[...answer].length ≤ ANSWER_MAX_CHARS`.
   - Units failing the evidence or number check are dropped and counted.
   - Over-length units from a chunk get **one** repair call ("split or shorten to ≤ N using only this evidence"). The repaired units go through all checks again; any still failing are dropped.
7. **Stage 2: question variants** (batches of 15 units, up to 3 in parallel). Input: `[{id, answer}]` + N. Output: `{items:[{id, questions: string[]}]}`. Questions are trimmed; more than N per unit is cut to N, fewer is accepted.
8. **Fan out and dedupe.** Each question becomes a row `{question, text: answer}`. Exact duplicate questions (after normalization) are removed; the first one wins.
9. **Show and download.** The browser shows stats and a preview table. The download buttons POST the rows to `/api/export?format=xlsx|csv`, which returns `qa-<source-name>.xlsx` (sheet `qa`, header `question`, `text`) or `.csv` (UTF-8 BOM, RFC 4180 quoting). Export runs on the server because exceljs is proven in Node and awkward to bundle for the browser.

## Prompt rules

**Stage 1 — extract:**

- Use only what the text says. No outside knowledge, no inference.
- Each answer must stand alone (resolve "我们/这个展厅" to the full name).
- Written for speech: natural full sentences, ≤ N characters, no lists, markdown, bracketed notes or URLs.
- Split long facts into several units.
- Skip presenter-only stage directions.
- Write numbers, dates and quantities exactly as the source writes them (no "七十年代" → "70年代"); the number check depends on this.
- `evidence` = verbatim contiguous quotes from the chunk.
- Write in the document's language.

**Stage 2 — questions:**

- Write N questions per answer, each from a different angle: direct, casual visitor, keyword-style, why/how, when/who/how-many.
- Each question must be fully answered by its answer.
- Each question names its subject (no bare "它").
- Write in the document's language.

**Repair:**

- Rewrite into one or more units ≤ N characters, using only the given evidence.
- Return the same unit shape.

## Error handling

- **Bad input or config:** 400 JSON before streaming; the UI shows `detail`.
- **One chunk or batch fails after retries:** the run continues. `stats.failedChunks` / `stats.failedBatches` count the failures, and the UI shows a warning with partial results.
- **Everything fails:** an `error` event is sent and there is no result.
- **Client disconnects:** the request's `AbortSignal` is passed to every LLM call, so a cancelled run stops spending tokens.
- **Stats:** `{chunks, units, dropped:{evidence, numbers, length}, failedChunks, failedBatches, rows}`, shown in the UI.

## Configuration (`question-answer-generator/.env`, documented in `.env.example`)

| Variable | Default | Notes |
| --- | --- | --- |
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | — | required for anthropic |
| `ANTHROPIC_MODEL` | `claude-opus-5` | |
| `OPENAI_API_KEY` | — | required for openai |
| `OPENAI_BASE_URL` | SDK default | optional, e.g. OpenRouter |
| `OPENAI_MODEL` | — | required for openai |
| `ANSWER_MAX_CHARS` | `100` | integer ≥ 20 |

Env is read at request time (POST route handlers are always dynamic in Next.js). Changing a value only needs a restart, not a rebuild.

## Hosting

**Native** (files in `question-answer-generator/`):

- `ecosystem.config.js` — PM2 app `evoindexer-qa-generator`, `next start` on port 3001, cwd `/opt/question-answer-generator`.
- `qa-generator.nginx.conf`:
  - `listen 8082`, `server_name evovor.adaptivemake.com`, proxy to `127.0.0.1:3001`
  - `client_max_body_size 10M`
  - `proxy_buffering off` (needed for the progress stream)
  - 600 s read/send timeouts

**Docker:**

- `question-answer-generator/Dockerfile` — same three-stage `node:22-alpine` standalone build as frontend, port 3000.
- `question-answer-generator/.dockerignore` — excludes `.env*`, `node_modules`, `.next`, tests, docs.
- Root `docker-compose.yml`:
  - new `qa-generator` service with `env_file: ./question-answer-generator/.env` (`required: false`)
  - nginx publishes `"8082:8082"` and adds `depends_on: qa-generator`
- `nginx/nginx.conf` — `upstream qa_generator { server qa-generator:3000; }` plus a `server { listen 8082; }` block with the same buffering, timeout and upload settings.

**Root `README.md`:**

- New section on building and running the app with PM2 and nginx.
- Port 8082 added to the server-prep list.

`frontend/` and `xinren-rag/` are not modified.

## Testing

vitest, all offline:

- `parse`:
  - `materials/01-input.docx` contains phrases from normal and tracked-insertion paragraphs ("首钢模式", "五进、六进", "4.9万条视频").
  - A UTF-8 txt and a GB18030 txt both decode correctly.
- `chunk`: paragraph boundaries respected; chunk size bounded; an over-long paragraph is split at sentence ends; no text lost (concatenation equals input minus separators).
- `ground`: NFKC/whitespace/zero-width normalization; evidence found/not found; number check pass/fail; code-point length.
- `run` with a fake `LlmClient`:
  - events are emitted in order
  - units with bad evidence or numbers are dropped
  - the repair path runs once; dropped if still over-long
  - questions are fanned out, capped at N, and deduped
  - a failing chunk is counted and does not abort the run
- `export`:
  - CSV has a BOM and quotes commas, quotes and newlines
  - reading the XLSX back with exceljs gives header `question,text` and the same rows
- `config`: defaults; missing key / missing `OPENAI_MODEL` → clear error; bad `ANSWER_MAX_CHARS` rejected.

**Manual checks** (the first one needs the user's API key and costs a little):

- One real run on `01-input.docx` via the UI, spot-checked against `01-output.xlsx` for coverage, grounding and answer length.
- `npm run build` and `docker compose build qa-generator` both succeed.

## Out of scope

Login, job persistence and history, editing rows in the browser, category column,
PDF input, per-run provider choice in the UI.
