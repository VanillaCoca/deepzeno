"use client";

// Semantic lanes overview (rules amendment №1 §2–§4): inside a topic, vertical
// POSITION carries the narrative — anchor → premises → settled → open → excluded
// — and visual DENSITY follows the lifecycle: full cards only for the frontier
// (open questions + unconfirmed candidates), single rows for settled truths,
// folded lines for premises and excluded items. Color is demoted to a
// reinforcement signal; every node self-labels with an icon + type chip, so no
// legend is needed (amendment §3, implementing v1 §4.1/§4.7 redundancy).
//
// Amendment №2 adds the quiet dependency edges: an SVG overlay draws
// depends_on / implies arrows between visible rows of the same topic, so
// prerequisite assumptions and event ordering read without any selection.

import {
  AnchorIcon,
  CheckIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  HelpCircleIcon,
  LightbulbIcon,
  RadarIcon,
  ScaleIcon,
  TargetIcon,
  XIcon,
} from "lucide-react";
import type { ComponentType, MouseEvent, ReactNode, SVGProps } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import type { IRNode } from "@/lib/ir/types";
import { cn } from "@/lib/utils";
import { QUIET_EDGE_RELATIONS, type TruthGraphModel } from "./data";
import { LaneEdgesOverlay } from "./lane-edges";

export type SemanticLanesProps = {
  chainNodeIds: Set<string>;
  childrenByParent: Map<string, IRNode[]>;
  model: TruthGraphModel;
  onBackgroundClick: () => void;
  onSelect: (nodeId: string) => void;
  selectedNodeId: string | null;
  watchedNodeIds?: Set<string>;
};

// Premise folds default open up to this size so assumption dependencies are
// visible without interaction (amendment №2); larger sets fold to one line
// (v1 §6.3) with per-node ⚓N badges as the fallback cue.
const PREMISES_AUTO_OPEN_MAX = 4;

type TopicLanes = {
  anchors: IRNode[];
  candidatesByQuestion: Map<string, IRNode[]>;
  excluded: IRNode[];
  ideas: IRNode[];
  looseCandidates: IRNode[];
  premises: IRNode[];
  questions: IRNode[];
  settled: IRNode[];
};

function isExcluded(node: IRNode) {
  return (
    node.kind === "rejection" ||
    node.status === "superseded" ||
    node.status === "dismissed"
  );
}

// Splits a topic's root nodes into the five lanes. Order of checks matters:
// excluded wins over everything (a superseded question belongs in the drawer),
// and a PENDING goal is a candidate goal → it goes to the frontier like any
// other candidate (amendment §5.3), not to the anchor slot.
function splitLanes(nodes: IRNode[], model: TruthGraphModel): TopicLanes {
  const lanes: TopicLanes = {
    anchors: [],
    candidatesByQuestion: new Map(),
    excluded: [],
    ideas: [],
    looseCandidates: [],
    premises: [],
    questions: [],
    settled: [],
  };
  const pending: IRNode[] = [];

  for (const node of nodes) {
    if (node.parentId) {
      // Sub-nodes stay in the detail panel + chain, matching the old overview.
      continue;
    }
    if (isExcluded(node)) {
      lanes.excluded.push(node);
    } else if (node.kind === "open_question") {
      lanes.questions.push(node);
    } else if (node.status === "pending") {
      pending.push(node);
    } else if (node.status === "idea") {
      lanes.ideas.push(node);
    } else if (node.kind === "goal" || node.kind === "principle") {
      lanes.anchors.push(node);
    } else if (node.kind === "constraint" || node.kind === "hypothesis") {
      lanes.premises.push(node);
    } else {
      lanes.settled.push(node);
    }
  }

  // Nest a candidate under the open question it answers (IBIS structure) when
  // a resolves/refines edge links them; otherwise it stands alone.
  const questionIds = new Set(lanes.questions.map((node) => node.id));
  for (const candidate of pending) {
    const parentEdge = (model.parentEdgesByChild.get(candidate.id) ?? []).find(
      (edge) => questionIds.has(edge.parentId)
    );
    if (parentEdge) {
      const bucket = lanes.candidatesByQuestion.get(parentEdge.parentId) ?? [];
      bucket.push(candidate);
      lanes.candidatesByQuestion.set(parentEdge.parentId, bucket);
    } else {
      lanes.looseCandidates.push(candidate);
    }
  }

  return lanes;
}

