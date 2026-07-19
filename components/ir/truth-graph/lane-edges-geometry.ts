// Pure geometry for the semantic-lanes quiet dependency edges (rules
// amendments №2 and №3). No React, no DOM — node:test covers it directly.
//
// The overview keeps its "position carries structure" layout; these edges are
// a bounded exception to v1 §1.1 (no lines by default): only depends_on /
// implies edges between two visible top-level rows of the same topic draw.
//
// Amendment №3 lets a lane hold several nodes per visual row, so a single
// left-gutter routing no longer fits every edge. Three routes instead
// (see docs/zeno-truth-graph-rules-amendment-3.md):
//
//   tight  — same visual row, horizontally adjacent: a short straight
//            horizontal arrow (v1 §4.4 keeps same-row hops straight).
//   step   — parent's row is directly above the child's: leave the parent's
//            bottom edge, cross the row corridor on a horizontal lane, enter
//            the child's top edge. Several premises feeding one node spread
//            along its top edge and read ①②③ left-to-right.
//   gutter — everything else (long spans, upward edges, non-adjacent
//            same-row pairs): routed through independent vertical channels
//            in the left gutter.
//
// Attach sides (the amendment №3 invariant that keeps multi-column lanes
// legible): a gutter edge may only touch a box's LEFT edge when that box is
// the leftmost of its visual row — otherwise the horizontal run would cross
// every sibling cell between the gutter and the box. Any other cell is
// entered/left through its TOP or BOTTOM edge via the corridor between rows,
// where horizontal lanes are packed to never overlap. Edges never cross a
// box interior.

export type LaneRowBox = {
  id: string;
  // Container-relative box of the rendered row/card for this node.
  top: number;
  height: number;
  left: number;
  width: number;
};

export type LaneEdgeInput = {
  id: string;
  // Graph parent = the premise / earlier event the child builds on.
  parentId: string;
  childId: string;
};

export type LaneEdgeKind = "tight" | "step" | "gutter";
export type LaneArrowDirection = "right" | "left" | "down" | "up";

export type LaneEdgePath = {
  edgeId: string;
  parentId: string;
  childId: string;
  path: string;
  // Arrow tip, sitting on the child's edge.
  arrow: { x: number; y: number };
  arrowDir: LaneArrowDirection;
  // Anchor for the hover label pill. For horizontal arrows it is the pill's
  // left edge at baseline; for vertical arrows it is the pill's horizontal
  // CENTRE (the renderer centres the measured pill on it).
  labelAt: { x: number; y: number };
  // Centre of the ①② convergence badge, or null when this edge is the
  // child's only drawn in-edge.
  badgeAt: { x: number; y: number } | null;
  // 1-based convergence number when the child has ≥2 drawn in-edges
  // (v1 §5.3 — parallel premises get ①②); null for single entries.
  entryIndex: number | null;
  entryCount: number;
  // Gutter channel index; 0 for tight/step edges (they use corridor lanes).
  channel: number;
  kind: LaneEdgeKind;
};

export type LaneEdgeGeometryOptions = {
  // Width of the reserved left gutter the vertical channels live in.
  gutterWidth: number;
  // Horizontal distance between adjacent vertical channels.
  channelGap: number;
  cornerRadius: number;
  // Spread between multiple edges touching one row's edge. Must be at least
  // the ①② badge diameter, or converging badges overlap.
  entrySpread: number;
  arrowLength: number;
  // Vertical distance between horizontal lanes inside one row corridor.
  hLaneGap: number;
  // Largest horizontal gap two same-row nodes may have and still be joined
  // by a straight tight arrow.
  tightMaxGap: number;
  // A step edge whose endpoints are further apart than this horizontally
  // would drag a long jog across the corridor — it falls back to the gutter.
  stepMaxJog: number;
};

const CHANNEL_OVERLAP_PAD = 4;
const ROW_EDGE_INSET = 2;
// Fraction of the shorter box that must overlap vertically for two boxes to
// count as the same visual row.
const ROW_OVERLAP_RATIO = 0.5;
const EDGE_MARGIN = 8;
const BADGE_OFFSET = 8;
const LABEL_RISE = 12;
// Height of the virtual corridors above the first and below the last row.
const OUTER_CORRIDOR = 24;

