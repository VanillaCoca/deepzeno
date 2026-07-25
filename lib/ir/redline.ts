import { diff_match_patch } from "diff-match-patch";

/**
 * Sentence-level redline between two plain-text truths, for the supersede
 * ruling view (PRD K4 / JI-02). Reuses the `diff-match-patch` library directly
 * — the repo's lib/editor/diff.js wraps the same library but for ProseMirror
 * documents, which is the wrong shape for two strings.
 *
 * Sentence granularity (rather than character) keeps the diff readable for
 * prose judgments and mirrors the tokenization already used in diff.js. CJK
 * sentence punctuation is included so Chinese content redlines too.
 */
export type RedlineSegment = {
  type: "unchanged" | "deleted" | "inserted";
  text: string;
};

const SENTENCE_PATTERN = /[^.!?。！？\n]+[.!?。！？\n]*/g;

function tokenizeSentences(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.match(SENTENCE_PATTERN) ?? [text];
}

/**
 * Map each distinct sentence to a single char so diff-match-patch can diff at
 * sentence granularity (the same trick diff.js uses). Shared dictionary across
 * both sides so identical sentences collapse to the same char.
 */
function encodeSentences(
  groups: string[][]
): { encoded: string[]; lineArray: string[] } {
  const lineArray: string[] = [];
  const lineHash = new Map<string, number>();

  const encoded = groups.map((sentences) =>
    sentences
      .map((sentence) => {
        let index = lineHash.get(sentence);
        if (index === undefined) {
          index = lineArray.length;
          lineArray.push(sentence);
          lineHash.set(sentence, index);
        }
        return String.fromCharCode(index);
      })
      .join("")
  );

  return { encoded, lineArray };
}

export function computeRedline(
  oldText: string,
  newText: string
): RedlineSegment[] {
  const dmp = new diff_match_patch();
  const { encoded, lineArray } = encodeSentences([
    tokenizeSentences(oldText ?? ""),
    tokenizeSentences(newText ?? ""),
  ]);
  const diffs = dmp.diff_main(encoded[0], encoded[1], false);

  const segments: RedlineSegment[] = [];
  for (const [op, chars] of diffs) {
    const text = Array.from(chars)
      .map((char) => lineArray[char.charCodeAt(0)])
      .join("");
    if (!text) {
      continue;
    }

    let type: RedlineSegment["type"] = "unchanged";
    if (op === 1) {
      type = "inserted";
    } else if (op === -1) {
      type = "deleted";
    }
    const last = segments.at(-1);
    if (last && last.type === type) {
      last.text += text;
    } else {
      segments.push({ type, text });
    }
  }

  return segments;
}
