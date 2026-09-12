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