type VisualRow = {
  top: number;
  bottom: number;
  minLeft: number;
  boxes: LaneRowBox[];
};

type Point = { x: number; y: number };

type AttachSide = "left" | "right" | "top" | "bottom";

function round(value: number) {
  return Math.round(value * 100) / 100;
}

// Group boxes into visual rows: a multi-column lane renders its cells at the
// same height (flex stretch), so vertical overlap is a reliable signal.
function clusterRows(rows: LaneRowBox[]): VisualRow[] {
  const sorted = [...rows].sort((a, b) => a.top - b.top || a.left - b.left);
  const clusters: VisualRow[] = [];

  for (const box of sorted) {
    const current = clusters.at(-1);
    const bottom = box.top + box.height;
    const overlap = current
      ? Math.min(current.bottom, bottom) - Math.max(current.top, box.top)
      : 0;
    const threshold =
      ROW_OVERLAP_RATIO *
      Math.min(box.height, current ? current.bottom - current.top : box.height);

    if (current && overlap >= threshold) {
      current.boxes.push(box);
      current.top = Math.min(current.top, box.top);
      current.bottom = Math.max(current.bottom, bottom);
      current.minLeft = Math.min(current.minLeft, box.left);
    } else {
      clusters.push({
        bottom,
        boxes: [box],
        minLeft: box.left,
        top: box.top,
      });
    }
  }

  for (const cluster of clusters) {
    cluster.boxes.sort((a, b) => a.left - b.left);
  }
  return clusters;
}

// Spread N attachment points across a row's edge so several edges touching
// one row never overlap. Works for both axes (vertical edge → y, horizontal
// edge → x); `extent` is the box's height or width.
function attachmentOffset({
  start,
  extent,
  index,
  count,
  spread,
}: {
  start: number;
  extent: number;
  index: number;
  count: number;
  spread: number;
}) {
  const centre = start + extent / 2;
  const maxSpan = Math.max(extent - EDGE_MARGIN, 0);
  const step = count > 1 ? Math.min(spread, maxSpan / (count - 1)) : 0;
  return centre + (index - (count - 1) / 2) * step;
}

// Generic rounded orthogonal polyline. Corners shrink to fit their shorter
// neighbouring segment, and a degenerate corner falls back to a hard vertex.
function roundedPolyline(points: Point[], cornerRadius: number): string {
  const pts: Point[] = [];
  for (const point of points) {
    const last = pts.at(-1);
    if (
      !last ||
      Math.abs(last.x - point.x) > 0.5 ||
      Math.abs(last.y - point.y) > 0.5
    ) {
      pts.push(point);
    }
  }

  if (pts.length < 2) {
    return "";
  }

  const first = pts[0];
  let d = `M ${round(first.x)} ${round(first.y)}`;

  for (let index = 1; index < pts.length - 1; index += 1) {
    const prev = pts[index - 1];
    const corner = pts[index];
    const next = pts[index + 1];
    const inLength = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(cornerRadius, inLength / 2, outLength / 2);

    if (radius < 0.5) {
      d += ` L ${round(corner.x)} ${round(corner.y)}`;
      continue;
    }

    const inUnitX = (corner.x - prev.x) / inLength;
    const inUnitY = (corner.y - prev.y) / inLength;
    const outUnitX = (next.x - corner.x) / outLength;
    const outUnitY = (next.y - corner.y) / outLength;

    d += ` L ${round(corner.x - inUnitX * radius)} ${round(corner.y - inUnitY * radius)}`;
    d += ` Q ${round(corner.x)} ${round(corner.y)} ${round(corner.x + outUnitX * radius)} ${round(corner.y + outUnitY * radius)}`;
  }

  const last = pts.at(-1) as Point;
  d += ` L ${round(last.x)} ${round(last.y)}`;
  return d;
}

