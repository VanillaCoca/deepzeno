import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitTitleToWidth } from "../../lib/ir/fit-title.ts";

describe("fitTitleToWidth", () => {
  it("returns short titles unchanged", () => {
    assert.equal(fitTitleToWidth("先转 TD", 160, 13), "先转 TD");
  });
  it("truncates long CJK titles with an ellipsis to fit the box", () => {
    const out = fitTitleToWidth(
      "结构化存储项目判断在AI对话之间无缝衔接保持上下文",
      160,
      13
    );
    assert.ok(out.endsWith("…"));
    assert.ok([...out].length <= 12);
  });
  it("packs more latin characters than CJK into the same width", () => {
    const cjk = fitTitleToWidth(
      "一二三四五六七八九十一二三四五六七八",
      160,
      13
    ).length;
    const latin = fitTitleToWidth(
      "abcdefghijklmnopqrstuvwxyzabcdefghij",
      160,
      13
    ).length;
    assert.ok(latin > cjk);
  });
});
