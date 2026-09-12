import ExcelJS from "exceljs";
import type { QaRow } from "./pipeline/run";

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** UTF-8 with BOM so Excel shows Chinese correctly. */
export function toCsv(rows: QaRow[]): string {
  const lines = [["question", "text"], ...rows.map((r) => [r.question, r.text])].map((cells) => cells.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function toXlsx(rows: QaRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("qa");
  sheet.columns = [
    { header: "question", key: "question", width: 48 },
    { header: "text", key: "text", width: 80 },
  ];
  for (const row of rows) sheet.addRow(row);
  sheet.getColumn("text").alignment = { wrapText: true, vertical: "top" };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
