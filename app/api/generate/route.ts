import { ConfigError, loadConfig, type AppConfig } from "@/lib/config";
import { createLlm } from "@/lib/llm";
import { describeLlmError } from "@/lib/llm/errors";
import { extractText, InputError, MAX_UPLOAD_BYTES } from "@/lib/parse";
import { runPipeline, type StreamEvent } from "@/lib/pipeline/run";

function fail(detail: string, status = 400): Response {
  return Response.json({ detail }, { status });
}

export async function POST(req: Request): Promise<Response> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) return fail(`Server configuration error: ${err.message}`, 500);
    throw err;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Expected a multipart form upload");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("No file uploaded");
  if (file.size > MAX_UPLOAD_BYTES) return fail("The file is larger than 10 MB");

  const variants = Number(form.get("variants") ?? 3);
  if (!Number.isInteger(variants) || variants < 1 || variants > 6) {
    return fail("Questions per answer must be a whole number from 1 to 6");
  }

  let text: string;
  try {
    text = await extractText(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }

  const llm = createLlm(config);
  // Stop LLM spending when the browser goes away (request aborted or stream cancelled).
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        const { rows, stats } = await runPipeline({
          text,
          filename: file.name,
          variants,
          maxChars: config.answerMaxChars,
          llm,
          emit: send,
          signal: abort.signal,
        });
        send({ type: "result", rows, stats });
      } catch (err) {
        if (!abort.signal.aborted) send({ type: "error", message: describeLlmError(err) });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by a cancelled client
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
