"use client";

import {
  ArrowDownToLineIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleDotIcon,
  LogOutIcon,
  MessageCircleIcon,
  MoonIcon,
  SunIcon,
  XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { type ComponentType, type SVGProps, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Demo data (static mock — mirrors the production truth panel)               */
/* -------------------------------------------------------------------------- */

type DemoNode = {
  id: string;
  kind: "goal" | "decision" | "constraint" | "question";
  title: string;
  x: number;
  y: number;
  active?: boolean;
  chain?: boolean;
};

const overviewNodes: DemoNode[] = [
  {
    id: "n1",
    kind: "goal",
    title: "Reviewable graph",
    x: 64,
    y: 62,
    chain: true,
  },
  {
    id: "n2",
    kind: "constraint",
    title: "Truth is read-only",
    x: 62,
    y: 174,
    chain: true,
  },
  { id: "n3", kind: "decision", title: "Use one detail pane", x: 320, y: 92 },
  {
    id: "n4",
    kind: "decision",
    title: "Aligned sections",
    x: 314,
    y: 220,
    active: true,
    chain: true,
  },
  {
    id: "n5",
    kind: "question",
    title: "What changed upstream?",
    x: 560,
    y: 154,
  },
];

const chainNodes = [
  "Reviewable graph",
  "Truth is read-only",
  "Aligned sections",
];

function nodeTone(kind: DemoNode["kind"], selected = false) {
  if (selected) {
    return "stroke-[var(--z-confirmed)] text-[var(--z-confirmed)]";
  }
  if (kind === "constraint" || kind === "question") {
    return "stroke-[var(--z-attention)] text-[var(--z-attention-text)]";
  }
  return "stroke-[var(--z-node-stroke)] text-[var(--z-text)]";
}

/* -------------------------------------------------------------------------- */
/*  Top row graphs                                                             */
/* -------------------------------------------------------------------------- */

function OverviewGraph() {
  return (
    <svg
      aria-label="Truth overview demo"
      className="h-full min-h-[260px] w-full"
      role="img"
      viewBox="0 0 760 360"
    >
      <defs>
        <marker
          id="demo-overview-arrow"
          markerHeight="7"
          markerWidth="7"
          orient="auto-start-reverse"
          refX="8"
          refY="5"
          viewBox="0 0 10 10"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="var(--z-confirmed)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </marker>
      </defs>

      <rect
        fill="none"
        height="292"
        rx="8"
        stroke="var(--z-topic-border)"
        width="698"
        x="31"
        y="30"
      />
      <text fill="var(--z-text-2)" fontSize="12" fontWeight="600" x="48" y="52">
        Product judgment
      </text>

      <path
        d="M154 98L154 145L403 145L403 220"
        fill="none"
        markerEnd="url(#demo-overview-arrow)"
        stroke="var(--z-confirmed)"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M154 210L154 244L314 244"
        fill="none"
        markerEnd="url(#demo-overview-arrow)"
        stroke="var(--z-confirmed)"
        strokeLinejoin="round"
        strokeWidth="2"
      />

      {overviewNodes.map((node) => (
        <g key={node.id} opacity={node.chain ? 1 : 0.32}>
          {node.kind === "question" ? (
            <polygon
              className={nodeTone(node.kind, node.active)}
              fill="var(--z-node-fill)"
              points={`${node.x + 82},${node.y} ${node.x + 164},${node.y + 32} ${node.x + 82},${node.y + 64} ${node.x},${node.y + 32}`}
              strokeWidth={node.active ? 2 : 1}
            />
          ) : (
            <rect
              className={nodeTone(node.kind, node.active)}
              fill="var(--z-node-fill)"
              height="64"
              rx="7"
              strokeWidth={node.active ? 2 : 1}
              width="164"
              x={node.x}
              y={node.y}
            />
          )}
          <text
            className={nodeTone(node.kind, node.active)}
            dominantBaseline="middle"
            fontSize="13"
            fontWeight={node.active ? 600 : 500}
            textAnchor="middle"
            x={node.x + 82}
            y={node.y + 32}
          >
            {node.title}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ChainGraph() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-4">
      <svg
        aria-label="Selected chain demo"
        className="h-full min-h-[240px] w-full max-w-[300px]"
        role="img"
        viewBox="0 0 300 324"
      >
        <defs>
          <marker
            id="demo-chain-arrow"
            markerHeight="7"
            markerWidth="7"
            orient="auto-start-reverse"
            refX="8"
            refY="5"
            viewBox="0 0 10 10"
          >
            <path
              d="M2 1L8 5L2 9"
              fill="none"
              stroke="var(--z-confirmed)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </marker>
        </defs>

        {[0, 1].map((index) => (
          <g key={index}>
            <path
              d={`M150 ${74 + index * 102}L150 ${120 + index * 102}`}
              fill="none"
              markerEnd="url(#demo-chain-arrow)"
              stroke="var(--z-confirmed)"
              strokeWidth="2"
            />
            <text
              fill="var(--z-edge-label)"
              fontSize="10.5"
              fontWeight="500"
              textAnchor="middle"
              x="150"
              y={102 + index * 102}
            >
              needs
            </text>
          </g>
        ))}

        {chainNodes.map((title, index) => {
          const selected = index === chainNodes.length - 1;
          const y = 18 + index * 102;

          return (
            <g key={title}>
              <rect
                fill="var(--z-node-fill)"
                height="56"
                rx={selected ? 9 : index === 0 ? 28 : 7}
                stroke="var(--z-confirmed)"
                strokeWidth={selected ? 2 : 1}
                width="236"
                x="32"
                y={y}
              />
              <text
                dominantBaseline="middle"
                fill="var(--z-confirmed)"
                fontSize="13"
                fontWeight={selected ? 600 : 500}
                textAnchor="middle"
                x="150"
                y={y + 28}
              >
                {title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Section header (shared rhythm across all four quadrants)                   */
/* -------------------------------------------------------------------------- */

function SectionHeader({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 px-4 text-[11px] font-medium uppercase tracking-wide text-[var(--ir-text-tertiary)]">
      <span>{label}</span>
      {meta ? (
        <span className="normal-case text-[var(--ir-text-secondary)]">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  NEW action design — tactile button + per-button explanation               */
/* -------------------------------------------------------------------------- */

type Tone = "confirm" | "amber" | "blue" | "neutral";

const TONE_STYLE: Record<Tone, { bg: string; fg: string; ring: string }> = {
  confirm: {
    bg: "var(--z-confirmed-soft)",
    fg: "var(--z-confirmed)",
    ring: "var(--z-confirmed)",
  },
  amber: {
    bg: "var(--z-attention-soft)",
    fg: "var(--z-attention-text)",
    ring: "var(--z-attention)",
  },
  blue: {
    bg: "var(--ir-bg-elevated)",
    fg: "var(--ir-accent-blue)",
    ring: "var(--ir-accent-blue-border)",
  },
  neutral: {
    bg: "var(--ir-bg-elevated)",
    fg: "var(--ir-text-secondary)",
    ring: "var(--ir-border-strong)",
  },
};

type ActionSpec = {
  tone: Tone;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  desc: string;
  longLabel: string;
  primary?: boolean;
};

// Semantic accent carried only by the icon, keeping the buttons calm/native.
const TONE_ICON: Record<Tone, string> = {
  confirm: "text-[var(--z-confirmed)]",
  amber: "text-[var(--z-attention-text)]",
  blue: "text-[var(--ir-accent-blue)]",
  neutral: "text-[var(--ir-text-tertiary)]",
};

function actionVariant(spec: ActionSpec) {
  if (spec.primary) {
    return "secondary" as const;
  }
  if (spec.tone === "neutral") {
    return "ghost" as const;
  }
  return "outline" as const;
}

// One action = explanation on the left, a real button on the right. The buttons
// share a min-width so they line up into a tidy right-hand column; a single
// action then reads like a calm card (the reference look).
function ActionItem({ spec }: { spec: ActionSpec }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--ir-text-secondary)]">
        {spec.desc}
      </p>
      <Button
        className={cn(
          "min-w-[128px] justify-center",
          spec.primary && "font-semibold"
        )}
        variant={actionVariant(spec)}
      >
        <spec.Icon className={cn("size-4", TONE_ICON[spec.tone])} />
        {spec.label}
      </Button>
    </div>
  );
}

type DemoStatus = "active" | "pending" | "idea";

const ACTION_SETS: Record<DemoStatus, ActionSpec[]> = {
  active: [
    {
      tone: "amber",
      Icon: ArrowDownToLineIcon,
      label: "Re-evaluate",
      longLabel: "Bring back to sandbox & re-evaluate",
      desc: "Bring this truth back into the sandbox to discuss and re-evaluate.",
      primary: true,
    },
  ],
  pending: [
    {
      tone: "confirm",
      Icon: CheckIcon,
      label: "Confirm",
      longLabel: "Confirm as truth",
      desc: "Mark this candidate as a confirmed truth.",
      primary: true,
    },
    {
      tone: "amber",
      Icon: MessageCircleIcon,
      label: "Discuss",
      longLabel: "Keep discussing in sandbox",
      desc: "Send it back to the sandbox to keep talking — don't confirm yet.",
    },
    {
      tone: "neutral",
      Icon: XIcon,
      label: "Dismiss",
      longLabel: "Dismiss candidate",
      desc: "Reject this candidate; it won't become a truth.",
    },
  ],
  idea: [
    {
      tone: "blue",
      Icon: CircleDotIcon,
      label: "Promote",
      longLabel: "Promote to candidate",
      desc: "Promote this idea to a candidate, pending confirmation.",
      primary: true,
    },
    {
      tone: "amber",
      Icon: ArrowDownToLineIcon,
      label: "Discuss",
      longLabel: "Bring back to sandbox to discuss",
      desc: "Bring it back to the sandbox to explore.",
    },
    {
      tone: "neutral",
      Icon: XIcon,
      label: "Ignore",
      longLabel: "Ignore idea",
      desc: "Ignore this idea; stop surfacing it.",
    },
  ],
};

const STATUS_LABEL: Record<DemoStatus, string> = {
  active: "active · truth",
  pending: "pending · candidate",
  idea: "idea",
};

const BADGE_TONE: Record<DemoStatus, string> = {
  active: "bg-[var(--z-confirmed-soft)] text-[var(--z-confirmed)]",
  pending: "bg-[var(--z-attention-soft)] text-[var(--z-attention-text)]",
  idea: "bg-[var(--ir-bg-elevated)] text-[var(--ir-text-secondary)]",
};

function ActionsPanel({ status }: { status: DemoStatus }) {
  const specs = ACTION_SETS[status];
  return (
    <div className="flex h-full min-h-0 flex-col px-5 pt-2 pb-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-tight text-[var(--ir-text-primary)]">
          Next step for C11
        </h3>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
            BADGE_TONE[status]
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="mt-2 divide-y divide-[var(--ir-border-default)]">
        {specs.map((spec) => (
          <ActionItem key={spec.label} spec={spec} />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Details quadrant                                                          */
/* -------------------------------------------------------------------------- */

function DetailsPanel() {
  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 pb-4">
      <div className="border-b border-[var(--ir-border-default)] pb-3 pt-1">
        <p className="text-xs text-[var(--ir-text-secondary)]">Task</p>
        <h2 className="mt-1 text-base font-medium text-[var(--ir-text-primary)]">
          Next step for C11
        </h2>
      </div>

      <section className="mt-3 space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ir-text-tertiary)]">
          Rationale
        </p>
        <p className="text-sm leading-[1.55] text-[var(--ir-text-primary)]">
          Drafted from the active truth detail pane. The selected judgment needs
          one continuous inspection surface.
        </p>
      </section>

      <section className="mt-4 space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ir-text-tertiary)]">
          Relations
        </p>
        <p className="text-sm leading-[1.55] text-[var(--ir-text-secondary)]">
          <span className="text-[var(--ir-text-tertiary)]">depends_on</span> C11
          · AI never decides for the user; it only surfaces candidates to
          confirm.
        </p>
      </section>

      <section className="mt-4 space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ir-text-tertiary)]">
          Source
        </p>
        <p className="text-sm leading-[1.55] text-[var(--ir-text-secondary)]">
          manual · 2026/5/6 02:41:36
        </p>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  OLD design reference (for before/after comparison)                        */
/* -------------------------------------------------------------------------- */

const OLD_BTN =
  "flex w-full items-center justify-start gap-2 rounded-lg border bg-transparent px-3 py-1.5 text-sm font-medium transition-colors";

function OldActions({ status }: { status: DemoStatus }) {
  const specs = ACTION_SETS[status];
  return (
    <div className="flex w-full max-w-[300px] flex-col gap-2">
      {specs.map((spec) => {
        const tone = TONE_STYLE[spec.tone];
        return (
          <button
            className={OLD_BTN}
            key={spec.label}
            style={{ borderColor: tone.ring, color: tone.fg }}
            type="button"
          >
            <spec.Icon aria-hidden="true" className="size-4" />
            {spec.longLabel}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Account menu — ChatGPT-style popover above the user row                   */
/* -------------------------------------------------------------------------- */

function AccountMenu() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : true;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-3 rounded-xl border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--ir-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ir-border-focus)] aria-expanded:bg-[var(--ir-bg-hover)]"
          type="button"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ir-bg-elevated)] text-xs font-semibold text-[var(--ir-text-primary)] ring-1 ring-[var(--ir-border-default)]">
            S
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-[var(--ir-text-primary)]">
              Sean
            </span>
            <span className="block truncate text-xs text-[var(--ir-text-tertiary)]">
              seanmingze@gmail.com
            </span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-[var(--ir-text-tertiary)]" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-60"
        side="top"
        sideOffset={8}
      >
        <DropdownMenuLabel className="py-2">
          <span className="block text-sm font-medium text-[var(--ir-text-primary)]">
            Sean
          </span>
          <span className="block truncate text-xs text-[var(--ir-text-tertiary)]">
            seanmingze@gmail.com
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          // Keep the menu open so the theme flip is visible while toggling.
          onSelect={(event) => {
            event.preventDefault();
            setTheme(isDark ? "light" : "dark");
          }}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
          {isDark ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>

        <DropdownMenuItem variant="destructive">
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

// The single shared split that aligns the top (Overview|Chain) divider with the
// bottom (Details|Actions) divider into one continuous vertical line. Width is
// driven by the chain column (requirement 1).
const COLUMN_SPLIT = "minmax(0, 1fr) 380px";

const STATUSES: DemoStatus[] = ["active", "pending", "idea"];

export default function TruthPanelDemoPage() {
  const [status, setStatus] = useState<DemoStatus>("pending");

  return (
    <main className="min-h-screen bg-[var(--ir-bg-app)] px-5 py-5 text-[var(--ir-text-primary)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-[var(--ir-text-secondary)]">
              ZENO truth panel
            </p>
            <h1 className="text-2xl font-semibold tracking-normal">
              Aligned four-section layout + action redesign
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--ir-text-tertiary)]">
              Selected node status:
            </span>
            <div className="flex rounded-lg border border-[var(--ir-border-default)] p-0.5">
              {STATUSES.map((s) => (
                <button
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                    status === s
                      ? "bg-[var(--ir-bg-elevated)] text-[var(--ir-text-primary)] shadow-sm"
                      : "text-[var(--ir-text-tertiary)] hover:text-[var(--ir-text-secondary)]"
                  )}
                  key={s}
                  onClick={() => setStatus(s)}
                  type="button"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* The panel: one grid → continuous "+" dividers, gray cells fill fully */}
        <div className="overflow-x-auto">
          <div
            className="grid h-[calc(100vh-150px)] min-h-[620px] min-w-[860px] overflow-hidden rounded-[8px] border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] shadow-[var(--shadow-float)]"
            style={{
              gridTemplateColumns: COLUMN_SPLIT,
              gridTemplateRows: "minmax(0, 1.25fr) minmax(220px, 0.85fr)",
            }}
          >
            {/* Overview (top-left, darker gray fills the whole cell) */}
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--z-bg)]">
              <SectionHeader label="Overview" meta="7 truths" />
              <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                <OverviewGraph />
              </div>
            </section>

            {/* Chain (top-right, lighter gray fills the whole cell) */}
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--ir-border-default)] bg-[var(--z-node-fill)]">
              <SectionHeader label="Chain" meta="3 steps" />
              <div className="min-h-0 flex-1 overflow-auto">
                <ChainGraph />
              </div>
            </section>

            {/* Details (bottom-left) */}
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)]">
              <SectionHeader label="Details" />
              <div className="min-h-0 flex-1 overflow-hidden">
                <DetailsPanel />
              </div>
            </section>

            {/* Actions (bottom-right) */}
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-t border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)]">
              <SectionHeader label="Actions" />
              <div className="min-h-0 flex-1 overflow-hidden">
                <ActionsPanel status={status} />
              </div>
            </section>
          </div>
        </div>

        {/* Before / after comparison + account menu prototype */}
        <div className="mt-2 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--ir-text-tertiary)]">
              Before — full-width · border-only · long labels
            </p>
            <OldActions status={status} />
          </div>
          <div className="rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--ir-text-tertiary)]">
              After — native buttons in a tidy right column + captions
            </p>
            <div className="divide-y divide-[var(--ir-border-default)]">
              {ACTION_SETS[status].map((spec) => (
                <ActionItem key={spec.label} spec={spec} />
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--ir-text-tertiary)]">
              Account menu — click the name (theme toggle works)
            </p>
            <div className="mt-auto max-w-[280px]">
              <AccountMenu />
            </div>
            <p className="mt-3 text-xs text-[var(--ir-text-tertiary)]">
              Mirrors the sidebar footer. Popover opens upward with Log out + a
              live light/dark toggle.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
