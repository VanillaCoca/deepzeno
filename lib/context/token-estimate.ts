// Lightweight, provider-agnostic token estimation.
//
// This is intentionally a *heuristic*: it drives a safety threshold for
// conversation compaction, not billing. We bias toward a slight overestimate so
// that compaction triggers a little early rather than a little late (overflowing
// the model context window is the failure we must avoid).
//
// Rough model: Latin text is ~4 chars/token; CJK is ~1 token/char. We count CJK
// (and kana / fullwidth) characters separately and treat each as a whole token.

const CJK_CHAR = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

// Per-message structural overhead (role markers, message framing) the model
// pays on top of the raw content.
const PER_MESSAGE_OVERHEAD_TOKENS = 8;

export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }

  let cjk = 0;
  for (const char of text) {
    if (CJK_CHAR.test(char)) {
      cjk += 1;
    }
  }

  const rest = text.length - cjk;
  return Math.ceil(rest / 4 + cjk);
}

type MessagePartLike = Record<string, unknown>;

// Pull a best-effort text representation out of a message's parts. Text parts
// contribute their text; non-text parts (tool calls, files, reasoning) are
// stringified so their tokens are still roughly accounted for.
export function extractPartsText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return typeof parts === "string" ? parts : "";
  }

  return (parts as MessagePartLike[])
    .map((part) => {
      if (part && typeof part === "object") {
        if (typeof part.text === "string") {
          return part.text;
        }
        return JSON.stringify(part);
      }
      return typeof part === "string" ? part : "";
    })
    .join("\n");
}

export type TokenEstimableMessage = {
  role?: string;
  parts?: unknown;
  content?: unknown;
};

export function estimateMessageTokens(message: TokenEstimableMessage): number {
  const text =
    message.parts === undefined
      ? typeof message.content === "string"
        ? message.content
        : extractPartsText(message.content)
      : extractPartsText(message.parts);

  return estimateTextTokens(text) + PER_MESSAGE_OVERHEAD_TOKENS;
}

export function estimateMessagesTokens(
  messages: TokenEstimableMessage[]
): number {
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0
  );
}
