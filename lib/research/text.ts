// Pure text utilities for the research pipeline. The anti-hallucination rule
// (spec, Collect phase): an evidence quote must verbatim-match FETCHED page
// content — never a search snippet, never a paraphrase. Prefer to miss.

const BLOCK_TAGS =
  /<(script|style|noscript|svg|head|nav|footer|iframe)[\s\S]*?<\/\1>/gi;
const TAGS = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string) {
  return text
    .replace(
      /&(amp|lt|gt|quot|nbsp|apos);|&#39;/g,
      (match) => ENTITIES[match] ?? match
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    );
}

export function extractReadableText(html: string) {
  const withoutBlocks = html.replace(BLOCK_TAGS, " ");
  const withBreaks = withoutBlocks.replace(
    /<\/(p|div|h[1-6]|li|tr|br)>|<br\s*\/?>/gi,
    "\n"
  );
  const stripped = withBreaks.replace(TAGS, " ");
  return decodeEntities(stripped)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeForMatch(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function verifyQuote(quote: string, pageText: string) {
  const normalizedQuote = normalizeForMatch(quote);

  if (normalizedQuote.length < 8) {
    return false;
  }

  return normalizeForMatch(pageText).includes(normalizedQuote);
}
