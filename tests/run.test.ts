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
    const llm = fakeLlm({
      extract: () => {
        throw Object.assign(new Error("401"), { status: 401 });
      },
    });
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
    const llm = fakeLlm({
      extract: byChunk,
      questions: () => {
        throw new Error("all down");
      },
    });
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
