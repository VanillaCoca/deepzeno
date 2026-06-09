/**
 * ZENO brand mark.
 *
 * Rendered as a CSS mask over `currentColor` so a SINGLE asset serves both
 * themes: set the text color on the element (we use `text-sidebar-foreground`)
 * and the mark is black in light mode / white in dark mode — no second asset.
 *
 * The mask (`public/zeno-logo-mask.png`) is a bold profile silhouette built
 * from the source art (`public/zeno-logo2.png`): flood-fill the line-art
 * outline into a solid shape, then carve a few key interior strokes back out
 * as negative space so it stays legible at 24-28px. Regenerate with sharp
 * (alpha → seal → flood-fill → carve → tight-crop) after a logo change; the
 * component wiring below never changes.
 */
const MASK_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/zeno-logo-mask.png`;

export function ZenoLogo({ className }: { className?: string }) {
  return (
    <span
      aria-label="ZENO"
      className={className}
      role="img"
      style={{
        display: "inline-block",
        backgroundColor: "currentColor",
        WebkitMaskImage: `url("${MASK_URL}")`,
        maskImage: `url("${MASK_URL}")`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
