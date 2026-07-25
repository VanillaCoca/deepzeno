/**
 * The shared surface of the chrome that floats over the stage.
 *
 * The header and the activity/change row are two rows of one object: a
 * translucent panel that sits *over* the stage instead of displacing it. They
 * have to come from a single definition rather than two that happen to match
 * today — the moment they drift, the second row stops reading as part of the
 * header and starts reading as a stray component that landed nearby.
 *
 * Only the surface lives here. Layout is the caller's: the header's islands are
 * fixed-height inline chips, while the activity row is a block that grows when
 * it expands.
 */
export const ISLAND_SURFACE =
  "pointer-events-auto rounded-xl border border-[var(--ir-border-default)] bg-[color-mix(in_srgb,var(--ir-bg-panel)_72%,transparent)] backdrop-blur-md";

/** The header's chip form: fixed height, inline, tight padding. */
export const ISLAND = `${ISLAND_SURFACE} inline-flex h-9 items-center gap-1 px-1.5`;
