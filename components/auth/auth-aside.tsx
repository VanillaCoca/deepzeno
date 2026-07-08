"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";

// Login-page right panel. A quiet, monochrome "decision constellation" that
// grows upward — outlined nodes are candidates, filled nodes are confirmed
// truths, converging on a single apex. Several variants are generated
// deterministically (seeded PRNG, so SSR and the client agree — no hydration
// mismatch) and slowly cross-fade + redraw on a timer so the panel changes over
// time. The draw-in keyframes live in globals.css and stand down for
// prefers-reduced-motion; the cross-fade timer is gated on it too. Tagline is
// localized, tracking the language switcher live.

type NodeKind = "cand" | "conf" | "apex";
type ConNode = { x: number; y: number; kind: NodeKind };
type ConEdge = { x1: number; y1: number; x2: number; y2: number };
type Constellation = { nodes: ConNode[]; edges: ConEdge[] };

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Builds a lattice that narrows from a wide base to a single apex. Row counts
// shape the silhouette; the seed jitters positions and picks which nodes read
// as confirmed vs candidate — higher rows lean confirmed, converging on truth.
function buildConstellation(
  seed: number,
  rowCounts: number[],
  opts: { baseSpread: number; topSpread: number; jitterX?: number }
): Constellation {
  const rand = mulberry32(seed);
  const { baseSpread, topSpread, jitterX = 14 } = opts;
  const topY = 132;
  const botY = 688;
  const cx = 210;
  const rows = rowCounts.length;
  const grid: ConNode[][] = [];
  const nodes: ConNode[] = [];

  for (let r = 0; r < rows; r += 1) {
    const tt = rows === 1 ? 0 : r / (rows - 1);
    const y = botY + (topY - botY) * tt + (rand() - 0.5) * 10;
    const spread = baseSpread + (topSpread - baseSpread) * tt;
    const count = rowCounts[r];
    const row: ConNode[] = [];
    for (let i = 0; i < count; i += 1) {
      const fx = count === 1 ? 0.5 : i / (count - 1);
      const x = cx + (fx - 0.5) * spread + (rand() - 0.5) * jitterX;
      let kind: NodeKind;
      if (r === rows - 1 && count === 1) {
        kind = "apex";
      } else if (tt > 0.5) {
        kind = rand() > 0.32 ? "conf" : "cand";
      } else {
        kind = rand() > 0.82 ? "conf" : "cand";
      }
      const node: ConNode = { x, y, kind };
      row.push(node);
      nodes.push(node);
    }
    grid.push(row);
  }

  const edges: ConEdge[] = [];
  for (let r = 0; r < rows - 1; r += 1) {
    const up = grid[r + 1];
    for (const n of grid[r]) {
      const sorted = [...up].sort(
        (p, q) => Math.abs(p.x - n.x) - Math.abs(q.x - n.x)
      );
      const links = 1 + (rand() > 0.5 ? 1 : 0);
      for (let j = 0; j < Math.min(links, sorted.length); j += 1) {
        edges.push({ x1: n.x, y1: n.y, x2: sorted[j].x, y2: sorted[j].y });
      }
    }
  }

  return { nodes, edges };
}

const VARIANTS: Constellation[] = [
  buildConstellation(1, [6, 5, 6, 5, 4, 3, 2, 1], {
    baseSpread: 340,
    topSpread: 64,
  }),
  buildConstellation(7, [5, 6, 5, 5, 4, 3, 2, 1], {
    baseSpread: 366,
    topSpread: 96,
    jitterX: 18,
  }),
  buildConstellation(19, [4, 5, 4, 4, 3, 3, 2, 1], {
    baseSpread: 300,
    topSpread: 44,
  }),
  buildConstellation(41, [6, 4, 5, 4, 4, 3, 2, 1], {
    baseSpread: 384,
    topSpread: 112,
    jitterX: 20,
  }),
];

const CYCLE_MS = 24_000;
const FADE_MS = 700;

export function AuthAside() {
  const { t } = useLocale();
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduce) {
      return;
    }

    let swap: ReturnType<typeof setTimeout> | undefined;
    const cycle = setInterval(() => {
      setVisible(false);
      swap = setTimeout(() => {
        setActive((index) => (index + 1) % VARIANTS.length);
        setVisible(true);
      }, FADE_MS);
    }, CYCLE_MS);

    return () => {
      clearInterval(cycle);
      if (swap) {
        clearTimeout(swap);
      }
    };
  }, []);

  const constellation = VARIANTS[active];

  return (
    <aside className="za-aside relative flex h-full w-full flex-col overflow-hidden p-12 text-sidebar-foreground xl:p-16">
      <div className="relative z-10 shrink-0">
        <h2 className="max-w-[19rem] text-pretty font-medium text-[26px] text-foreground/85 leading-[1.4] tracking-tight">
          {t("dialog.login.asideTagline")}
        </h2>
      </div>

      <div className="relative flex-1">
        <svg
          aria-hidden="true"
          className={cn(
            "absolute inset-0 h-full w-full text-foreground transition-opacity duration-700 [overflow:visible]",
            visible ? "opacity-100" : "opacity-0"
          )}
          preserveAspectRatio="xMidYMax meet"
          viewBox="0 0 420 720"
        >
          <g className="za-edges">
            {constellation.edges.map((edge, index) => (
              <line
                className="za-edge"
                key={`${active}-e-${edge.x1}-${edge.y1}-${edge.x2}-${edge.y2}`}
                pathLength={1}
                stroke="currentColor"
                strokeOpacity={0.13}
                strokeWidth={1}
                style={{ animationDelay: `${0.1 + index * 0.02}s` }}
                x1={edge.x1}
                x2={edge.x2}
                y1={edge.y1}
                y2={edge.y2}
              />
            ))}
          </g>

          <g className="za-nodes">
            {constellation.nodes.map((node, index) => {
              const delay = `${0.35 + index * 0.03}s`;
              if (node.kind === "apex") {
                return (
                  <g key={`${active}-n-${node.x}-${node.y}`}>
                    <circle
                      className="za-halo"
                      cx={node.x}
                      cy={node.y}
                      fill="none"
                      r={13}
                      stroke="currentColor"
                      strokeOpacity={0.28}
                      strokeWidth={1}
                      style={{ animationDelay: delay }}
                    />
                    <circle
                      className="za-node"
                      cx={node.x}
                      cy={node.y}
                      fill="currentColor"
                      r={6.5}
                      style={{ animationDelay: delay }}
                    />
                  </g>
                );
              }
              if (node.kind === "conf") {
                return (
                  <circle
                    className="za-node"
                    cx={node.x}
                    cy={node.y}
                    fill="currentColor"
                    fillOpacity={0.9}
                    key={`${active}-n-${node.x}-${node.y}`}
                    r={4.4}
                    style={{ animationDelay: delay }}
                  />
                );
              }
              return (
                <circle
                  className="za-node"
                  cx={node.x}
                  cy={node.y}
                  fill="var(--sidebar)"
                  key={`${active}-n-${node.x}-${node.y}`}
                  r={3.6}
                  stroke="currentColor"
                  strokeOpacity={0.5}
                  strokeWidth={1.2}
                  style={{ animationDelay: delay }}
                />
              );
            })}
          </g>
        </svg>
      </div>
    </aside>
  );
}