// Greedy interval packing shared by both channel systems: shortest spans
// claim the innermost track, and a track is reusable when intervals miss.
function packIntervals(
  items: Array<{ id: string; lo: number; hi: number; span: number }>
): Map<string, number> {
  const sorted = [...items].sort(
    (a, b) => a.span - b.span || a.id.localeCompare(b.id)
  );
  const tracks: [number, number][][] = [];
  const trackById = new Map<string, number>();

  for (const item of sorted) {
    let track = tracks.findIndex((intervals) =>
      intervals.every(([lo, hi]) => item.hi < lo || item.lo > hi)
    );
    if (track === -1) {
      track = tracks.length;
      tracks.push([]);
    }
    tracks[track].push([item.lo, item.hi]);
    trackById.set(item.id, track);
  }

  return trackById;
}

type Classified = {
  edge: LaneEdgeInput;
  parent: LaneRowBox;
  child: LaneRowBox;
  parentRow: number;
  childRow: number;
  kind: LaneEdgeKind;
  // Tight edges only: which endpoint sits on the left.
  parentOnLeft: boolean;
};

function classify({
  edge,
  parent,
  child,
  parentRow,
  childRow,
  rows,
  options,
}: {
  edge: LaneEdgeInput;
  parent: LaneRowBox;
  child: LaneRowBox;
  parentRow: number;
  childRow: number;
  rows: VisualRow[];
  options: LaneEdgeGeometryOptions;
}): Classified {
  const parentOnLeft = parent.left <= child.left;
  const base = { child, edge, parent, parentOnLeft, parentRow, childRow };

  if (parentRow === childRow) {
    const leftBox = parentOnLeft ? parent : child;
    const rightBox = parentOnLeft ? child : parent;
    const gap = rightBox.left - (leftBox.left + leftBox.width);
    const blocked = rows[parentRow].boxes.some(
      (box) =>
        box.id !== leftBox.id &&
        box.id !== rightBox.id &&
        box.left + box.width > leftBox.left + leftBox.width &&
        box.left < rightBox.left
    );

    if (gap >= 0 && gap <= options.tightMaxGap && !blocked) {
      return { ...base, kind: "tight" };
    }
    return { ...base, kind: "gutter" };
  }

  // Step routing exists to serve multi-column lanes. When both endpoints are
  // alone on their row (the single-column layout amendment №2 was designed
  // for), the proven gutter route still reads best — two stacked full-width
  // rows joined by a stub through their 2px gap would not.
  const multiColumn =
    rows[parentRow].boxes.length > 1 || rows[childRow].boxes.length > 1;

  if (childRow === parentRow + 1 && multiColumn) {
    const parentCentre = parent.left + parent.width / 2;
    const childCentre = child.left + child.width / 2;
    if (Math.abs(parentCentre - childCentre) <= options.stepMaxJog) {
      return { ...base, kind: "step" };
    }
  }

  return { ...base, kind: "gutter" };
}

// The attach side of each endpoint (amendment №3). Left is only legal for a
// row's leftmost box; anything else goes through the corridor on the side
// facing the other endpoint.
function sidesFor(
  item: Classified,
  rows: VisualRow[]
): {
  parentSide: AttachSide;
  childSide: AttachSide;
  parentCorridor: number | null;
  childCorridor: number | null;
  arrowDir: LaneArrowDirection;
} {
  if (item.kind === "tight") {
    return {
      arrowDir: item.parentOnLeft ? "right" : "left",
      childCorridor: null,
      childSide: item.parentOnLeft ? "left" : "right",
      parentCorridor: null,
      parentSide: item.parentOnLeft ? "right" : "left",
    };
  }

  if (item.kind === "step") {
    return {
      arrowDir: "down",
      childCorridor: item.childRow - 1,
      childSide: "top",
      parentCorridor: item.parentRow,
      parentSide: "bottom",
    };
  }

  const parentLeftmost = rows[item.parentRow].boxes[0]?.id === item.parent.id;
  const childLeftmost = rows[item.childRow].boxes[0]?.id === item.child.id;
  const sameRow = item.parentRow === item.childRow;
  const downward = item.childRow > item.parentRow;

  const childSide: AttachSide = childLeftmost
    ? "left"
    : sameRow || downward
      ? "top"
      : "bottom";
  const parentSide: AttachSide = parentLeftmost
    ? "left"
    : sameRow || !downward
      ? "top"
      : "bottom";

  return {
    arrowDir:
      childSide === "left" ? "right" : childSide === "top" ? "down" : "up",
    childCorridor:
      childSide === "top"
        ? item.childRow - 1
        : childSide === "bottom"
          ? item.childRow
          : null,
    childSide,
    parentCorridor:
      parentSide === "top"
        ? item.parentRow - 1
        : parentSide === "bottom"
          ? item.parentRow
          : null,
    parentSide,
  };
}

