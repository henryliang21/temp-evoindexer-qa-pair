"use client";

import { useRef, useState } from "react";
import { exportFilename } from "@/lib/filename";
import { splitLines } from "@/lib/ndjson";
import type { ProgressEvent, QaRow, RunStats, StreamEvent } from "@/lib/pipeline/run";

type Phase = "idle" | "running" | "done" | "error";

interface Progress {
  label: string;
  fraction: number;
}

function progressFrom(event: ProgressEvent): Progress {
  switch (event.type) {
    case "parsed":
      return { label: `Read ${event.chars.toLocaleString()} characters in ${event.chunks} section(s). Extracting facts…`, fraction: 0.02 };
    case "extract":
      return {
        label: `Extracting facts: section ${event.done} of ${event.total} (${event.units} answers so far)`,
        fraction: 0.02 + 0.68 * (event.done / event.total),
      };
    case "questions":
      return { label: `Writing questions: batch ${event.done} of ${event.total}`, fraction: 0.7 + 0.3 * (event.done / event.total) };
  }
}

async function errorDetail(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { detail?: string } | null;
  return data?.detail ?? `${fallback} (HTTP ${res.status})`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [variants, setVariants] = useState(3);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<Progress>({ label: "", fraction: 0 });
  const [rows, setRows] = useState<QaRow[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<"xlsx" | "csv" | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function generate() {
    if (!file) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase("running");
    setError("");
    setRows([]);
    setStats(null);
    setSourceName(file.name);
    setProgress({ label: "Uploading and reading the document…", fraction: 0 });

    try {
      const form = new FormData();
      form.set("file", file);
      form.set("variants", String(variants));
      const res = await fetch("/api/generate", { method: "POST", body: form, signal: abort.signal });
      if (!res.ok || !res.body) throw new Error(await errorDetail(res, "Request failed"));

      let finished = false;
      const handle = (line: string) => {
        const event = JSON.parse(line) as StreamEvent;
        if (event.type === "result") {
          setRows(event.rows);
          setStats(event.stats);
          setPhase("done");
          finished = true;
        } else if (event.type === "error") {
          throw new Error(event.message);
        } else {
          setProgress(progressFrom(event));
        }
      };

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const { lines, rest } = splitLines(buffer + value);
        buffer = rest;
        lines.forEach(handle);
      }
      if (buffer.trim()) handle(buffer.trim());
      if (!finished) throw new Error("The connection closed before generation finished.");
    } catch (err) {
      if (abort.signal.aborted) {
        setPhase("idle");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }

  async function download(format: "xlsx" | "csv") {
    setDownloading(format);
    try {
      const res = await fetch(`/api/export?format=${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: sourceName, rows }),
      });
      if (!res.ok) throw new Error(await errorDetail(res, "Export failed"));
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(sourceName, format);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(null);
    }
  }

  const running = phase === "running";
  const droppedTotal = stats ? stats.dropped.evidence + stats.dropped.numbers + stats.dropped.length : 0;
  const partial = stats !== null && (stats.failedChunks > 0 || stats.failedBatches > 0);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Q&amp;A Generator</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Upload a .docx or .txt document to generate a question / answer table for an EvoIndexer retriever. Answers come
          only from the document.
        </p>

        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-end gap-6">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Document</span>
              <input
                type="file"
                accept=".docx,.txt"
                disabled={running}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-zinc-800"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Questions per answer: {variants}</span>
              <input
                type="range"
                min={1}
                max={6}
                value={variants}
                disabled={running}
                onChange={(e) => setVariants(Number(e.target.value))}
                className="w-48"
              />
            </label>

            {running ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={generate}
                disabled={!file}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Generate
              </button>
            )}
          </div>

          {running && (
            <div className="mt-5">
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full bg-zinc-900 transition-all dark:bg-zinc-100"
                  style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-zinc-500">{progress.label}</p>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
          )}
        </section>

        {phase === "done" && stats && (
          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm">
                <p>
                  <span className="font-medium">{stats.units}</span> answers · <span className="font-medium">{stats.rows}</span> rows
                </p>
                {droppedTotal > 0 && (
                  <p className="text-zinc-500">
                    Discarded {droppedTotal}: {stats.dropped.evidence} quote not found in document · {stats.dropped.numbers} number not
                    in source · {stats.dropped.length} too long
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {(["xlsx", "csv"] as const).map((format) => (
                  <button
                    key={format}
                    onClick={() => download(format)}
                    disabled={rows.length === 0 || downloading !== null}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    {downloading === format ? "Preparing…" : `Download .${format}`}
                  </button>
                ))}
              </div>
            </div>

            {partial && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {stats.failedChunks} section(s) and {stats.failedBatches} question batch(es) failed: {stats.failureReason}. The results
                below are partial.
              </p>
            )}

            {rows.length === 0 ? (
              <p className="mt-6 text-sm text-zinc-500">No question / answer pairs were generated from this document.</p>
            ) : (
              <div className="mt-4 max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">question</th>
                      <th className="px-3 py-2 font-medium">text</th>
                      <th className="px-3 py-2 font-medium">chars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                        <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                        <td className="px-3 py-2">{row.question}</td>
                        <td className="px-3 py-2">{row.text}</td>
                        <td className="px-3 py-2 text-zinc-400">{[...row.text].length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
