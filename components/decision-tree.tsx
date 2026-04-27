"use client";

import { ChevronDownIcon, GitBranchIcon, Layers3Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  decisionKindOrder,
  getDecisionKindBadgeLabel,
  getDecisionKindLabel,
  getDecisionKindTone,
} from "@/lib/decision-kinds";
import { cn } from "@/lib/utils";
import type { WorkspaceDecision, WorkspaceEdge } from "@/lib/workspace/types";

type ViewMode = "type" | "relation";

function kindPriority(kind: string) {
  const index = decisionKindOrder.indexOf(kind as (typeof decisionKindOrder)[number]);
  return index >= 0 ? index : decisionKindOrder.length;
}

function DecisionNode({
  decision,
  depth = 0,
  relationLabel,
}: {
  decision: WorkspaceDecision;
  depth?: number;
  relationLabel?: string;
}) {
  const { selectedDecisionId, setSelectedDecisionId } = useWorkspace();
  const isOpenQuestion = decision.kind === "open_question";
  const isRejection = decision.kind === "rejection";

  return (
    <div className="flex flex-col gap-2" style={{ marginLeft: depth * 12 }}>
      {relationLabel ? (
        <p className="pl-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {relationLabel}
        </p>
      ) : null}
      <button
        className={cn(
          "flex w-full items-start gap-2 rounded-xl border border-border/50 bg-card/70 px-3 py-2 text-left transition-colors hover:border-border hover:bg-card",
          selectedDecisionId === decision.id &&
            "border-foreground/20 bg-accent/40"
        )}
        onClick={() => setSelectedDecisionId(decision.id)}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isOpenQuestion ? (
              <span className="text-sm font-semibold text-amber-700">?</span>
            ) : null}
            <p
              className={cn(
                "truncate text-sm font-medium",
                isRejection && "line-through opacity-65"
              )}
            >
              {decision.title}
            </p>
            <Badge className={getDecisionKindTone(decision.kind)} variant="outline">
              {getDecisionKindBadgeLabel(decision.kind)}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {decision.content}
          </p>
        </div>
      </button>
    </div>
  );
}

export function DecisionTree({
  decisions,
  edges,
  isLoading,
}: {
  decisions: WorkspaceDecision[];
  edges: WorkspaceEdge[];
  isLoading: boolean;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("type");
  const [collapsedKinds, setCollapsedKinds] = useState<Record<string, boolean>>({
    rejection: true,
  });

  const visibleDecisions = useMemo(
    () => decisions.filter((decision) => decision.status === "active"),
    [decisions]
  );
  const decisionById = useMemo(
    () => new Map(visibleDecisions.map((decision) => [decision.id, decision])),
    [visibleDecisions]
  );

  const groupedByKind = useMemo(() => {
    const groups = new Map<string, WorkspaceDecision[]>();

    for (const kind of decisionKindOrder) {
      groups.set(kind, []);
    }

    for (const decision of visibleDecisions) {
      const current = groups.get(decision.kind) ?? [];
      current.push(decision);
      groups.set(decision.kind, current);
    }

    return [...groups.entries()]
      .map(([kind, entries]) => [
        kind,
        [...entries].sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt)
        ),
      ] as const)
      .filter(([, entries]) => entries.length > 0)
      .sort(([leftKind], [rightKind]) => kindPriority(leftKind) - kindPriority(rightKind));
  }, [visibleDecisions]);

  const relationGraph = useMemo(() => {
    const children = new Map<
      string,
      Array<{ decision: WorkspaceDecision; label?: string }>
    >();
    const attachedIds = new Set<string>();
    const childIds = new Set<string>();

    for (const edge of edges) {
      if (edge.type !== "depends_on" && edge.type !== "resolved_by") {
        continue;
      }

      const source = decisionById.get(edge.sourceDecisionId);
      const target = decisionById.get(edge.targetDecisionId);

      if (!source || !target) {
        continue;
      }

      if (edge.type === "depends_on") {
        attachedIds.add(source.id);
        attachedIds.add(target.id);
        childIds.add(source.id);
        children.set(target.id, [
          ...(children.get(target.id) ?? []),
          { decision: source },
        ]);
      }

      if (edge.type === "resolved_by") {
        attachedIds.add(source.id);
        attachedIds.add(target.id);
        childIds.add(source.id);
        children.set(target.id, [
          ...(children.get(target.id) ?? []),
          { decision: source, label: "resolved by" },
        ]);
      }
    }

    const roots = visibleDecisions
      .filter(
        (decision) => attachedIds.has(decision.id) && !childIds.has(decision.id)
      )
      .sort((left, right) => {
        if (left.weight === "anchor" && right.weight !== "anchor") {
          return -1;
        }

        if (right.weight === "anchor" && left.weight !== "anchor") {
          return 1;
        }

        return right.createdAt.localeCompare(left.createdAt);
      });

    const standalone = visibleDecisions
      .filter((decision) => !attachedIds.has(decision.id))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return { children, roots, standalone };
  }, [decisionById, edges, visibleDecisions]);

  function renderRelationNode(
    decision: WorkspaceDecision,
    depth = 0,
    relationLabel?: string
  ): React.ReactNode {
    const children = relationGraph.children.get(decision.id) ?? [];

    return (
      <div className="flex flex-col gap-2" key={decision.id}>
        <DecisionNode
          decision={decision}
          depth={depth}
          relationLabel={relationLabel}
        />
        {children.map((child) =>
          renderRelationNode(child.decision, depth + 1, child.label)
        )}
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border/60 bg-background/85 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Decision Tree</p>
          <p className="text-xs text-muted-foreground">
            Active truth for the current topic
          </p>
        </div>
        <div className="flex items-center rounded-xl border border-border/60 bg-card/70 p-1">
          <Button
            onClick={() => setViewMode("type")}
            size="sm"
            variant={viewMode === "type" ? "secondary" : "ghost"}
          >
            <Layers3Icon className="size-4" />
            By Type
          </Button>
          <Button
            onClick={() => setViewMode("relation")}
            size="sm"
            variant={viewMode === "relation" ? "secondary" : "ghost"}
          >
            <GitBranchIcon className="size-4" />
            By Relation
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {isLoading && visibleDecisions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
            Loading decisions...
          </div>
        ) : visibleDecisions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
            Confirmed decisions will appear here.
          </div>
        ) : viewMode === "type" ? (
          groupedByKind.map(([kind, entries]) => {
            const isCollapsed = collapsedKinds[kind] === true;

            return (
              <div className="flex flex-col gap-2" key={kind}>
                <button
                  className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2 text-left text-sm font-medium"
                  onClick={() =>
                    setCollapsedKinds((current) => ({
                      ...current,
                      [kind]: !current[kind],
                    }))
                  }
                  type="button"
                >
                  <span>{getDecisionKindLabel(kind)} ({entries.length})</span>
                  <ChevronDownIcon
                    className={cn(
                      "size-4 transition-transform duration-200",
                      isCollapsed && "-rotate-90"
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-200 ease-out",
                    isCollapsed
                      ? "grid-rows-[0fr] opacity-70"
                      : "grid-rows-[1fr] opacity-100"
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="flex flex-col gap-2 pt-1">
                      {entries.map((decision) => (
                        <DecisionNode decision={decision} key={decision.id} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <>
            {relationGraph.roots.map((decision) => renderRelationNode(decision))}
            {relationGraph.standalone.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Standalone
                </p>
                {relationGraph.standalone.map((decision) => (
                  <DecisionNode decision={decision} key={decision.id} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
