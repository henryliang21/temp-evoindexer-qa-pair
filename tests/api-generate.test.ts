import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate/route";
import { createLlm } from "@/lib/llm";
import type { StreamEvent } from "@/lib/pipeline/run";
import { fakeLlm } from "./helpers/fake-llm";

vi.mock("@/lib/llm", () => ({ createLlm: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("LLM_PROVIDER", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANSWER_MAX_CHARS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(createLlm).mockReset();
});

const txt = (content: string, name = "doc.txt") => new File([content], name, { type: "text/plain" });

function upload(file: File | null, variants = "2") {
  const form = new FormData();
  if (file) form.set("file", file);
  form.set("variants", variants);
  return POST(new Request("http://localhost/api/generate", { method: "POST", body: form }));
}

async function events(res: Response): Promise<StreamEvent[]> {
  return (await res.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as StreamEvent);
}

describe("POST /api/generate", () => {
  it("rejects a request without a file", async () => {
    const res = await upload(null);
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/No file/);
  });

  it("rejects unsupported file types", async () => {
    const res = await upload(txt("内容。", "doc.pdf"));
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/\.docx and \.txt/);
  });

  it("rejects an invalid questions-per-answer value", async () => {
    const res = await upload(txt("内容。"), "9");
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/1 to 6/);
  });

  it("rejects an empty document", async () => {
    const res = await upload(txt("   "));
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/no text/);
  });

  it("reports a missing API key as a server configuration error", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await upload(txt("内容。"));
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("streams progress and the final rows", async () => {
    const unit = { answer: "第一阶段始于1959年。", evidence: ["第一阶段始于1959年"] };
    vi.mocked(createLlm).mockReturnValue(fakeLlm({ extract: () => ({ units: [unit] }) }));

    const res = await upload(txt("第一阶段始于1959年，重点是高血压和冠心病。"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const all = await events(res);
    expect(all.map((e) => e.type)).toEqual(["parsed", "extract", "questions", "result"]);
    expect(all.at(-1)).toMatchObject({
      type: "result",
      rows: [
        { question: "第一阶段始于1959年。是什么？", text: unit.answer },
        { question: "请问第一阶段始于1959年。？", text: unit.answer },
      ],
    });
  });

  it("streams an error event when generation fails", async () => {
    vi.mocked(createLlm).mockReturnValue(
      fakeLlm({
        extract: () => {
          throw Object.assign(new Error("401"), { status: 401 });
        },
      }),
    );
    const all = await events(await upload(txt("内容。")));
    expect(all.at(-1)).toEqual({ type: "error", message: expect.stringMatching(/API key/) });
  });
});
