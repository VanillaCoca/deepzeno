import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sanitizeExtractedTitle,
  splitEscaped,
  stripInlineMarkers,
} from "@/lib/ir/marker-syntax";

// The two rows that actually reached production on 2026-07-25. If either of
// these ever passes through `sanitizeExtractedTitle` unchanged again, the guard
// is gone.
const PRODUCTION_C558 =
  "[[ir:constraint|不得为显示进度而额外发起模型调用，进度必须从已有 checkpoint 读取|多一次调用会增加延迟和成本，违背进度展示的初衷]]";
const PRODUCTION_G55 =
  "[[ir:goal|用户在 agent 运行期间随时能知道当前执行到哪一步|进度可见性是核心目标，进度条只是其中一种实现手段]]";

describe("stripInlineMarkers", () => {
  it("keeps the title and drops the packaging", () => {
    assert.equal(
      stripInlineMarkers(PRODUCTION_C558),
      "不得为显示进度而额外发起模型调用，进度必须从已有 checkpoint 读取"
    );
  });

  it("leaves ordinary prose alone", () => {
    const prose = "我们决定先做进度条，因为 [1] 成本最低。";
    assert.equal(stripInlineMarkers(prose), prose);
  });

  it("unwraps a marker in the middle of a sentence", () => {
    assert.equal(
      stripInlineMarkers(
        "所以 [[ir:goal|让进度可见|因为用户在等]] 是第一位的。"
      ),
      "所以 让进度可见 是第一位的。"
    );
  });

  it("drops relation markers entirely — they carry no prose", () => {
    assert.equal(
      stripInlineMarkers("[[ir:goal|让进度可见|理由]][[rel:refines|G12]]"),
      "让进度可见"
    );
  });

  it("reduces an inline-ref to the id it points at", () => {
    assert.equal(
      stripInlineMarkers('这与 <inline-ref id="G12"/> 冲突'),
      "这与 G12 冲突"
    );
  });

  it("respects escaped pipes inside a field", () => {
    assert.equal(stripInlineMarkers("[[ir:goal|a\\|b|rationale]]"), "a|b");
  });

  it("leaves an unterminated marker intact rather than eating the rest", () => {
    // No closing `]]`, so there is no marker — just text that starts like one.
    // Consuming to end-of-string here would silently delete real content.
    assert.equal(
      stripInlineMarkers("[[ir:goal|dangling"),
      "[[ir:goal|dangling"
    );
  });
});

describe("sanitizeExtractedTitle", () => {
  it("salvages the claim from a whole-marker title", () => {
    assert.equal(
      sanitizeExtractedTitle(PRODUCTION_G55),
      "用户在 agent 运行期间随时能知道当前执行到哪一步"
    );
  });

  it("passes a normal title through untouched", () => {
    assert.equal(sanitizeExtractedTitle("  进度必须可见  "), "进度必须可见");
  });

  it("rejects a title whose marker never closed", () => {
    // Iron Law 2: the model was clearly emitting protocol and we cannot tell
    // what it meant, so we miss the judgment rather than invent a title.
    assert.equal(sanitizeExtractedTitle("[[ir:goal|half a thought"), null);
  });

  it("rejects a title with stray bracket residue", () => {
    assert.equal(
      sanitizeExtractedTitle("[[ir:goal|salvaged|r]] 然后 [[ir:"),
      null
    );
    assert.equal(sanitizeExtractedTitle("结论 ]] 完"), null);
  });

  it("salvages a structurally sound marker even with an unknown kind", () => {
    // Deliberately more permissive than the parser in `inline-markers`, which
    // refuses to *create a node* from an unknown kind. Here the question is
    // narrower — "which of these characters are prose?" — and the answer does
    // not depend on whether `whatever` names a real IR kind.
    assert.equal(sanitizeExtractedTitle("[[ir:whatever|x|y]]"), "x");
  });

  it("rejects an empty or absent title", () => {
    assert.equal(sanitizeExtractedTitle("   "), null);
    assert.equal(sanitizeExtractedTitle(null), null);
    assert.equal(sanitizeExtractedTitle(undefined), null);
    // A marker with an empty title field has nothing to salvage either.
    assert.equal(sanitizeExtractedTitle("[[ir:goal||rationale]]"), null);
  });
});

describe("splitEscaped", () => {
  it("splits on unescaped pipes only", () => {
    assert.deepEqual(splitEscaped("goal|a\\|b|c"), ["goal", "a|b", "c"]);
  });
});
