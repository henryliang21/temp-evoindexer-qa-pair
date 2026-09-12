export function exportFilename(source: string, format: "xlsx" | "csv"): string {
  const base = source.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "document";
  return `qa-${base}.${format}`;
}
