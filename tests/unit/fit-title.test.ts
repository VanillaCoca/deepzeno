import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitTitleToWidth, wrapTitleToLines } from "../../lib/ir/fit-title.ts";

const PADDING_PX = 16;

function measureWidth(text: string, fontPx: number): number {
  return [...text].reduce(
    (sum, ch) => sum + (/[　-鿿＀-￯]/.test(ch) ? fontPx : fontPx * 0.55),
    0
  );
}

describe("fitTitleToWidth", () => {
  it("returns short titles unchanged", () => {
    assert.equal(fitTitleToWidth("先转 TD", 160, 13), "先转 TD");
  });
  it("truncates long CJK titles with an ellipsis to fit the box", () => {
    const boxWidthPx = 160;
    const fontPx = 13;
    const out = fitTitleToWidth(
      "结构化存储项目判断在AI对话之间无缝衔接保持上下文",
      boxWidthPx,
      fontPx
    );
    assert.ok(out.endsWith("…"));
    assert.ok([...out].length <= 12);
    // Pixel-width assertion: rendered width must fit within budget
    assert.ok(
      measureWidth(out, fontPx) <= boxWidthPx - PADDING_PX,
      `rendered width ${measureWidth(out, fontPx)} exceeds budget ${boxWidthPx - PADDING_PX}`
    );
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
  it("result + reserve fits within the box budget when reserveText is provided", () => {
    const boxWidthPx = 168;
    const fontPx = 13;
    const prefix = "▷ ";
    const suffix = " ?";
    const reserve = prefix + suffix;
    const out = fitTitleToWidth(
      "结构化存储项目判断在AI对话之间无缝衔接保持上下文",
      boxWidthPx,
      fontPx,
      reserve
    );
    const totalWidth = measureWidth(prefix + out + suffix, fontPx);
    assert.ok(
      totalWidth <= boxWidthPx - PADDING_PX,
      `label + reserve width ${totalWidth} exceeds budget ${boxWidthPx - PADDING_PX}`
    );
  });
});

describe("wrapTitleToLines", () => {
  it("returns a single line for a short title", () => {
    assert.deepEqual(wrapTitleToLines("先转 TD", 168, 13), ["先转 TD"]);
  });

  it("wraps a long CJK title into multiple lines with no ellipsis", () => {
    const lines = wrapTitleToLines(
      "结构化存储项目判断在AI对话之间无缝衔接保持上下文",
      168,
      13
    );
    assert.ok(lines.length >= 2, `expected multiple lines, got ${lines.length}`);
    for (const line of lines) {
      assert.ok(!line.includes("…"), `line should not be truncated: ${line}`);
      assert.ok(
        measureWidth(line, 13) <= 168 - PADDING_PX,
        `line "${line}" width ${measureWidth(line, 13)} exceeds budget`
      );
    }
    assert.equal(
      lines.join(""),
      "结构化存储项目判断在AI对话之间无缝衔接保持上下文"
    );
  });

  it("breaks latin text at word boundaries, not mid-word", () => {
    const lines = wrapTitleToLines("alpha beta gamma delta epsilon", 120, 13);
    assert.ok(lines.length >= 2);
    const words = new Set("alpha beta gamma delta epsilon".split(" "));
    for (const line of lines) {
      for (const word of line.split(" ")) {
        assert.ok(words.has(word), `unexpected fragment: "${word}"`);
      }
    }
  });

  it("reserves first-line width for prefix/suffix", () => {
    const withReserve = wrapTitleToLines("一二三四五六七八九十", 168, 13, "✓  ?");
    const without = wrapTitleToLines("一二三四五六七八九十", 168, 13);
    assert.ok(withReserve[0].length <= without[0].length);
  });
});
