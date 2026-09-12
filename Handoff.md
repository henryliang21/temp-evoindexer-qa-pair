# Handoff — Question-Answer Generator

Last updated: 2026-09-10

## What this is

A Next.js website that takes a `.docx`/`.txt` document and generates a `question`/`text` Q&A table (`.xlsx`/`.csv`) for the xinren-rag app. It uses Claude or OpenAI. Answers come only from the document, are at most `ANSWER_MAX_CHARS` (default 100) characters because a digital human speaks them, and each answer gets N differently-worded questions.

Read these first:

| Doc | Purpose |
| --- | --- |
| `docs/requirements.md` | What to build and the acceptance criteria (the user's original request is in the appendix) |
| `docs/superpowers/specs/2026-09-10-question-answer-generator-design.md` | Design: pipeline, grounding checks, events, hosting |
| `docs/superpowers/plans/2026-09-10-question-answer-generator.md` | 14-task implementation plan with full code; Tasks 13–14 contain the remaining verification commands |

## Status

| Task | State |
| --- | --- |
| 1. Scaffold (Next 16.3.4, React 19.3, Tailwind 4, vitest 5) | ✅ Done |
| 2. `lib/config.ts` — env config | ✅ Done |
| 3. `lib/parse.ts` — docx (mammoth) / txt (UTF-8 → GB18030) | ✅ Done |
| 4. `lib/chunk.ts` — paragraph/sentence chunking | ✅ Done |
| 5. `lib/pipeline/ground.ts` — evidence, number and length checks | ✅ Done |
| 6. `lib/llm/*` — Anthropic + OpenAI adapters, retry wrapper | ✅ Done |
| 7. `lib/pipeline/extract.ts` (+ `schemas.ts`, `prompts.ts`) — stage 1 + repair | ✅ Done |
| 8. `lib/pipeline/questions.ts` — stage 2 | ✅ Done |
| 9. `lib/pipeline/run.ts` — orchestration, events, dedupe | ✅ Done |
| 10. `lib/export.ts`, `lib/filename.ts`, `app/api/export/route.ts` | ✅ Done |
| 11. `app/api/generate/route.ts` — validation + NDJSON stream | ✅ Done |
| 12. `app/page.tsx`, `lib/ndjson.ts` — UI | ✅ Done |
| 13. Hosting (native + Docker) | 🟡 Files written; Docker checks not yet run |
| 14. End-to-end run with a real LLM | ⬜ Not started — needs an API key |

### Verified so far

- `npx vitest run` — 12 files, 93 tests pass (all offline, using a fake LLM)
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm run build` — succeeds; `/api/export` and `/api/generate` are dynamic routes
- `docker compose config -q` (from the evoindexer root) — valid
- Production server smoke test: `GET /` → 200. `POST /api/generate` with no `.env` → 500 "Server configuration error: ANTHROPIC_API_KEY is not set" (as designed: config is checked before input)

### Files changed outside this folder

- `../docker-compose.yml` — nginx publishes `8082:8082` and depends on `qa-generator`; new `qa-generator` service with `env_file: ./question-answer-generator/.env` (`required: false`)
- `../nginx/nginx.conf` — new `upstream qa_generator` + `server { listen 8082; }` with `proxy_buffering off`
- `../README.md` — port 8082, the copy step, a "Build question-answer-generator app" section, the nginx step (3 symlinks), a "Run with Docker" section

`../frontend/` and `../xinren-rag/` are untouched.

## What's left

### 1. Finish Task 13 — needs Docker Desktop running

Docker Desktop wasn't running, so these weren't executed. From the evoindexer root (Git Bash):

```bash
MSYS_NO_PATHCONV=1 docker run --rm --add-host frontend:127.0.0.1 --add-host qa-generator:127.0.0.1 \
  -v "$(pwd -W)/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W)/question-answer-generator/qa-generator.nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
docker compose build qa-generator
docker run --rm -d --name qa-smoke -p 3099:3000 evoindexer-qa-generator
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3099/    # expect 200
docker rm -f qa-smoke
```

Don't use `docker compose up nginx` alone: nginx resolves the `frontend` upstream at startup, so it needs the whole stack, including the heavy xinren-rag build.

### 2. Task 14 — end-to-end with a real LLM

Prerequisites (the user said they'll do these):

- **`.env`:** the user creates `question-answer-generator/.env` from `.env.example` with their API key. **Never ask them to paste the key into chat.**
- **Spending:** the user OKs spending credits (estimate: about $1–2 on `claude-opus-5` for one full run plus one short GBK run). **Confirm before running.**

Then follow plan Task 14, steps 2–8:

- `npm run build && npm start` (restart after any `.env` change)
- `curl -sN -F "file=@materials/01-input.docx" -F "variants=3" http://localhost:3001/api/generate > <scratch>/run-01.ndjson`
- Run the `check-run.mjs` script from the plan to check:
  - longest answer ≤ limit
  - most answers have 3 questions
  - all six exhibition sections covered
  - 20 random rows printed for a manual check that answers stick to the document
- Export the xlsx and read it back. Optionally check it with `pandas.read_excel` in a temporary venv (the way xinren-rag reads it).
- GBK `.txt` run with `variants=1`
- Browser check of the UI (progress bar, preview, both downloads)
- Report the results, and anything not verified (e.g. the OpenAI provider if there's no key)

### 3. Afterwards

- **Tune prompts if the real output disappoints.** The prompts live in `lib/pipeline/prompts.ts`. Watch the discard counts in the UI: many "number not in source" drops means the model is rewriting numbers.
- **The OpenAI path is unit-tested only.** `OPENAI_MODEL` has no default by design.

## Gotchas for the next session

- **Not a git repository.** There are no commits; the plan's "checkpoint" steps stand in for them.
- **Backslash escapes get unescaped in Bash-tool inline scripts** on this machine (`"\\u200B"` arrives as the literal character). Build backslashes with `chr(92)`, or write files with the Write/Edit tools. Source files should use `\uFEFF` / `\u200B` escapes, never literal invisible characters. A check: count U+200B–U+200D and U+FEFF in `lib/`, `tests/` and `app/`; the count should be 0.
- **exceljs typing:** `workbook.xlsx.load()` wants exceljs's own `Buffer` type. The tests cast with `as unknown as Parameters<typeof workbook.xlsx.load>[0]`.
- **Low memory:** a background `npm start` was killed once because the machine ran low on memory. Restart it when needed.
- **Skipped install script:** npm skipped the `unrs-resolver` postinstall script (allowScripts). Lint still passes, so no action needed.
- **Anthropic calls** stream with `max_tokens: 64000`, `fallbacks: "default"` and beta `server-side-fallback-2026-07-01`. Keep the streaming: large non-streaming `max_tokens` values trip the SDK's 10-minute guard.
- **User preference:** keep process light — sensible defaults, one review, only stop for genuinely blocking decisions (like spending credits).
