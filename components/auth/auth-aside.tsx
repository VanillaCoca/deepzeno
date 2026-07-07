"use client";

import { useLocale } from "@/components/i18n/locale-provider";

// Login-page right panel. Replaces the old "Powered by Vercel" preview with a
// quiet, monochrome art piece true to ZENO: a "decision constellation" that
// grows upward — outlined nodes are candidates, filled nodes are confirmed
// truths, converging on a single apex. Pure SVG + CSS, theme-adaptive via
// `currentColor`, with a restrained draw-in on load that stands down for
// `prefers-reduced-motion` (keyframes live in globals.css). The tagline is
// localized, so it tracks the language switcher live.

type NodeKind = "cand" | "conf" | "apex";
type GraphNode = { id: string; x: number; y: number; kind: NodeKind };

const NODES: GraphNode[] = [
  // roots / candidates fanning across the base
  { id: "a1", x: 60, y: 686, kind: "cand" },
  { id: "a2", x: 118, y: 674, kind: "cand" },
  { id: "a3", x: 180, y: 690, kind: "cand" },
  { id: "a4", x: 244, y: 676, kind: "cand" },
  { id: "a5", x: 306, y: 688, kind: "cand" },
  { id: "a6", x: 360, y: 672, kind: "cand" },
  { id: "b1", x: 90, y: 626, kind: "cand" },
  { id: "b2", x: 152, y: 614, kind: "conf" },
  { id: "b3", x: 214, y: 630, kind: "cand" },
  { id: "b4", x: 280, y: 616, kind: "cand" },
  { id: "b5", x: 340, y: 628, kind: "cand" },
  { id: "c1", x: 64, y: 558, kind: "cand" },
  { id: "c2", x: 128, y: 548, kind: "cand" },
  { id: "c3", x: 196, y: 562, kind: "conf" },
  { id: "c4", x: 258, y: 546, kind: "cand" },
  { id: "c5", x: 322, y: 560, kind: "cand" },
  { id: "c6", x: 372, y: 548, kind: "cand" },
  { id: "d1", x: 100, y: 488, kind: "cand" },
  { id: "d2", x: 168, y: 476, kind: "conf" },
  { id: "d3", x: 236, y: 492, kind: "conf" },
  { id: "d4", x: 300, y: 478, kind: "cand" },
  { id: "d5", x: 356, y: 494, kind: "cand" },
  { id: "e1", x: 132, y: 416, kind: "cand" },
  { id: "e2", x: 200, y: 404, kind: "conf" },
  { id: "e3", x: 268, y: 420, kind: "conf" },
  { id: "e4", x: 330, y: 408, kind: "cand" },
  { id: "f1", x: 168, y: 348, kind: "conf" },
  { id: "f2", x: 236, y: 336, kind: "conf" },
  { id: "f3", x: 300, y: 352, kind: "conf" },
  { id: "g1", x: 210, y: 278, kind: "conf" },
  { id: "g2", x: 274, y: 264, kind: "conf" },
  { id: "h1", x: 250, y: 200, kind: "conf" },
  { id: "ax", x: 282, y: 128, kind: "apex" },
];

const EDGES: [string, string][] = [
  ["a1", "b1"],
  ["a2", "b1"],
  ["a2", "b2"],
  ["a3", "b2"],
  ["a3", "b3"],
  ["a4", "b3"],
  ["a4", "b4"],
  ["a5", "b4"],
  ["a5", "b5"],
  ["a6", "b5"],
  ["b1", "c1"],
  ["b1", "c2"],
  ["b2", "c2"],
  ["b2", "c3"],
  ["b3", "c3"],
  ["b3", "c4"],
  ["b4", "c4"],
  ["b4", "c5"],
  ["b5", "c5"],
  ["b5", "c6"],
  ["c1", "d1"],
  ["c2", "d1"],
  ["c2", "d2"],
  ["c3", "d2"],
  ["c3", "d3"],
  ["c4", "d3"],
  ["c4", "d4"],
  ["c5", "d4"],
  ["c5", "d5"],
  ["c6", "d5"],
  ["d1", "e1"],
  ["d2", "e1"],
  ["d2", "e2"],
  ["d3", "e2"],
  ["d3", "e3"],
  ["d4", "e3"],
  ["d4", "e4"],
  ["d5", "e4"],
  ["e1", "f1"],
  ["e2", "f1"],
  ["e2", "f2"],
  ["e3", "f2"],
  ["e3", "f3"],
  ["e4", "f3"],
  ["f1", "g1"],
  ["f2", "g1"],
  ["f2", "g2"],
  ["f3", "g2"],
  ["g1", "h1"],
  ["g2", "h1"],
  ["g2", "ax"],
  ["h1", "ax"],
  // longer reaching links for organic depth
  ["c3", "e2"],
  ["d3", "f2"],
  ["e3", "g2"],
];

const NODE_BY_ID = new Map(NODES.map((node) => [node.id, node]));

export function AuthAside() {
  const { t } = useLocale();

  return (
    <aside className="za-aside relative flex h-full w-full flex-col overflow-hidden p-12 text-sidebar-foreground xl:p-16">
      <div className="relative z-10 shrink-0">
        <div className="text-[11px] tracking-[0.35em] text-muted-foreground/70">
          ZENO
        </div>
        <h2 className="mt-7 max-w-[19rem] text-pretty font-medium text-[26px] text-foreground/85 leading-[1.4] tracking-tight">
          {t("dialog.login.asideTagline")}
        </h2>
      </div>

      <div className="relative flex-1">
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full text-foreground [overflow:visible]"
          preserveAspectRatio="xMidYMax meet"
          viewBox="0 0 420 720"
        >
          <g className="za-edges">
            {EDGES.map(([from, to], index) => {
              const a = NODE_BY_ID.get(from);
              const b = NODE_BY_ID.get(to);
              if (!(a && b)) {
                return null;
              }
              return (
                <line
                  className="za-edge"
                  key={`${from}-${to}`}
                  pathLength={1}
                  stroke="currentColor"
                  strokeOpacity={0.13}
                  strokeWidth={1}
                  style={{ animationDelay: `${0.1 + index * 0.028}s` }}
                  x1={a.x}
                  x2={b.x}
                  y1={a.y}
                  y2={b.y}
                />
              );
            })}
          </g>

          <g className="za-nodes">
            {NODES.map((node, index) => {
              const delay = `${0.4 + index * 0.038}s`;
              if (node.kind === "apex") {
                return (
                  <g key={node.id}>
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
                    key={node.id}
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
                  key={node.id}
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
