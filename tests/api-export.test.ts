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
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet("qa")!.getRow(2).values).toEqual([undefined, "问？", "答。"]);
  });

  it("rejects an unknown format", async () => {
    expect((await post("pdf", { filename: "a", rows })).status).toBe(400);
  });

  it("rejects a malformed body", async () => {
    expect((await post("csv", { filename: "a", rows: "nope" })).status).toBe(400);
  });
});
