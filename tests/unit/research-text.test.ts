import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractReadableText, verifyQuote } from "../../lib/research/text.ts";

describe("extractReadableText", () => {
  it("strips tags, scripts, and styles; keeps visible text", () => {
    const html = `<html><head><style>.x{color:red}</style>
      <script>alert(1)</script><title>T</title></head>
      <body><nav>menu</nav><h1>Pricing changes</h1>
      <p>The new plan costs <b>$20</b> per month.</p></body></html>`;
    const text = extractReadableText(html);
    assert.ok(text.includes("Pricing changes"));
    assert.ok(text.includes("The new plan costs $20 per month."));
    assert.ok(!text.includes("alert(1)"));
    assert.ok(!text.includes("color:red"));
  });

  it("decodes common entities and collapses whitespace", () => {
    const text = extractReadableText(
      "<p>A&amp;B &lt;ok&gt;&nbsp;&#39;quoted&#39;   spaced</p>"
    );
    assert.equal(text, "A&B <ok> 'quoted' spaced");
  });
});

describe("verifyQuote", () => {
  const page = "The launch was delayed to Q3 2026.\nBudget stays at $500.";

  it("accepts verbatim quotes ignoring whitespace runs and case", () => {
    assert.equal(
      verifyQuote("the launch was  delayed to Q3 2026.", page),
      true
    );
  });

  it("rejects paraphrases and fabrications", () => {
    assert.equal(verifyQuote("launch moved to Q4 2026", page), false);
    assert.equal(verifyQuote("", page), false);
  });
});
