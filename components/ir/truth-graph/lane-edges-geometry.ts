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
//            same-row pairs): the amendment №2 behaviour, routed through
//            independent vertical channels in the left gutter.

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
export type LaneArrowDirection = "right" | "left" | "down";

export type LaneEdgePath = {
  edgeId: string;
  parentId: string;
  childId: string;
  path: string;
  // Arrow tip, sitting on the child's edge.
  arrow: { x: number; y: number };
  arrowDir: LaneArrowDirection;
  // Anchor for the hover label pill (left edge of the pill's baseline).
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
  // Spread between multiple edges touching one row's edge.
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

type VisualRow = {
  top: number;
  bottom: number;
  minLeft: number;
  boxes: LaneRowBox[];
};

type Point = { x: number; y: number };

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
    if (!last || Math.abs(last.x - point.x) > 0.5 || Math.abs(last.y - point.y) > 0.5) {
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
  const tracks: Array<Array<[number, number]>> = [];
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
  const readingOrder = (a: LaneRowBox, b: LaneRowBox, aRow: number, bRow: number) =>
    aRow - bRow || a.left - b.left;
  for (const list of byChild.values()) {
    list.sort((a, b) =>
      readingOrder(a.parent, b.parent, a.parentRow, b.parentRow)
    );
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => readingOrder(a.child, b.child, a.childRow, b.childRow));
  }

  // Gutter channels use vertical intervals; corridor lanes use horizontal
  // intervals grouped per corridor. Both are packed shortest-span-first.
  const gutterItems: Array<{ id: string; lo: number; hi: number; span: number }> =
    [];
  const corridorItems = new Map<
    number,
    Array<{ id: string; lo: number; hi: number; span: number }>
  >();

  type Prepared = Classified & {
    exitPoint: Point;
    entryPoint: Point;
    arrowDir: LaneArrowDirection;
    entryIndex: number | null;
    entryCount: number;
    corridor: number | null;
  };

  const prepared: Prepared[] = classified.map((item) => {
    const entrySiblings = byChild.get(item.edge.childId) ?? [];
    const exitSiblings = byParent.get(item.edge.parentId) ?? [];
    const entryCount = entrySiblings.length;
    const entryOrder = entrySiblings.indexOf(item);
    const exitOrder = exitSiblings.indexOf(item);
    const entryIndex = entryCount >= 2 ? entryOrder + 1 : null;

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
        arrowDir: item.parentOnLeft ? "right" : "left",
        corridor: null,
        entryCount,
        entryIndex,
        entryPoint: { x: entryX, y },
        exitPoint: { x: exitX, y },
      };
    }

    if (item.kind === "step") {
      // Spread along the horizontal edges: several premises entering one
      // node fan across its top edge instead of stacking on one point.
      const topEntrants = entrySiblings.filter((sibling) => sibling.kind === "step");
      const bottomExits = exitSiblings.filter((sibling) => sibling.kind === "step");
      const exitX = attachmentOffset({
        count: bottomExits.length,
        extent: item.parent.width,
        index: bottomExits.indexOf(item),
        spread: options.entrySpread * 2,
        start: item.parent.left,
      });
      const entryX = attachmentOffset({
        count: topEntrants.length,
        extent: item.child.width,
        index: topEntrants.indexOf(item),
        spread: options.entrySpread * 2,
        start: item.child.left,
      });
      const corridor = item.parentRow;
      const lo = Math.min(exitX, entryX);
      const hi = Math.max(exitX, entryX);
      const bucket = corridorItems.get(corridor) ?? [];
      bucket.push({ hi, id: item.edge.id, lo, span: hi - lo });
      corridorItems.set(corridor, bucket);

      return {
        ...item,
        arrowDir: "down",
        corridor,
        entryCount,
        entryIndex,
        entryPoint: { x: entryX, y: item.child.top - ROW_EDGE_INSET },
        exitPoint: { x: exitX, y: item.parent.top + item.parent.height },
      };
    }

    // Gutter: vertical span through the left channels.
    const exitY = attachmentOffset({
      count: exitSiblings.filter((sibling) => sibling.kind === "gutter").length,
      extent: item.parent.height,
      index: exitSiblings
        .filter((sibling) => sibling.kind === "gutter")
        .indexOf(item),
      spread: options.entrySpread,
      start: item.parent.top,
    });
    const entryY = attachmentOffset({
      count: entrySiblings.filter((sibling) => sibling.kind === "gutter").length,
      extent: item.child.height,
      index: entrySiblings
        .filter((sibling) => sibling.kind === "gutter")
        .indexOf(item),
      spread: options.entrySpread,
      start: item.child.top,
    });
    const lo = Math.min(exitY, entryY) - CHANNEL_OVERLAP_PAD;
    const hi = Math.max(exitY, entryY) + CHANNEL_OVERLAP_PAD;
    gutterItems.push({ hi, id: item.edge.id, lo, span: hi - lo });

    return {
      ...item,
      arrowDir: "right",
      corridor: null,
      entryCount,
      entryIndex,
      entryPoint: { x: item.child.left - ROW_EDGE_INSET, y: entryY },
      exitPoint: { x: item.parent.left - ROW_EDGE_INSET, y: exitY },
    };
  });

  const gutterChannel = packIntervals(gutterItems);
  const corridorLane = new Map<string, number>();
  for (const [corridor, items] of corridorItems) {
    const packed = packIntervals(items);
    for (const [id, lane] of packed) {
      corridorLane.set(`${corridor}:${id}`, lane);
    }
  }

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
      const corridorIndex = item.corridor as number;
      const corridorTop = visualRows[corridorIndex].bottom;
      const corridorBottom = visualRows[corridorIndex + 1].top;
      const lane = corridorLane.get(`${corridorIndex}:${item.edge.id}`) ?? 0;
      const maxLanes = Math.max(
        Math.floor((corridorBottom - corridorTop - 6) / options.hLaneGap),
        1
      );
      // Lanes hug the child row and stack upward into the corridor.
      const laneY = Math.max(
        corridorBottom - 4 - Math.min(lane, maxLanes - 1) * options.hLaneGap,
        corridorTop + 2
      );
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
      labelAt = { x: arrow.x + 6, y: arrow.y - 6 };
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
      const base = { x: arrow.x - arrowLength, y: arrow.y };
      path = roundedPolyline(
        [
          item.exitPoint,
          { x: channelX, y: item.exitPoint.y },
          { x: channelX, y: arrow.y },
          base,
        ],
        cornerRadius
      );
      labelAt = { x: arrow.x + 4, y: arrow.y - LABEL_RISE };
      badgeAt =
        item.entryIndex === null
          ? null
          : { x: base.x - BADGE_OFFSET, y: arrow.y };
    }

    return {
      arrow: { x: round(arrow.x), y: round(arrow.y) },
      arrowDir: item.arrowDir,
      badgeAt: badgeAt
        ? { x: round(badgeAt.x), y: round(badgeAt.y) }
        : null,
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
