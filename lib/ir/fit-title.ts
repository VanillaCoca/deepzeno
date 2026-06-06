const PADDING_PX = 16; // node inner horizontal padding (both sides)

function glyphWidth(ch: string, fontPx: number) {
  // CJK / full-width 　-鿿＀-￯ — 1em; latin/space/punct — 0.55em
  return /[　-鿿＀-￯]/.test(ch) ? fontPx : fontPx * 0.55;
}

function isCjk(ch: string) {
  return /[　-鿿＀-￯]/.test(ch);
}

function widthOf(text: string, fontPx: number) {
  return [...text].reduce((sum, ch) => sum + glyphWidth(ch, fontPx), 0);
}

/**
 * Greedy line wrap that never truncates. CJK breaks per character; latin
 * breaks at spaces, and an overlong latin word falls back to per-character
 * breaking. `reserveText` shrinks only the first line's budget (for an
 * indicator prefix/suffix the caller renders separately).
 */
export function wrapTitleToLines(
  title: string,
  boxWidthPx: number,
  fontPx: number,
  reserveText = ""
): string[] {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [""];
  }

  const fullBudget = Math.max(1, boxWidthPx - PADDING_PX);
  const reserveWidth = widthOf(reserveText, fontPx);
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;
  let breakAt = -1; // index in `line` where a space allows a break

  const budget = () =>
    Math.max(1, fullBudget - (lines.length === 0 ? reserveWidth : 0));

  for (const ch of normalized) {
    const w = glyphWidth(ch, fontPx);

    if (line !== "" && lineWidth + w > budget()) {
      if (!isCjk(ch) && breakAt >= 0 && breakAt < line.length) {
        const head = line.slice(0, breakAt).trimEnd();
        const tail = line.slice(breakAt).trimStart();
        lines.push(head);
        line = tail;
        lineWidth = widthOf(line, fontPx);
      } else {
        lines.push(line.trimEnd());
        line = "";
        lineWidth = 0;
      }
      breakAt = -1;
    }

    if (ch === " ") {
      if (line === "") {
        continue;
      }
      line += ch;
      lineWidth += w;
      breakAt = line.length;
      continue;
    }

    line += ch;
    lineWidth += w;
    if (isCjk(ch)) {
      breakAt = line.length;
    }
  }

  if (line.trimEnd() !== "" || lines.length === 0) {
    lines.push(line.trimEnd());
  }
  return lines;
}

export function fitTitleToWidth(
  title: string,
  boxWidthPx: number,
  fontPx: number,
  reserveText = ""
) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const reserveWidth = [...reserveText].reduce(
    (sum, ch) => sum + glyphWidth(ch, fontPx),
    0
  );
  const budget = Math.max(0, boxWidthPx - PADDING_PX - reserveWidth);
  let used = 0;
  let out = "";
  for (const ch of normalized) {
    const w = glyphWidth(ch, fontPx);
    if (used + w > budget) {
      const ellipsisW = glyphWidth("…", fontPx);
      while (out && used + ellipsisW > budget) {
        const chars = [...out];
        const last = chars.at(-1) as string;
        out = chars.slice(0, -1).join("");
        used -= glyphWidth(last, fontPx);
      }
      return `${out}…`;
    }
    out += ch;
    used += w;
  }
  return out;
}