function frontierCount(lanes: TopicLanes) {
  let nested = 0;
  for (const bucket of lanes.candidatesByQuestion.values()) {
    nested += bucket.length;
  }
  return lanes.questions.length + lanes.looseCandidates.length + nested;
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const CHIP_TONES = {
  attention: "bg-[var(--z-attention-soft)] text-[var(--z-attention-text)]",
  candidate: "bg-[var(--z-candidate-soft)] text-[var(--z-candidate-text)]",
  confirmed: "bg-[var(--z-confirmed-soft)] text-[var(--z-confirmed)]",
  neutral: "bg-[var(--z-node-fill)] text-[var(--z-text-2)]",
  rejected: "bg-[var(--z-rejected-soft)] text-[var(--z-rejected)]",
} as const;

function TypeChip({
  icon: Icon,
  label,
  tone,
}: {
  icon: IconComponent;
  label: string;
  tone: keyof typeof CHIP_TONES;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        CHIP_TONES[tone]
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

// Focus dimming mirrors the SVG canvas (v1 §4.6): when a node is selected,
// everything off its chain fades but stays in place.
function focusStyle(dimmed: boolean) {
  return {
    opacity: dimmed ? "var(--z-focus-faint)" : undefined,
    transition: "opacity var(--z-transition)",
  } as const;
}

function SubNodeBadge({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }
  return (
    <span className="shrink-0 rounded-full bg-[var(--z-node-fill)] px-1.5 text-[11px] text-[var(--z-text-2)]">
      {count}
    </span>
  );
}

// Fallback cue when the premises fold is closed: the node still declares how
// many premises it stands on (amendment №2 — dependency stays visible even
// when its endpoint row is hidden, so the quiet edge can't draw).
function PremiseBadge({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--z-node-fill)] px-1.5 text-[11px] text-[var(--z-text-3)]">
      <AnchorIcon className="size-3" />
      {count}
    </span>
  );
}

// Subtle radar mark on nodes under Watchtower patrol. Neutral tone — being
// watched is not a status, so it never enters the green/red system.
function WatchBadge({ label, watched }: { label: string; watched: boolean }) {
  if (!watched) {
    return null;
  }
  return (
    <span title={label}>
      <RadarIcon className="size-3 shrink-0 text-[var(--z-text-3)]" />
    </span>
  );
}

// Full card — the "please pay attention" form, reserved for the frontier.
function FrontierCard({
  chipIcon,
  chipLabel,
  chipTone,
  dashed,
  dimmed,
  node,
  onSelect,
  premiseCount = 0,
  selected,
  subNodeCount,
  watchLabel,
  watched,
}: {
  chipIcon: IconComponent;
  chipLabel: string;
  chipTone: keyof typeof CHIP_TONES;
  dashed?: boolean;
  dimmed: boolean;
  node: IRNode;
  onSelect: (nodeId: string) => void;
  premiseCount?: number;
  selected: boolean;
  subNodeCount: number;
  watchLabel?: string;
  watched?: boolean;
}) {
  return (
    <button
      className={cn(
        "w-full rounded-xl border bg-[var(--z-card-bg)] px-3.5 py-2.5 text-left",
        dashed
          ? "border-dashed border-[var(--z-candidate-soft)]"
          : "border-[var(--z-attention-soft)]",
        selected && "bg-[var(--z-node-fill)]"
      )}
      data-testid={`truth-graph-node-${node.id}`}
      onClick={() => onSelect(node.id)}
      style={focusStyle(dimmed)}
      type="button"
    >
      <span className="flex items-center gap-2">
        <TypeChip icon={chipIcon} label={chipLabel} tone={chipTone} />
        <SubNodeBadge count={subNodeCount} />
        <PremiseBadge count={premiseCount} />
        <WatchBadge label={watchLabel ?? ""} watched={watched ?? false} />
      </span>
      <span
        className={cn(
          "mt-1.5 block text-sm leading-relaxed text-[var(--z-text)]",
          selected && "font-medium"
        )}
      >
        {node.title}
      </span>
    </button>
  );
}

// Single row — the "on the record, consult when needed" form for settled
// truths, premises, ideas, and excluded items.
function LaneRow({
  dimmed,
  icon: Icon,
  iconClassName,
  muted,
  node,
  onSelect,
  premiseCount = 0,
  selected,
  strike,
  subNodeCount,
  trailing,
  watchLabel,
  watched,
}: {
  dimmed: boolean;
  icon: IconComponent;
  iconClassName: string;
  muted?: boolean;
  node: IRNode;
  onSelect: (nodeId: string) => void;
  premiseCount?: number;
  selected: boolean;
  strike?: boolean;
  subNodeCount: number;
  trailing?: string;
  watchLabel?: string;
  watched?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--z-node-fill)]",
        selected && "bg-[var(--z-node-fill)]"
      )}
      data-testid={`truth-graph-node-${node.id}`}
      onClick={() => onSelect(node.id)}
      style={focusStyle(dimmed)}
      type="button"
    >
      <Icon className={cn("size-3.5 shrink-0", iconClassName)} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          muted ? "text-[var(--z-text-2)]" : "text-[var(--z-text)]",
          strike && "line-through",
          selected && "font-medium"
        )}
        title={node.title}
      >
        {node.title}
      </span>
      <SubNodeBadge count={subNodeCount} />
      <PremiseBadge count={premiseCount} />
      <WatchBadge label={watchLabel ?? ""} watched={watched ?? false} />
      {trailing ? (
        <span className="shrink-0 text-[11px] text-[var(--z-text-3)]">
          {trailing}
        </span>
      ) : null}
      {/* Disclosure hint: rows open the detail card — say so visually. */}
      <ChevronRightIcon className="size-3.5 shrink-0 text-[var(--z-text-3)] opacity-60" />
    </button>
  );
}

function LaneHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--z-text-3)]",
        className
      )}
    >
      {children}
    </p>
  );
}

function topicDomId(topicId: string | null) {
  return `truth-lane-topic-${topicId ?? "unassigned"}`;
}

function TopicSection({
  isDimmed,
  isWatched,
  lanes,
  model,
  onLayoutChange,
  onSelect,
  selectedNodeId,
  showHeading,
  subCount,
  topic,
}: {
  isDimmed: (nodeId: string) => boolean;
  isWatched: (nodeId: string) => boolean;
  lanes: TopicLanes;
  model: TruthGraphModel;
  onLayoutChange: () => void;
  onSelect: (nodeId: string) => void;
  selectedNodeId: string | null;
  showHeading: boolean;
  subCount: (nodeId: string) => number;
  topic: { id: string | null; label: string };
}) {
  const { t } = useLocale();
  const watchLabel = t("wt.watchedBadge");
  // Controlled fold (amendment №2): small premise sets open by default so
  // their dependency edges draw without interaction; user toggles sync back
  // through onToggle so the badge fallback below stays truthful.
  const [premisesOpen, setPremisesOpen] = useState(
    () => lanes.premises.length <= PREMISES_AUTO_OPEN_MAX
  );
  const premiseIds = useMemo(
    () => new Set(lanes.premises.map((node) => node.id)),
    [lanes.premises]
  );
  const selectedIsPremise = selectedNodeId
    ? premiseIds.has(selectedNodeId)
    : false;
  useEffect(() => {
    if (selectedIsPremise) {
      setPremisesOpen(true);
    }
  }, [selectedIsPremise]);

  // ⚓N badge only while the premises fold hides the edge endpoints.
  const premiseDepCount = (nodeId: string) => {
    if (premisesOpen) {
      return 0;
    }
    return (model.parentEdgesByChild.get(nodeId) ?? []).filter(
      (edge) =>
        QUIET_EDGE_RELATIONS.has(edge.edge.relation) &&
        premiseIds.has(edge.parentId)
    ).length;
  };

  return (
    <section className="mb-8" id={topicDomId(topic.id)}>
      {showHeading ? (
        <h3 className="mb-3 text-[13px] font-semibold text-[var(--z-text)]">
          # {topic.label}
        </h3>
      ) : null}

      {lanes.anchors.length > 0 ? (
        <div className="mb-4 space-y-2">
          {lanes.anchors.map((node) => {
            const isGoal = node.kind === "goal";
            const Icon = isGoal ? TargetIcon : ScaleIcon;
            return (
              <button
                className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-[var(--z-node-fill)]"
                data-testid={`truth-graph-node-${node.id}`}
                key={node.id}
                onClick={() => onSelect(node.id)}
                style={focusStyle(isDimmed(node.id))}
                type="button"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-[var(--z-text-2)]" />
                <span className="min-w-0">
                  <span className="mr-2 text-[11px] font-medium text-[var(--z-text-3)]">
                    {isGoal ? t("graph.laneGoal") : t("graph.lanePrinciple")}
                  </span>
                  <span
                    className={cn(
                      "text-[15px] font-medium leading-relaxed text-[var(--z-text)]",
                      selectedNodeId === node.id && "font-semibold"
                    )}
                  >
                    {node.title}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {lanes.premises.length > 0 ? (
        // Global premises (v1 §6.3) — always present, never occupying the
        // judgment's visual core. Open by default when small (amendment №2)
        // so the dependency edges into them stay drawable.
        <details
          className="group mb-4"
          onToggle={(event) => {
            setPremisesOpen(event.currentTarget.open);
            onLayoutChange();
          }}
          open={premisesOpen}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-[var(--z-text-2)] hover:bg-[var(--z-node-fill)] [&::-webkit-details-marker]:hidden">
            <AnchorIcon className="size-3.5" />
            {t("graph.premisesFold", { count: lanes.premises.length })}
            <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-1 space-y-0.5 pl-4">
            {lanes.premises.map((node) => (
              <LaneRow
                dimmed={isDimmed(node.id)}
                icon={AnchorIcon}
                iconClassName="text-[var(--z-text-3)]"
                key={node.id}
                muted
                node={node}
                onSelect={onSelect}
                selected={selectedNodeId === node.id}
                subNodeCount={subCount(node.id)}
                watched={isWatched(node.id)}
                watchLabel={watchLabel}
              />
            ))}
          </div>
        </details>
      ) : null}

      {lanes.settled.length > 0 ? (
        <div className="mb-5">
          <LaneHeading>
            {t("graph.laneSettled")} · {lanes.settled.length}
          </LaneHeading>
          <div className="space-y-0.5">
            {lanes.settled.map((node) => (
              <LaneRow
                dimmed={isDimmed(node.id)}
                icon={CheckIcon}
                iconClassName="text-[var(--z-confirmed)]"
                key={node.id}
                node={node}
                onSelect={onSelect}
                premiseCount={premiseDepCount(node.id)}
                selected={selectedNodeId === node.id}
                subNodeCount={subCount(node.id)}
                trailing={node.confirmedAt?.slice(0, 10)}
                watched={isWatched(node.id)}
                watchLabel={watchLabel}
              />
            ))}
          </div>
        </div>
      ) : null}

      {frontierCount(lanes) > 0 ? (
        <div className="mb-5">
          <LaneHeading className="text-[var(--z-attention-text)]">
            {t("graph.laneFrontier")} · {t("graph.frontierHint")}
          </LaneHeading>
          <div className="space-y-2">
            {lanes.questions.map((question) => (
              <div className="space-y-2" key={question.id}>
                <FrontierCard
                  chipIcon={HelpCircleIcon}
                  chipLabel={t("graph.chipQuestion")}
                  chipTone="attention"
                  dimmed={isDimmed(question.id)}
                  node={question}
                  onSelect={onSelect}
                  premiseCount={premiseDepCount(question.id)}
                  selected={selectedNodeId === question.id}
                  subNodeCount={subCount(question.id)}
                  watched={isWatched(question.id)}
                  watchLabel={watchLabel}
                />
                {(lanes.candidatesByQuestion.get(question.id) ?? []).map(
                  (candidate) => (
                    // A candidate answer is a compact clickable line
                    // (arrow → text), not a second card, so several options
                    // under one question read as a tight list and the
                    // "answers this" relationship stays visually close.
                    <button
                      className={cn(
                        "ml-5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-[var(--z-node-fill)]",
                        selectedNodeId === candidate.id &&
                          "bg-[var(--z-node-fill)]"
                      )}
                      data-testid={`truth-graph-node-${candidate.id}`}
                      key={candidate.id}
                      onClick={() => onSelect(candidate.id)}
                      style={focusStyle(isDimmed(candidate.id))}
                      title={candidate.title}
                      type="button"
                    >
                      <CornerDownRightIcon className="size-3.5 shrink-0 text-[var(--z-candidate)]" />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm text-[var(--z-candidate-text)]",
                          selectedNodeId === candidate.id && "font-medium"
                        )}
                      >
                        {candidate.title}
                      </span>
                      <SubNodeBadge count={subCount(candidate.id)} />
                      <PremiseBadge count={premiseDepCount(candidate.id)} />
                      <span className="shrink-0 text-[11px] text-[var(--z-text-3)]">
                        {t("graph.chipCandidate")}
                      </span>
                    </button>
                  )
                )}
              </div>
            ))}
            {lanes.looseCandidates.map((candidate) => (
              <FrontierCard
                chipIcon={LightbulbIcon}
                chipLabel={t("graph.chipCandidate")}
                chipTone="candidate"
                dashed
                dimmed={isDimmed(candidate.id)}
                key={candidate.id}
                node={candidate}
                onSelect={onSelect}
                premiseCount={premiseDepCount(candidate.id)}
                selected={selectedNodeId === candidate.id}
                subNodeCount={subCount(candidate.id)}
                watched={isWatched(candidate.id)}
                watchLabel={watchLabel}
              />
            ))}
            {lanes.ideas.map((idea) => (
              <LaneRow
                dimmed={isDimmed(idea.id)}
                icon={LightbulbIcon}
                iconClassName="text-[var(--z-text-3)]"
                key={idea.id}
                muted
                node={idea}
                onSelect={onSelect}
                premiseCount={premiseDepCount(idea.id)}
                selected={selectedNodeId === idea.id}
                subNodeCount={subCount(idea.id)}
                trailing={t("graph.chipIdea")}
              />
            ))}
          </div>
        </div>
      ) : null}

      {lanes.excluded.length > 0 ? (
        // The drawer, not the trash: excluded items stay reachable for
        // review and anti-repetition, folded to a single counted line.
        <details
          className="group"
          onToggle={onLayoutChange}
          open={lanes.excluded.some((node) => node.id === selectedNodeId)}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-[var(--z-text-3)] hover:bg-[var(--z-node-fill)] [&::-webkit-details-marker]:hidden">
            <XIcon className="size-3.5 text-[var(--z-rejected)]" />
            {t("graph.excludedFold", { count: lanes.excluded.length })}
            <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
          </summary>
          <div className="mt-1 space-y-0.5 pl-4">
            {lanes.excluded.map((node) => {
              const replacedBy = node.supersededBy
                ? model.nodeById.get(node.supersededBy)?.title
                : undefined;
              return (
                <LaneRow
                  dimmed={isDimmed(node.id)}
                  icon={XIcon}
                  iconClassName="text-[var(--z-rejected)]"
                  key={node.id}
                  muted
                  node={node}
                  onSelect={onSelect}
                  selected={selectedNodeId === node.id}
                  strike
                  subNodeCount={subCount(node.id)}
                  trailing={
                    replacedBy
                      ? t("graph.replacedBy", { title: replacedBy })
                      : undefined
                  }
                />
              );
            })}
          </div>
        </details>
      ) : null}
    </section>
  );
}

export function SemanticLanes({
  chainNodeIds,
  childrenByParent,
  model,
  onBackgroundClick,
  onSelect,
  selectedNodeId,
  watchedNodeIds,
}: SemanticLanesProps) {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Hover is tracked by delegation on the canvas (one handler, zero changes
  // to the row components) and feeds the quiet-edge overlay's focus states.
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  // Fold toggles bump this so the overlay re-measures (see LaneEdgesOverlay).
  const [layoutVersion, setLayoutVersion] = useState(0);

  const groups = useMemo(
    () =>
      model.topicGroups
        .map((group) => ({
          lanes: splitLanes(group.nodes, model),
          topic: group.topic,
        }))
        .filter(
          ({ lanes }) =>
            lanes.anchors.length +
              lanes.premises.length +
              lanes.settled.length +
              lanes.excluded.length +
              lanes.ideas.length +
              frontierCount(lanes) >
            0
        ),
    [model]
  );

  const totalOpen = useMemo(
    () => groups.reduce((sum, group) => sum + frontierCount(group.lanes), 0),
    [groups]
  );

  const isDimmed = (nodeId: string) =>
    selectedNodeId
      ? !(chainNodeIds.has(nodeId) || nodeId === selectedNodeId)
      : false;
  const subCount = (nodeId: string) =>
    childrenByParent.get(nodeId)?.length ?? 0;
  const isWatched = (nodeId: string) => watchedNodeIds?.has(nodeId) ?? false;

  // Clicking empty space between lanes deselects, matching the old canvas.
  function handleBackground(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onBackgroundClick();
    }
  }

  function handleHover(event: MouseEvent<HTMLDivElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-testid^="truth-graph-node-"]'
    );
    setHoveredNodeId(
      row?.dataset.testid?.slice("truth-graph-node-".length) ?? null
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: background click-to-deselect mirrors the previous canvas surface; nodes remain buttons.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: same rationale — the div is the canvas, not a control.
    // biome-ignore lint/a11y/useKeyWithClickEvents: deselection is a pointer nicety; keyboard users deselect via the detail card close.
    // biome-ignore lint/a11y/useKeyWithMouseEvents: hover only feeds the quiet-edge highlight — keyboard users get the same relationships from the chain card on selection.
    <div
      className="relative mx-auto w-full max-w-3xl py-4 pr-6 pl-[var(--z-lane-gutter)]"
      data-testid="truth-graph-lanes"
      onClick={handleBackground}
      onMouseLeave={() => setHoveredNodeId(null)}
      onMouseOver={handleHover}
      ref={rootRef}
    >
      <LaneEdgesOverlay
        chainNodeIds={chainNodeIds}
        containerRef={rootRef}
        hoveredNodeId={hoveredNodeId}
        layoutVersion={layoutVersion}
        model={model}
        selectedNodeId={selectedNodeId}
      />
      {groups.length > 1 && totalOpen > 0 ? (
        // Project-wide frontier strip (amendment №1 §6): one line, jumps to
        // the topic's spine — never a page change.
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--z-attention-soft)] bg-[var(--z-card-bg)] px-3 py-2">
          <span className="text-xs font-medium text-[var(--z-attention-text)]">
            {t("graph.frontierStrip", { count: totalOpen })}
          </span>
          {groups
            .filter((group) => frontierCount(group.lanes) > 0)
            .map((group) => (
              <button
                className="rounded-full bg-[var(--z-node-fill)] px-2 py-0.5 text-[11px] text-[var(--z-text-2)] hover:text-[var(--z-text)]"
                key={group.topic.id ?? "unassigned"}
                onClick={() =>
                  document
                    .getElementById(topicDomId(group.topic.id))
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                type="button"
              >
                {group.topic.label} · {frontierCount(group.lanes)}
              </button>
            ))}
        </div>
      ) : null}

      {groups.map(({ lanes, topic }) => (
        <TopicSection
          isDimmed={isDimmed}
          isWatched={isWatched}
          key={topic.id ?? "unassigned"}
          lanes={lanes}
          model={model}
          onLayoutChange={() => setLayoutVersion((version) => version + 1)}
          onSelect={onSelect}
          selectedNodeId={selectedNodeId}
          showHeading={groups.length > 1}
          subCount={subCount}
          topic={topic}
        />
      ))}
    </div>
  );
}
