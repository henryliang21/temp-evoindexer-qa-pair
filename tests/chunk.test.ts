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
