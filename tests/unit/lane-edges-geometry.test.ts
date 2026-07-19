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
  entrySpread: 8,
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
  assert.ok(match, `path should start with a move command: ${path}`);
  return { x: Number(match[1]), y: Number(match[2]) };
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
    assert.equal(path.arrowDir, "right");
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

  it("draws upward edges (child above parent) without NaN coordinates", () => {
    const [path] = computeLaneEdgePaths({
      rows: [row("late", 300), row("early", 0)],
      edges: [{ id: "up", parentId: "late", childId: "early" }],
      options: OPTIONS,
    });
    assert.ok(!path.path.includes("NaN"));
    assert.ok(path.arrow.y < 300);
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
