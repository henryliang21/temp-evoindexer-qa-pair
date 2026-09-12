# Question-Answer Generator — Requirements

Version: 1.0 (2026-09-10)
Design: [docs/superpowers/specs/2026-09-10-question-answer-generator-design.md](superpowers/specs/2026-09-10-question-answer-generator-design.md)

## 1. Background

The xinren-rag app answers visitors' questions through a **digital human** that
speaks the answer out loud. Its knowledge comes from question/answer tables
(`.xlsx`/`.csv`). The app embeds the question column; when a visitor's question
matches a stored question, it returns the paired answer.

Today these tables are written by hand from source documents such as
exhibition-hall scripts and school introductions. That is slow, and a
hand-written table usually covers only one or two ways of asking each fact, so
visitors who phrase a question differently get no match.

## 2. Goal

Build a small website that turns a source document into a ready-to-import Q&A
table. It should:

- use an LLM to read the document and find every fact a visitor might ask about;
- write a short, speakable answer for each fact, using **only** the document;
- write **several differently-phrased questions** for each answer, so retrieval
  matches as many real phrasings as possible.

## 3. Users and workflow

The user is an operator preparing knowledge for a digital human.

1. Open the website and upload a `.docx` or `.txt` document.
2. Optionally choose how many questions to generate for each answer.
3. Start generation and watch its progress.
4. Review the generated pairs in a preview table.
5. Download the table as `.xlsx` or `.csv`.
6. Load the file into a xinren-rag retriever.

## 4. Scope

**In scope:** document upload, LLM generation, preview, file download, native
and Docker hosting.

**Out of scope (v1):** login or access control, saved history or background
jobs, editing rows in the browser, PDF or other input formats, category columns,
choosing the LLM provider per run in the UI.

## 5. Functional requirements

### Input

| ID | Requirement |
| --- | --- |
| FR-1 | Accept one `.docx` or `.txt` file per run. Reject anything else with a clear message. |
| FR-2 | Accept files up to 10 MB. |
| FR-3 | Accept documents with up to 200,000 characters of extracted text. Reject larger documents with a message giving the actual size. Never silently truncate. |
| FR-4 | Extract all body text from `.docx`, including text added as tracked changes. |
| FR-5 | Read `.txt` as UTF-8, and fall back to GB18030/GBK (common for Chinese text files). |

### Generation

| ID | Requirement |
| --- | --- |
| FR-6 | Every answer must be supported by the document. No outside knowledge, no guesses, no invented details. |
| FR-7 | Every answer must stand alone. It names its subject (e.g. "北京市丰台区职业教育中心学校", not "我们"), because it will be heard without the source document. |
| FR-8 | Every answer is written to be spoken: natural full sentences; no lists, markdown, bracketed notes or URLs. |
| FR-9 | Every answer is at most `ANSWER_MAX_CHARS` characters (configurable, default 100 — about 20–25 seconds of speech). Facts too long for one answer are split into several answers. |
| FR-10 | Numbers, dates and quantities are written exactly as the document writes them. |
| FR-11 | Each answer gets N questions (N chosen by the user, 1–6, default 3). The questions differ in angle and wording, not just synonyms — for example a direct question, a casual visitor phrasing, a keyword-style query, and a why/how/when/how-many question. |
| FR-12 | Every question is fully answered by its answer, and names its subject rather than relying on context ("它"). |
| FR-13 | Several questions pointing to the same answer is expected and encouraged. |
| FR-14 | Questions and answers are in the document's language. |
| FR-15 | Instructions meant only for the presenter (e.g. "根据墙面内容介绍即可") are not turned into Q&A pairs. |
| FR-16 | Generation should cover the whole document, not just its beginning. Longer documents produce proportionally more pairs. |

### Output

| ID | Requirement |
| --- | --- |
| FR-17 | Output has exactly two columns, `question` and `text` (the answer), with one question per row. When an answer has several questions, the answer is repeated on each row. |
| FR-18 | `.xlsx` output loads into a xinren-rag `CachedSheet2Chroma` retriever with `key_field: question` and `meta_field: text` without any edits. |
| FR-19 | `.csv` output is UTF-8 with a BOM so Excel shows Chinese correctly, with standard quoting for commas, quotes and line breaks. |
| FR-20 | Exact duplicate questions are removed. |

### User interface

| ID | Requirement |
| --- | --- |
| FR-21 | The page has a file picker, a "questions per answer" control, and a Generate button. |
| FR-22 | While generating, the page shows live progress (e.g. "section 3 of 7"). |
| FR-23 | When done, the page shows a summary (answers, rows, items discarded and why) and a preview of all rows. |
| FR-24 | The user can download the result as `.xlsx` or `.csv`. |
| FR-25 | Errors are shown in plain language. If part of the document failed, the successful results are still shown, with a warning. |

