import { describe, expect, it } from "vitest";
import { splitLines } from "@/lib/ndjson";

describe("splitLines", () => {
  it.each([
    ["a\nb\nc", ["a", "b"], "c"],
    ["a\n", ["a"], ""],
    ["", [], ""],
    ["a\n\n  \nb\n", ["a", "b"], ""],
  ])("%j", (buffer, lines, rest) => {
    expect(splitLines(buffer)).toEqual({ lines, rest });
  });
});
