import { z } from "zod";
import { toCsv, toXlsx } from "@/lib/export";
import { exportFilename } from "@/lib/filename";

const BodySchema = z.object({
  filename: z.string().max(255),
  rows: z.array(z.object({ question: z.string(), text: z.string() })).max(50_000),
});

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function POST(req: Request): Promise<Response> {
  const format = new URL(req.url).searchParams.get("format");
  if (format !== "xlsx" && format !== "csv") {
    return Response.json({ detail: "format must be xlsx or csv" }, { status: 400 });
  }
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ detail: "Invalid export request" }, { status: 400 });
  }

  const disposition = contentDisposition(exportFilename(body.data.filename, format));
  if (format === "csv") {
    return new Response(toCsv(body.data.rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition },
    });
  }
  const xlsx = await toXlsx(body.data.rows);
  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition,
    },
  });
}