## 6. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | **LLM provider:** works with either the Anthropic API (Claude) or an OpenAI-compatible API (including OpenRouter). The provider is chosen in `.env`. |
| NFR-2 | **Configuration:** provider, API keys, models and answer length live in the app's `.env` file (see §7). Changing them needs a restart, not a rebuild. API keys never reach the browser or the Docker image. |
| NFR-3 | **Tech stack:** Next.js, matching `../frontend` (Next.js 16, React 19, Tailwind 4, TypeScript). |
| NFR-4 | **Native hosting:** runs like `../frontend`, under PM2 behind nginx, on its own ports (app 3001, nginx 8082). A PM2 config and an nginx config are provided. |
| NFR-5 | **Docker hosting:** runs as its own service in the root `docker-compose.yml`, behind the shared nginx on port 8082. The existing `frontend` and `xinren-rag` services are unaffected. |
| NFR-6 | **Performance:** a document the size of `materials/01-input.docx` finishes in a few minutes. |
| NFR-7 | **Cost control:** if the user closes the page mid-run, LLM calls stop. |
| NFR-8 | **Documentation:** the root `README.md` explains how to set up, build and run the app, both natively and with Docker. |

## 7. Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | — | Required when the provider is `anthropic` |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Claude model to use |
| `OPENAI_API_KEY` | — | Required when the provider is `openai` |
| `OPENAI_BASE_URL` | OpenAI default | Optional, e.g. an OpenRouter URL |
| `OPENAI_MODEL` | — | Required when the provider is `openai` |
| `ANSWER_MAX_CHARS` | `100` | Maximum answer length in characters |

## 8. Reference materials (`materials/`)

| File | What it is | What to take from it |
| --- | --- | --- |
| `01-input.docx` | A ~3,600-character Chinese exhibition-hall tour script (国家心血管病中心展厅串讲词). Contains tracked changes. | The main test document. |
| `01-output.xlsx` | 66 hand-written pairs for `01-input.docx`. Answers are 19–50 characters. | The target style: short, conversational, self-contained answers. Some cells pack 2 questions into one; the generator puts each question on its own row instead (FR-17). Its header `quesntion` is a typo; the generator uses `question`. |
| `02-output.xlsx` | 322 pairs about a vocational school (no input document provided), with a category column. | Shows many questions pointing to overlapping answers (FR-13), and — in its last rows — long contact details split into separate address, phone and directions answers (FR-9). About 50 answers exceed 100 characters; the generator would split those. |

## 9. Acceptance criteria

1. **Generation works.** Uploading `materials/01-input.docx` with the default settings produces a downloadable `.xlsx` with `question` and `text` columns.
2. **Coverage.** The result covers every one of the six exhibition sections in the document, and a reviewer can find most facts from `01-output.xlsx` in it.
3. **Grounding.** A spot check of 20 random rows finds no answer containing information that isn't in the document.
4. **Answer length.** No answer is longer than `ANSWER_MAX_CHARS`.
5. **Many questions per answer.** With N = 3, most answers have 3 distinct questions.
6. **Import works.** The `.xlsx` loads into a xinren-rag retriever with `key_field: question`, `meta_field: text`.
7. **Text files work.** A UTF-8 `.txt` and a GBK `.txt` of the same text both generate successfully.
8. **Bad input is rejected clearly.** A `.pdf`, a file over 10 MB, and an empty document each get a clear error.
9. **Both providers work.** Switching `LLM_PROVIDER` to `openai` (with key and model set) and restarting still generates.
10. **Both hosting modes work.** The site is reachable on port 8082, both through native PM2 + nginx and through `docker compose up`.

## Appendix: original request (verbatim)

> I want to build a simple next.js website that takes docx or txt based file, and generate csv or xlsx format question and answer pair table. The input and output samples are in ./materials directory, 01-input.docx are paird with 01-output.xlsx, and 02-output.xlsx is another output example without the input doc.
>
> The convertion is for generate the question/answer pairs so later the pairs will be used in another RAG app. This project is to use LLM (openai api or claude api), to understand the input doc, and generate most likely to be asked questions, and generated the answers for those questions based on the sematic meaning of the input doc materials, not based on outside information or phantom knowledges.
>
> The question answer pairs could contains multiple different questions pointing to same piece of answer, due to the answer content can be used to answer questions from different syntex or different angles. So this logic is allowed. In fact, this is encouraged to try to figure out as many as the way to ask same piece to information, to have more complete coverage of the way to ask.
>
> The new website should follow the same way as how ../frontend is hosted, for both native hosting or via docker. You need to update the nginx and docker file for that.
