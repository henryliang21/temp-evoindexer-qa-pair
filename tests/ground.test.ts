import { describe, expect, it } from "vitest";
import { charLength, checkUnit, normalize, numbersIn } from "@/lib/pipeline/ground";

const SOURCE =
  "第一阶段始于1959年，以专家的探索和实践为主。\n“阜外说心脏”吸引超17万用户关注，数据库中目前已有4.9万条视频。 学校共有12个校区，\u200C芳古园校区。";
const source = normalize(SOURCE);

describe("normalize / numbersIn / charLength", () => {
  it("normalizes width, whitespace and zero-width characters", () => {
    expect(normalize("Ａ Ｂ\u200B\n１２\uFEFF")).toBe("AB12");
  });

  it("finds Arabic numbers including full-width digits, decimals and thousands separators", () => {
    expect(numbersIn("始于1959年，已有4.9万条，１７万，1,500家")).toEqual(["1959", "4.9", "17", "1500"]);
  });

  it("counts code points", () => {
    expect(charLength("首钢😀")).toBe(3);
  });
});

describe("checkUnit", () => {
  it("accepts a grounded unit", () => {
    expect(checkUnit({ answer: "我国心血管疾病防控第一阶段始于1959年。", evidence: ["第一阶段始于1959年"] }, source, 100)).toBe("ok");
  });

  it("ignores whitespace and zero-width differences in evidence", () => {
    expect(checkUnit({ answer: "学校共有12个校区。", evidence: ["学校共有12个校区，芳古园校区"] }, source, 100)).toBe("ok");
  });

  it("accepts numbers drawn from any of the quotes", () => {
    const unit = { answer: "有17万用户和4.9万条视频。", evidence: ["吸引超17万用户关注", "已有4.9万条视频"] };
    expect(checkUnit(unit, source, 100)).toBe("ok");
  });

  it.each([
    ["quote not in source", { answer: "第三阶段始于2009年。", evidence: ["第三阶段始于2009年"] }],
    ["no quotes", { answer: "第一阶段很早。", evidence: [] }],
    ["trivially short quote", { answer: "第一阶段很早。", evidence: ["第一"] }],
  ])("rejects evidence: %s", (_name, unit) => {
    expect(checkUnit(unit, source, 100)).toBe("evidence");
  });

  it("rejects a number that is not in the evidence", () => {
    expect(checkUnit({ answer: "第一阶段始于1960年。", evidence: ["第一阶段始于1959年"] }, source, 100)).toBe("numbers");
  });

  it("rejects an answer over the length limit", () => {
    expect(checkUnit({ answer: "甲".repeat(21), evidence: ["以专家的探索和实践为主"] }, source, 20)).toBe("length");
  });
});
