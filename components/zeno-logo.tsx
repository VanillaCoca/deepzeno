/**
 * ZENO brand mark.
 *
 * Drawn with `fill="currentColor"` so a SINGLE asset serves both themes: set
 * the text color on the element (we use `text-sidebar-foreground`) and the mark
 * is black in light mode and white in dark mode — no second asset needed.
 *
 * NOTE: the path below is a faithful-as-possible recreation of the supplied
 * black mark (a bold "R" whose leg flows into a road). To drop in the exact
 * vector later, replace ONLY the two <path d="…"> values — the theming wiring
 * stays the same. (If you save the source PNG to /public, it can be traced to
 * SVG and pasted here.)
 */
export function ZenoLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      role="img"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>ZENO</title>
      {/* Body: bold top bar + hooked right + diagonal leg */}
      <path
        d="M32 20 H64 C74 20 82 28 82 38 C82 46 77 53 69 56 L46 73 C41 76 34 75 31 70 C28 65 29 58 34 55 L55 39 H32 C26 39 21 35 21 29 C21 24 26 20 32 20 Z"
        fill="currentColor"
      />
      {/* Road: a tapered band sweeping to the lower-right */}
      <path
        d="M42 63 C56 75 72 79 86 78 L86 89 C70 90 51 85 35 71 Z"
        fill="currentColor"
      />
    </svg>
  );
}
