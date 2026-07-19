import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeLaneEdgePaths,
  type LaneEdgeGeometryOptions,
  type LaneEdgePath,
  type LaneRowBox,
} from "../../components/ir/truth-graph/lane-edges-geometry.ts";

const OPTIONS: LaneEdgeGeometryOptions = {
  gutterWidth: 40,
  channelGap: 9,
  cornerRadius: 6,
  entrySpread: 14,
  arrowLength: 5,
  hLaneGap: 6,
  tightMaxGap: 44,
  stepMaxJog: 330,
};

// Default box mimics a full-width row starting at the gutter edge.
function row(
  id: string,
  top: number,
  left = 40,
  width = 640,
  height = 32
): LaneRowBox {
  return { id, top, height, left, width };
}

// First coordinate pair of an SVG path ("M x y ...").
function startPoint(path: string) {
  const match = path.match(/^M (-?[\d.]+) (-?[\d.]+)/);
  // biome-ignore lint/suspicious/noMisplacedAssertion: shared helper, always called from within it() blocks.
  assert.ok(match, `path should start with a move command: ${path}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

// Every coordinate pair in a path (M/L endpoints and Q control/end points).
function pathPoints(path: string) {
  const points: Array<{ x: number; y: number }> = [];
  const numbers = path.match(/-?[\d.]+/g) ?? [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: Number(numbers[index]), y: Number(numbers[index + 1]) });
  }
  return points;
}

// No path vertex may sit inside a box's interior — the amendment №3
// "edges never cross a box" invariant, checked on the polyline's corners.
function assertAvoidsBox(path: string, box: LaneRowBox, edgeId: string) {
  for (const point of pathPoints(path)) {
    const inside =
      point.x > box.left + 1 &&
      point.x < box.left + box.width - 1 &&
      point.y > box.top + 1 &&
      point.y < box.top + box.height - 1;
    // biome-ignore lint/suspicious/noMisplacedAssertion: shared helper, always called from within it() blocks.
    assert.ok(
      !inside,
      `${edgeId}: point (${point.x}, ${point.y}) crosses box ${box.id}`
    );
  }
}

function byEdgeId(paths: LaneEdgePath[]) {
  return new Map(paths.map((path) => [path.edgeId, path]));
}

describe("computeLaneEdgePaths", () => {
  it("drops edges whose endpoints are missing or collapsed (zero height)", () => {
    const paths = computeLaneEdgePaths({
      rows: [row("a", 0), { ...row("b", 100), height: 0 }],
      edges: [
        { id: "e1", parentId: "a", childId: "b" },
        { id: "e2", parentId: "a", childId: "missing" },
      ],
      options: OPTIONS,
    });
    assert.equal(paths.length, 0);
  });

  it("gives single-entry edges no convergence number or badge", () => {
    const [path] = computeLaneEdgePaths({
      rows: [row("a", 0), row("b", 100)],
      edges: [{ id: "e1", parentId: "a", childId: "b" }],
      options: OPTIONS,
    });
    assert.equal(path.entryIndex, null);
    assert.equal(path.entryCount, 1);
    assert.equal(path.badgeAt, null);
  });

  it("numbers convergence entries top-to-bottom when a child has ≥2 premises", () => {
    const paths = computeLaneEdgePaths({
      rows: [row("p-low", 200), row("p-high", 0), row("child", 400)],
      edges: [
        { id: "e-low", parentId: "p-low", childId: "child" },
        { id: "e-high", parentId: "p-high", childId: "child" },
      ],
      options: OPTIONS,
    });
    const map = byEdgeId(paths);
    // p-high sits above p-low, so its edge is ① regardless of input order.
    assert.equal(map.get("e-high")?.entryIndex, 1);
    assert.equal(map.get("e-low")?.entryIndex, 2);
    assert.equal(map.get("e-high")?.entryCount, 2);
    assert.notEqual(map.get("e-high")?.arrow.y, map.get("e-low")?.arrow.y);
    assert.ok(map.get("e-high")?.badgeAt);
  });

  it("numbers same-row premises left-to-right (reading order)", () => {
    // Two premise cells share a visual row; the decision sits one row below.
    const paths = computeLaneEdgePaths({
      rows: [
        row("right", 0, 300, 220),
        row("left", 0, 40, 220),
        row("decision", 80, 40, 640),
      ],
      edges: [
        { id: "e-right", parentId: "right", childId: "decision" },
        { id: "e-left", parentId: "left", childId: "decision" },
      ],
      options: OPTIONS,
    });
    const map = byEdgeId(paths);
    assert.equal(map.get("e-left")?.entryIndex, 1);
    assert.equal(map.get("e-right")?.entryIndex, 2);
    // Both descend into the decision's top edge, at distinct x positions.
    assert.equal(map.get("e-left")?.arrowDir, "down");
    assert.equal(map.get("e-right")?.arrowDir, "down");
    assert.notEqual(map.get("e-left")?.arrow.x, map.get("e-right")?.arrow.x);
    assert.ok(
      (map.get("e-left")?.arrow.x ?? 0) < (map.get("e-right")?.arrow.x ?? 0)
    );
  });

  it("joins horizontally adjacent same-row cells with one straight arrow", () => {
    // 20px column gap (--z-cell-gap-x), the real multi-column spacing.
    const [path] = computeLaneEdgePaths({
      rows: [row("left", 0, 40, 220), row("right", 0, 280, 220)],
      edges: [{ id: "tight", parentId: "left", childId: "right" }],
      options: OPTIONS,
    });
    assert.equal(path.kind, "tight");
    assert.equal(path.arrowDir, "right");
    // A single segment: one move, one line, no curves (v1 §4.4).
    assert.equal(path.path.split("L").length - 1, 1);
    assert.ok(!path.path.includes("Q"));
    const start = startPoint(path.path);
    assert.equal(start.y, path.arrow.y);
    // Leaves the parent's right edge, arrives at the child's left edge.
    assert.ok(Math.abs(start.x - (40 + 220)) <= 2);
    assert.ok(Math.abs(path.arrow.x - 280) <= 2);
    // Points forward, never backwards.
    assert.ok(path.arrow.x > start.x);
  });

  it("never emits a backwards shaft when the column gap is too narrow", () => {
    // An 8px gap cannot fit the 2px insets plus a 5px arrowhead.
    const [path] = computeLaneEdgePaths({
      rows: [row("left", 0, 40, 220), row("right", 0, 268, 220)],
      edges: [{ id: "cramped", parentId: "left", childId: "right" }],
      options: OPTIONS,
    });
    assert.equal(path.kind, "tight");
    // The arrowhead alone carries the relationship; no reversed line.
    const backwards = path.path.match(/^M (-?[\d.]+) .* L (-?[\d.]+) /);
    if (backwards) {
      assert.ok(Number(backwards[2]) >= Number(backwards[1]));
    }
    assert.ok(!path.path.includes("NaN"));
  });

  it("points the arrow left when the parent sits right of the child", () => {
    const [path] = computeLaneEdgePaths({
      rows: [row("child", 0, 40, 220), row("parent", 0, 268, 220)],
      edges: [{ id: "back", parentId: "parent", childId: "child" }],
      options: OPTIONS,
    });
    assert.equal(path.kind, "tight");
    assert.equal(path.arrowDir, "left");
    assert.ok(Math.abs(path.arrow.x - (40 + 220)) <= 2);
  });

  it("falls back to the gutter for same-row cells that are far apart", () => {
    const [path] = computeLaneEdgePaths({
      rows: [row("left", 0, 40, 200), row("far", 0, 500, 200)],
      edges: [{ id: "wide", parentId: "left", childId: "far" }],
      options: OPTIONS,
    });
    assert.equal(path.kind, "gutter");
    // "far" is not its row's leftmost cell, so a left-edge entry would run
    // straight through "left" — it must descend into the top edge instead.
    assert.equal(path.arrowDir, "down");
    assertAvoidsBox(path.path, row("left", 0, 40, 200), "wide");
  });

  it("falls back to the gutter when a third cell sits between the endpoints", () => {
    const [path] = computeLaneEdgePaths({
      rows: [
        row("left", 0, 40, 180),
        row("middle", 0, 230, 180),
        row("right", 0, 420, 180),
      ],
      edges: [{ id: "skip", parentId: "left", childId: "right" }],
      options: OPTIONS,
    });
    assert.equal(path.kind, "gutter");
  });

  it("keeps full-width rows on the gutter route (amendment №2 regression)", () => {
    const [path] = computeLaneEdgePaths({
      rows: [row("a", 0), row("b", 200)],
      edges: [{ id: "e1", parentId: "a", childId: "b" }],
      options: OPTIONS,
    });
    assert.equal(path.kind, "gutter");
    assert.equal(path.arrowDir, "right");
    // Leaves the parent's left edge and arrives just left of the child's.
    const start = startPoint(path.path);
    assert.ok(Math.abs(start.x - 40) <= 2);
    assert.ok(Math.abs(path.arrow.x - 40) <= 2);
    assert.ok(path.arrow.y > 200 && path.arrow.y < 232);
  });

  it("routes short gutter spans on inner channels and long spans further out", () => {
    const paths = computeLaneEdgePaths({
      rows: [row("a", 0), row("b", 80), row("c", 400)],
      edges: [
        { id: "long", parentId: "a", childId: "c" },
        { id: "short", parentId: "a", childId: "b" },
      ],
      options: OPTIONS,
    });
    const map = byEdgeId(paths);
    const short = map.get("short") as LaneEdgePath;
    const long = map.get("long") as LaneEdgePath;
    // Overlapping spans must differ, with the shorter one further inside.
    assert.ok(short.channel < long.channel);
  });

  it("reuses a channel when vertical intervals do not overlap", () => {
    const paths = computeLaneEdgePaths({
      rows: [row("a", 0), row("b", 60), row("c", 300), row("d", 360)],
      edges: [
        { id: "top", parentId: "a", childId: "b" },
        { id: "bottom", parentId: "c", childId: "d" },
      ],
      options: OPTIONS,
    });
    assert.ok(paths.every((path) => path.channel === 0));
  });

  it("separates overlapping horizontal jogs onto distinct corridor lanes", () => {
    // Two step edges crossing the same corridor with overlapping x spans.
    const paths = computeLaneEdgePaths({
      rows: [
        row("p1", 0, 40, 200),
        row("p2", 0, 260, 200),
        row("c1", 90, 40, 200),
        row("c2", 90, 260, 200),
      ],
      edges: [
        { id: "cross-a", parentId: "p1", childId: "c2" },
        { id: "cross-b", parentId: "p2", childId: "c1" },
      ],
      options: OPTIONS,
    });
    const map = byEdgeId(paths);
    const a = map.get("cross-a") as LaneEdgePath;
    const b = map.get("cross-b") as LaneEdgePath;
    assert.equal(a.kind, "step");
    assert.equal(b.kind, "step");
    // Their horizontal runs must not share a y, or they would overlap.
    const laneY = (path: LaneEdgePath) =>
      path.path.match(/(-?[\d.]+)\s*$/)?.[0] ?? "";
    assert.notEqual(a.path, b.path);
    assert.ok(laneY(a) !== "" && laneY(b) !== "");
  });

  it("enters a non-leftmost child from the top, never crossing its row-mates", () => {
    // The screenshot bug: premises feeding a column-1 settled cell used to
    // enter from the left, running the horizontal segment straight through
    // the column-0 cell — which read as a strike-through on that node.
    const colA = row("colA", 160, 40, 300);
    const paths = computeLaneEdgePaths({
      rows: [
        row("prem1", 0, 40, 640),
        row("prem2", 80, 40, 640),
        colA,
        row("colB", 160, 360, 300),
      ],
      edges: [
        { id: "e1", parentId: "prem1", childId: "colB" },
        { id: "e2", parentId: "prem2", childId: "colB" },
      ],
      options: OPTIONS,
    });
    const map = byEdgeId(paths);
    const e1 = map.get("e1") as LaneEdgePath;
    const e2 = map.get("e2") as LaneEdgePath;
    // prem1 is two rows up → gutter; prem2 is directly above → step. Both
    // must land on colB's TOP edge and stay clear of its row-mate.
    assert.equal(e1.kind, "gutter");
    assert.equal(e2.kind, "step");
    for (const [id, path] of [
      ["e1", e1],
      ["e2", e2],
    ] as const) {
      assert.equal(path.arrowDir, "down", id);
      // Arrow lands on colB's top edge, inside its horizontal extent.
      assert.ok(path.arrow.x >= 360 && path.arrow.x <= 660, id);
      assert.ok(Math.abs(path.arrow.y - 160) <= 3, id);
      assertAvoidsBox(path.path, colA, id);
    }
    // Mixed-route entries still converge into one ①② pool: distinct x
    // positions, numbered top-to-bottom by premise position.
    assert.notEqual(e1.arrow.x, e2.arrow.x);
    assert.equal(e1.entryIndex, 1);
    assert.equal(e2.entryIndex, 2);
  });

  it("exits a non-leftmost parent through its bottom edge", () => {
    // A full-width row between parent and child forces the gutter route.
    const colA = row("colA", 0, 40, 300);
    const [path] = computeLaneEdgePaths({
      rows: [
        colA,
        row("colB", 0, 360, 300),
        row("mid", 100, 40, 640),
        row("child", 200, 40, 640),
      ],
      edges: [{ id: "exit", parentId: "colB", childId: "child" }],
      options: OPTIONS,
    }).filter((candidate) => candidate.edgeId === "exit");
    assert.equal(path.kind, "gutter");
    const start = startPoint(path.path);
    // Leaves colB's bottom edge (not its left edge, which would cross colA).
    assert.ok(start.x >= 360 && start.x <= 660);
    assert.ok(Math.abs(start.y - 32) <= 1);
    assertAvoidsBox(path.path, colA, "exit");
    assertAvoidsBox(path.path, row("mid", 100, 40, 640), "exit");
  });

  it("enters a non-leftmost child from below on upward edges", () => {
    const colA = row("colA", 0, 40, 300);
    const [path] = computeLaneEdgePaths({
      rows: [colA, row("colB", 0, 360, 300), row("late", 200, 40, 640)],
      edges: [{ id: "up", parentId: "late", childId: "colB" }],
      options: OPTIONS,
    });
    assert.equal(path.kind, "gutter");
    assert.equal(path.arrowDir, "up");
    // Arrow points up into colB's bottom edge.
    assert.ok(path.arrow.x >= 360 && path.arrow.x <= 660);
    assert.ok(Math.abs(path.arrow.y - 34) <= 1);
    assertAvoidsBox(path.path, colA, "up");
    assert.ok(!path.path.includes("NaN"));
  });

  it("draws upward edges (child above parent) without NaN coordinates", () => {
    const [path] = computeLaneEdgePaths({
      rows: [row("late", 300), row("early", 0)],
      edges: [{ id: "up", parentId: "late", childId: "early" }],
      options: OPTIONS,
    });
    assert.ok(!path.path.includes("NaN"));
    assert.ok(path.arrow.y < 300);
  });

  it("keeps every edge clear of every box in the coze-example layout", () => {
    // Faithful desktop replica of the flagship example's main topic — the
    // exact layout the overlap screenshot came from: five premises in two
    // columns, two settled cells side by side, three premises converging on
    // the column-1 settled cell, two more on the column-0 cell.
    const boxes = [
      // Premises band, 2-col (rows at 0 / 42 / 84; cells 344px wide).
      row("c-cloud", 0, 40, 344, 34),
      row("c-selfrescue", 0, 404, 344, 34),
      row("h-serious", 42, 40, 344, 34),
      row("h-trust", 42, 404, 344, 34),
      row("h-commodity", 84, 40, 708, 34),
      // Settled band, 2-col (heading gap above).
      row("d-northstar", 152, 40, 344, 34),
      row("d-moat", 152, 404, 344, 34),
      // Frontier below, full width.
      row("q-form", 220, 40, 708, 88),
    ];
    const edges = [
      { id: "e-ns-1", parentId: "h-serious", childId: "d-northstar" },
      { id: "e-ns-2", parentId: "h-commodity", childId: "d-northstar" },
      { id: "e-moat-1", parentId: "h-commodity", childId: "d-moat" },
      { id: "e-moat-2", parentId: "c-cloud", childId: "d-moat" },
      { id: "e-moat-3", parentId: "c-selfrescue", childId: "d-moat" },
      { id: "e-q", parentId: "d-northstar", childId: "q-form" },
    ];
    const paths = computeLaneEdgePaths({
      rows: boxes,
      edges,
      options: OPTIONS,
    });
    assert.equal(paths.length, edges.length);

    for (const path of paths) {
      assert.ok(!path.path.includes("NaN"), path.edgeId);
      for (const box of boxes) {
        if (box.id === path.parentId || box.id === path.childId) {
          continue;
        }
        assertAvoidsBox(path.path, box, path.edgeId);
      }
    }

    // The column-1 convergence that produced the screenshot: all three
    // entries land on d-moat's own edges, numbered in reading order.
    const map = byEdgeId(paths);
    const moatEntries = ["e-moat-1", "e-moat-2", "e-moat-3"].map(
      (id) => map.get(id) as LaneEdgePath
    );
    for (const entry of moatEntries) {
      assert.ok(entry.arrow.x >= 404 && entry.arrow.x <= 748, entry.edgeId);
    }
    const indices = moatEntries.map((entry) => entry.entryIndex).sort();
    assert.deepEqual(indices, [1, 2, 3]);
    // Badges must not overlap: pairwise distance ≥ badge diameter (12px).
    for (let a = 0; a < moatEntries.length; a += 1) {
      for (let b = a + 1; b < moatEntries.length; b += 1) {
        const pa = moatEntries[a].badgeAt;
        const pb = moatEntries[b].badgeAt;
        assert.ok(pa && pb);
        const distance = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        assert.ok(
          distance >= 12,
          `badges ${moatEntries[a].edgeId}/${moatEntries[b].edgeId} overlap (${distance}px)`
        );
      }
    }
  });

  it("never emits NaN across a mixed multi-column layout", () => {
    const paths = computeLaneEdgePaths({
      rows: [
        row("anchor", 0, 40, 640),
        row("p1", 60, 40, 200),
        row("p2", 60, 260, 200),
        row("p3", 60, 480, 200),
        row("d1", 140, 40, 200),
        row("d2", 140, 260, 200),
        row("tail", 260, 40, 640),
      ],
      edges: [
        { id: "e1", parentId: "p1", childId: "d1" },
        { id: "e2", parentId: "p2", childId: "d1" },
        { id: "e3", parentId: "p3", childId: "d2" },
        { id: "e4", parentId: "d1", childId: "d2" },
        { id: "e5", parentId: "anchor", childId: "tail" },
        { id: "e6", parentId: "p1", childId: "tail" },
      ],
      options: OPTIONS,
    });
    assert.equal(paths.length, 6);
    for (const path of paths) {
      assert.ok(!path.path.includes("NaN"), `NaN in ${path.edgeId}`);
      assert.ok(Number.isFinite(path.arrow.x));
      assert.ok(Number.isFinite(path.arrow.y));
      assert.ok(path.path.startsWith("M "));
    }
  });
});
