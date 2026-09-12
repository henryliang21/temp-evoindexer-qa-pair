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
