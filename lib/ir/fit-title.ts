const PADDING_PX = 16; // node inner horizontal padding (both sides)

function glyphWidth(ch: string, fontPx: number) {
  // CJK / full-width 　-鿿＀-￯ — 1em; latin/space/punct — 0.55em
  return /[　-鿿＀-￯]/.test(ch) ? fontPx : fontPx * 0.55;
}

export function fitTitleToWidth(
  title: string,
  boxWidthPx: number,
  fontPx: number
) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const budget = boxWidthPx - PADDING_PX;
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