export function computeLaneEdgePaths({
  rows,
  edges,
  options,
}: {
  rows: LaneRowBox[];
  edges: LaneEdgeInput[];
  options: LaneEdgeGeometryOptions;
}): LaneEdgePath[] {
  const boxById = new Map(rows.map((row) => [row.id, row]));

  // Only edges whose two endpoints are actually rendered (a collapsed
  // <details> reports zero-height boxes and drops out here).
  const drawable = edges.filter((edge) => {
    const parent = boxById.get(edge.parentId);
    const child = boxById.get(edge.childId);
    return (
      parent !== undefined &&
      child !== undefined &&
      parent.height > 0 &&
      child.height > 0 &&
      edge.parentId !== edge.childId
    );
  });

  if (drawable.length === 0) {
    return [];
  }

  const visualRows = clusterRows(rows.filter((row) => row.height > 0));
  const rowIndexById = new Map<string, number>();
  visualRows.forEach((row, index) => {
    for (const box of row.boxes) {
      rowIndexById.set(box.id, index);
    }
  });

  // Corridors sit between consecutive visual rows; -1 and rows.length-1 are
  // thin virtual bands above the first / below the last row, so endpoints on
  // the outermost rows still have somewhere to run their horizontal jog.
  function corridorBounds(index: number): { top: number; bottom: number } {
    if (index < 0) {
      return {
        bottom: visualRows[0].top,
        top: visualRows[0].top - OUTER_CORRIDOR,
      };
    }
    if (index >= visualRows.length - 1) {
      const last = visualRows.at(-1) as VisualRow;
      return { bottom: last.bottom + OUTER_CORRIDOR, top: last.bottom };
    }
    return { bottom: visualRows[index + 1].top, top: visualRows[index].bottom };
  }

  // One shared y-mapping per corridor: lanes hug the corridor's bottom (the
  // next row's top edge, minus room for the arrowhead) and stack upward.
  // Every horizontal run in a corridor uses this mapping, so distinct lanes
  // can never share a y.
  function laneYFor(corridor: number, lane: number) {
    const bounds = corridorBounds(corridor);
    return Math.max(
      bounds.bottom -
        (options.arrowLength + ROW_EDGE_INSET) -
        lane * options.hLaneGap,
      bounds.top + 2
    );
  }

  const classified = drawable.map((edge) => {
    const parent = boxById.get(edge.parentId) as LaneRowBox;
    const child = boxById.get(edge.childId) as LaneRowBox;
    return classify({
      child,
      childRow: rowIndexById.get(edge.childId) ?? 0,
      edge,
      options,
      parent,
      parentRow: rowIndexById.get(edge.parentId) ?? 0,
      rows: visualRows,
    });
  });

  // Convergence order (amendment №3): premises read top-to-bottom, then
  // left-to-right within a visual row — the same order a reader scans them.
  const byChild = new Map<string, Classified[]>();
  const byParent = new Map<string, Classified[]>();
  for (const item of classified) {
    byChild.set(item.edge.childId, [
      ...(byChild.get(item.edge.childId) ?? []),
      item,
    ]);
    byParent.set(item.edge.parentId, [
      ...(byParent.get(item.edge.parentId) ?? []),
      item,
    ]);
  }
  const readingOrder = (
    a: LaneRowBox,
    b: LaneRowBox,
    aRow: number,
    bRow: number
  ) => aRow - bRow || a.left - b.left;
  for (const list of byChild.values()) {
    list.sort((a, b) =>
      readingOrder(a.parent, b.parent, a.parentRow, b.parentRow)
    );
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => readingOrder(a.child, b.child, a.childRow, b.childRow));
  }

  const sides = new Map(
    classified.map((item) => [item.edge.id, sidesFor(item, visualRows)])
  );

  // Attachment pools: edges touching the same box edge spread jointly, no
  // matter which route brought them there (a step entry and a gutter-top
  // entry into one node must not stack on the same point).
  const entryPools = new Map<string, string[]>();
  const exitPools = new Map<string, string[]>();
  for (const [childId, list] of byChild) {
    for (const item of list) {
      const side = sides.get(item.edge.id)?.childSide as AttachSide;
      const key = `${childId}|${side}`;
      entryPools.set(key, [...(entryPools.get(key) ?? []), item.edge.id]);
    }
  }
  for (const [parentId, list] of byParent) {
    for (const item of list) {
      const side = sides.get(item.edge.id)?.parentSide as AttachSide;
      const key = `${parentId}|${side}`;
      exitPools.set(key, [...(exitPools.get(key) ?? []), item.edge.id]);
    }
  }

  function poolOffset({
    pools,
    nodeId,
    side,
    edgeId,
    box,
    spread,
  }: {
    pools: Map<string, string[]>;
    nodeId: string;
    side: AttachSide;
    edgeId: string;
    box: LaneRowBox;
    spread: number;
  }) {
    const pool = pools.get(`${nodeId}|${side}`) ?? [edgeId];
    const horizontal = side === "top" || side === "bottom";
    return attachmentOffset({
      count: pool.length,
      extent: horizontal ? box.width : box.height,
      index: pool.indexOf(edgeId),
      spread,
      start: horizontal ? box.left : box.top,
    });
  }

  // Corridor lane packing: every horizontal run in a corridor claims an
  // x-interval. Gutter-attached runs extend to the gutter (x=0) so parallel
  // runs from the channels always take distinct lanes.
  const corridorItems = new Map<
    number,
    Array<{ id: string; lo: number; hi: number; span: number }>
  >();
  function registerCorridorRun(
    corridor: number,
    id: string,
    a: number,
    b: number
  ) {
    const lo = Math.min(a, b) - 2;
    const hi = Math.max(a, b) + 2;
    const bucket = corridorItems.get(corridor) ?? [];
    bucket.push({ hi, id, lo, span: hi - lo });
    corridorItems.set(corridor, bucket);
  }

  type Prepared = Classified & {
    parentSide: AttachSide;
    childSide: AttachSide;
    parentCorridor: number | null;
    childCorridor: number | null;
    arrowDir: LaneArrowDirection;
    exitPoint: Point;
    entryPoint: Point;
    entryIndex: number | null;
    entryCount: number;
  };

  const prepared: Prepared[] = classified.map((item) => {
    const side = sides.get(item.edge.id) as ReturnType<typeof sidesFor>;
    const entrySiblings = byChild.get(item.edge.childId) ?? [];
    const entryCount = entrySiblings.length;
    const entryIndex = entryCount >= 2 ? entrySiblings.indexOf(item) + 1 : null;

    if (item.kind === "tight") {
      // Same visual row → equal heights, so one shared centre line reads
      // cleanest and keeps the arrow perfectly horizontal (v1 §4.4).
      const y =
        (item.parent.top +
          item.parent.height / 2 +
          item.child.top +
          item.child.height / 2) /
        2;
      const exitX = item.parentOnLeft
        ? item.parent.left + item.parent.width + ROW_EDGE_INSET
        : item.parent.left - ROW_EDGE_INSET;
      const entryX = item.parentOnLeft
        ? item.child.left - ROW_EDGE_INSET
        : item.child.left + item.child.width + ROW_EDGE_INSET;
      return {
        ...item,
        ...side,
        entryCount,
        entryIndex,
        entryPoint: { x: entryX, y },
        exitPoint: { x: exitX, y },
      };
    }

    // Entry anchor (arrow tip) on the child edge.
    let entryPoint: Point;
    if (side.childSide === "left") {
      entryPoint = {
        x: item.child.left - ROW_EDGE_INSET,
        y: poolOffset({
          box: item.child,
          edgeId: item.edge.id,
          nodeId: item.edge.childId,
          pools: entryPools,
          side: "left",
          spread: options.entrySpread,
        }),
      };
    } else {
      const x = poolOffset({
        box: item.child,
        edgeId: item.edge.id,
        nodeId: item.edge.childId,
        pools: entryPools,
        side: side.childSide,
        spread: options.entrySpread * 2,
      });
      entryPoint =
        side.childSide === "top"
          ? { x, y: item.child.top - ROW_EDGE_INSET }
          : { x, y: item.child.top + item.child.height + ROW_EDGE_INSET };
    }

    // Exit anchor on the parent edge.
    let exitPoint: Point;
    if (side.parentSide === "left") {
      exitPoint = {
        x: item.parent.left - ROW_EDGE_INSET,
        y: poolOffset({
          box: item.parent,
          edgeId: item.edge.id,
          nodeId: item.edge.parentId,
          pools: exitPools,
          side: "left",
          spread: options.entrySpread,
        }),
      };
    } else {
      const x = poolOffset({
        box: item.parent,
        edgeId: item.edge.id,
        nodeId: item.edge.parentId,
        pools: exitPools,
        side: side.parentSide,
        spread: options.entrySpread * 2,
      });
      exitPoint =
        side.parentSide === "top"
          ? { x, y: item.parent.top }
          : { x, y: item.parent.top + item.parent.height };
    }

    if (item.kind === "step") {
      registerCorridorRun(
        side.parentCorridor as number,
        item.edge.id,
        exitPoint.x,
        entryPoint.x
      );
    } else {
      if (side.parentCorridor !== null) {
        registerCorridorRun(
          side.parentCorridor,
          `${item.edge.id}:p`,
          0,
          exitPoint.x
        );
      }
      if (side.childCorridor !== null) {
        registerCorridorRun(
          side.childCorridor,
          `${item.edge.id}:c`,
          0,
          entryPoint.x
        );
      }
    }

    return {
      ...item,
      ...side,
      entryCount,
      entryIndex,
      entryPoint,
      exitPoint,
    };
  });

  const corridorLane = new Map<string, number>();
  for (const [corridor, items] of corridorItems) {
    const packed = packIntervals(items);
    for (const [id, lane] of packed) {
      corridorLane.set(`${corridor}:${id}`, lane);
    }
  }

  // Gutter channel packing over vertical spans. Corridor-attached endpoints
  // approximate their y with the corridor midpoint — exact lane y is at most
  // half a corridor away, well inside the overlap pad.
  const gutterItems: Array<{
    id: string;
    lo: number;
    hi: number;
    span: number;
  }> = [];
  const corridorMid = (index: number) => {
    const bounds = corridorBounds(index);
    return (bounds.top + bounds.bottom) / 2;
  };
  for (const item of prepared) {
    if (item.kind !== "gutter") {
      continue;
    }
    const yExit =
      item.parentSide === "left"
        ? item.exitPoint.y
        : corridorMid(item.parentCorridor as number);
    const yEntry =
      item.childSide === "left"
        ? item.entryPoint.y
        : corridorMid(item.childCorridor as number);
    gutterItems.push({
      hi: Math.max(yExit, yEntry) + CHANNEL_OVERLAP_PAD,
      id: item.edge.id,
      lo: Math.min(yExit, yEntry) - CHANNEL_OVERLAP_PAD,
      span: Math.abs(yExit - yEntry) + 2 * CHANNEL_OVERLAP_PAD,
    });
  }
  const gutterChannel = packIntervals(gutterItems);

  const maxChannels = Math.max(
    Math.floor((options.gutterWidth - EDGE_MARGIN) / options.channelGap),
    1
  );

  return prepared.map((item): LaneEdgePath => {
    const { arrowLength, cornerRadius } = options;
    let path = "";
    let arrow: Point;
    let labelAt: Point;
    let badgeAt: Point | null = null;
    let channel = 0;

    if (item.kind === "tight") {
      const sign = item.arrowDir === "right" ? 1 : -1;
      arrow = item.entryPoint;
      const base = { x: arrow.x - sign * arrowLength, y: arrow.y };
      // A narrow column gap can leave less room than the arrowhead needs;
      // never emit a backwards shaft — the arrowhead alone still reads.
      const start =
        sign * (base.x - item.exitPoint.x) > 0 ? item.exitPoint : base;
      path = roundedPolyline([start, base], cornerRadius);
      labelAt = {
        x: Math.min(start.x, base.x) + 2,
        y: arrow.y - LABEL_RISE,
      };
      badgeAt =
        item.entryIndex === null
          ? null
          : { x: base.x - sign * BADGE_OFFSET, y: arrow.y };
    } else if (item.kind === "step") {
      const corridor = item.parentCorridor as number;
      const lane = corridorLane.get(`${corridor}:${item.edge.id}`) ?? 0;
      const laneY = laneYFor(corridor, lane);
      arrow = item.entryPoint;
      const base = { x: arrow.x, y: arrow.y - arrowLength };
      path = roundedPolyline(
        [
          item.exitPoint,
          { x: item.exitPoint.x, y: laneY },
          { x: base.x, y: laneY },
          base,
        ],
        cornerRadius
      );
      labelAt = { x: arrow.x, y: base.y - 6 };
      badgeAt =
        item.entryIndex === null
          ? null
          : { x: arrow.x, y: base.y - BADGE_OFFSET };
    } else {
      channel = Math.min(gutterChannel.get(item.edge.id) ?? 0, maxChannels - 1);
      const channelX = Math.max(
        options.gutterWidth - 6 - channel * options.channelGap,
        3
      );
      arrow = item.entryPoint;

      const points: Point[] = [item.exitPoint];
      // Parent → gutter.
      if (item.parentSide === "left") {
        points.push({ x: channelX, y: item.exitPoint.y });
      } else {
        const lane =
          corridorLane.get(`${item.parentCorridor}:${item.edge.id}:p`) ?? 0;
        const laneY = laneYFor(item.parentCorridor as number, lane);
        points.push(
          { x: item.exitPoint.x, y: laneY },
          { x: channelX, y: laneY }
        );
      }
      // Gutter → child.
      let base: Point;
      if (item.childSide === "left") {
        base = { x: arrow.x - arrowLength, y: arrow.y };
        points.push({ x: channelX, y: arrow.y }, base);
        labelAt = { x: arrow.x + 4, y: arrow.y - LABEL_RISE };
        badgeAt =
          item.entryIndex === null
            ? null
            : { x: base.x - BADGE_OFFSET, y: arrow.y };
      } else if (item.childSide === "top") {
        const lane =
          corridorLane.get(`${item.childCorridor}:${item.edge.id}:c`) ?? 0;
        const laneY = laneYFor(item.childCorridor as number, lane);
        base = { x: arrow.x, y: arrow.y - arrowLength };
        points.push({ x: channelX, y: laneY }, { x: arrow.x, y: laneY }, base);
        labelAt = { x: arrow.x, y: base.y - 6 };
        badgeAt =
          item.entryIndex === null
            ? null
            : { x: arrow.x, y: base.y - BADGE_OFFSET };
      } else {
        const lane =
          corridorLane.get(`${item.childCorridor}:${item.edge.id}:c`) ?? 0;
        const laneY = laneYFor(item.childCorridor as number, lane);
        base = { x: arrow.x, y: arrow.y + arrowLength };
        points.push({ x: channelX, y: laneY }, { x: arrow.x, y: laneY }, base);
        labelAt = { x: arrow.x, y: base.y + LABEL_RISE + 2 };
        badgeAt =
          item.entryIndex === null
            ? null
            : { x: arrow.x, y: base.y + BADGE_OFFSET };
      }
      path = roundedPolyline(points, cornerRadius);
    }

    return {
      arrow: { x: round(arrow.x), y: round(arrow.y) },
      arrowDir: item.arrowDir,
      badgeAt: badgeAt ? { x: round(badgeAt.x), y: round(badgeAt.y) } : null,
      channel,
      childId: item.edge.childId,
      edgeId: item.edge.id,
      entryCount: item.entryCount,
      entryIndex: item.entryIndex,
      kind: item.kind,
      labelAt: { x: round(labelAt.x), y: round(labelAt.y) },
      parentId: item.edge.parentId,
      path,
    };
  });
}
