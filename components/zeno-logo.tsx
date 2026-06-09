/**
 * ZENO brand mark.
 *
 * Rendered as a CSS mask over `currentColor` so a SINGLE asset serves both
 * themes: set the text color on the element (we use `text-sidebar-foreground`)
 * and the mark is black in light mode / white in dark mode — no second asset.
 *
 * The mask (`public/zeno-logo-mask.png`) is a tight alpha silhouette derived
 * pixel-for-pixel from the supplied logo, so the shape is exact. To refresh it
 * after a logo change, re-run the binarize→trim→alpha step against the source
 * art; the component wiring below never needs to change.
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
