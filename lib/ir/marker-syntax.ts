/**
 * The inline marker surface syntax — and the guard that keeps it out of the
 * graph.
 *
 * A marker is how a model hands us a judgment mid-sentence:
 * `[[ir:goal|title|rationale]]`, optionally trailed by `[[rel:refines|G12]]`.
 * It is wire format. It is meant to be consumed on the way in and replaced by
 * an `<inline-ref/>` pointing at the node it created, so that no marker ever
 * survives into stored text.
 *
 * Two things live here, and they live together deliberately. The grammar
 * primitives are the single definition of where a marker starts and ends —
 * `inline-markers` parses with them and the hygiene functions below reject with
 * them, so the writer and the guard cannot drift apart about what counts as a
 * marker.
 *
 * Why the guard exists at all: two nodes reached production whose *titles* were
 * the literal text `[[ir:constraint|…|…]]`. Nothing anywhere asserted that a
 * title is prose rather than protocol. `creation-guards` checks status against
 * source layer; sweep's schema checks only length. Four extraction layers
 * (sweep, research, watchtower, kickoff) each write titles through their own
 * prompt, so this invariant has to be stated once in code instead of four times
 * in English inside prompts that a model is free to ignore.
 *
 * Pure by design — no `server-only` — so `tests/unit` can import it.
 */

const IR_PREFIX = "[[ir:";
const REL_PREFIX = "[[rel:";
const INLINE_REF_RE = /<inline-ref\s+id="([^"]*)"\s*\/>/g;

/** True when the character at `index` is preceded by an odd run of backslashes. */
export function isEscaped(value: string, index: number) {
  let slashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && value[cursor] === "\\") {
    slashCount += 1;
    cursor -= 1;
  }

  return slashCount % 2 === 1;
}

/** Index of the closing `]]` for a marker body starting at `startIndex`, or -1. */
export function findMarkerEnd(value: string, startIndex: number) {
  let cursor = startIndex;

  while (cursor < value.length - 1) {
    if (
      value[cursor] === "]" &&
      value[cursor + 1] === "]" &&
      !isEscaped(value, cursor)
    ) {
      return cursor;
    }

    cursor += 1;
  }

  return -1;
}

export function unescapeMarkerField(value: string) {
  return value
    .replaceAll("\\|", "|")
    .replaceAll("\\]\\]", "]]")
    .replaceAll("\\\\", "\\")
    .trim();
}

/** Split a marker body on unescaped `|`. */
export function splitEscaped(value: string) {
  const parts: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (char === "\\" && next) {
      current += char + next;
      index += 1;
      continue;
    }

    if (char === "|") {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts.map(unescapeMarkerField);
}

/**
 * Reduce marker syntax back to the prose inside it.
 *
 * An `[[ir:…]]` marker collapses to its title field — the one part of a marker
 * that is language rather than packaging. A `[[rel:…]]` marker collapses to
 * nothing, because it carries no prose at all: two enum-ish fields and an id.
 * An `<inline-ref id="G12"/>` collapses to `G12`, so a sentence that referred to
 * a node still refers to it by name.
 *
 * This is decoding, not guessing. Nothing is invented; the title we keep is the
 * text the model itself put in the title position.
 */
export function stripInlineMarkers(value: string): string {
  let out = "";
  let cursor = 0;

  while (cursor < value.length) {
    if (value.startsWith(IR_PREFIX, cursor)) {
      const bodyStart = cursor + IR_PREFIX.length;
      const end = findMarkerEnd(value, bodyStart);

      if (end >= 0) {
        out += splitEscaped(value.slice(bodyStart, end))[1]?.trim() ?? "";
        cursor = end + 2;
        continue;
      }
    }

    if (value.startsWith(REL_PREFIX, cursor)) {
      const bodyStart = cursor + REL_PREFIX.length;
      const end = findMarkerEnd(value, bodyStart);

      if (end >= 0) {
        cursor = end + 2;
        continue;
      }
    }

    out += value[cursor];
    cursor += 1;
  }

  return out.replaceAll(INLINE_REF_RE, "$1");
}

/**
 * The title an extraction layer is allowed to write, or `null` to skip the
 * candidate.
 *
 * Salvage first: a title that is a whole well-formed marker still contains the
 * claim the model meant to make, and throwing that away would lose a real
 * judgment over a formatting error.
 *
 * Reject second: if `[[` or `]]` survives stripping, the marker was malformed —
 * we know the model was emitting protocol and we do not know what it meant.
 * Iron Law 2 decides that: miss the judgment rather than invent a title for it.
 * Skipping is only a legal outcome at the extraction sites, which is why this
 * lives there and not inside `createIRNodeForUser` — a writer that silently
 * rewrote titles would hide the mutation, and one that threw would take down a
 * whole run over a single bad candidate.
 */
export function sanitizeExtractedTitle(
  raw: string | null | undefined
): string | null {
  const stripped = stripInlineMarkers((raw ?? "").trim()).trim();

  if (!stripped || stripped.includes("[[") || stripped.includes("]]")) {
    return null;
  }

  return stripped;
}
