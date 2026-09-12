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
    await workbook.xlsx.load((await toXlsx(rows)) as unknown as Parameters<typeof workbook.xlsx.load>[0]);

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
