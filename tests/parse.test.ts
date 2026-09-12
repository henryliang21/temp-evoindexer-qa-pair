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
