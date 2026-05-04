"use client";

import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  getDecisionKindBadgeLabel,
  getDecisionKindTone,
} from "@/lib/decision-kinds";
import { cn } from "@/lib/utils";
import type {
  WorkspaceDecision,
  WorkspaceEdge,
  WorkspaceTruthSnapshot,
} from "@/lib/workspace/types";

type ResolveKind = "plan" | "constraint" | "principle" | "hypothesis" | "goal";

function buildRelationLabel(
  edge: WorkspaceEdge,
  direction: "outgoing" | "incoming",
  title: string
) {
  if (edge.type === "depends_on") {
    return direction === "outgoing"
      ? `depends on ${title}`
      : `depended on by ${title}`;
  }

  if (edge.type === "resolved_by") {
    return direction === "outgoing"
      ? `resolves → ${title}`
      : `resolved by ${title}`;
  }

  return null;
}

function buildStructuredContext(decision: WorkspaceDecision) {
  return [
    `[${decision.id} · ${decision.kind}] ${decision.title}`,
    decision.content,
    decision.rationale?.trim() ? `Because: ${decision.rationale.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function DecisionDetail({
  decision,
  decisions,
  edges,
  onClose,
  onUpdated,
}: {
  decision: WorkspaceDecision | null;
  decisions: WorkspaceDecision[];
  edges: WorkspaceEdge[];
  onClose: () => void;
  onUpdated: (snapshot: WorkspaceTruthSnapshot) => void;
}) {
  const {
    activeTopicId,
    bringDecisionToSandbox,
    setSelectedDecisionId,
    queueReferenceDraft,
  } = useWorkspace();
  const [injected, setInjected] = useState(false);
  const [quoted, setQuoted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(
    null
  );
  const [resolveOpen, setResolveOpen] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveKind, setResolveKind] = useState<ResolveKind>("plan");
  const [resolveTitle, setResolveTitle] = useState("");
  const [resolveContent, setResolveContent] = useState("");
  const [resolveRationale, setResolveRationale] = useState("");
  const decisionById = useMemo(
    () => new Map(decisions.map((entry) => [entry.id, entry])),
    [decisions]
  );

  const relations = useMemo(() => {
    if (!decision) {
      return [];
    }

    return edges.flatMap((edge) => {
      if (edge.type !== "depends_on" && edge.type !== "resolved_by") {
        return [];
      }

      if (edge.sourceDecisionId === decision.id) {
        const target = decisionById.get(edge.targetDecisionId);
        const label = buildRelationLabel(
          edge,
          "outgoing",
          target?.title ?? edge.targetDecisionId
        );

        return label
          ? [{ label, targetId: edge.targetDecisionId, edgeType: edge.type }]
          : [];
      }

      if (edge.targetDecisionId === decision.id) {
        const source = decisionById.get(edge.sourceDecisionId);
        const label = buildRelationLabel(
          edge,
          "incoming",
          source?.title ?? edge.sourceDecisionId
        );

        return label
          ? [{ label, targetId: edge.sourceDecisionId, edgeType: edge.type }]
          : [];
      }

      return [];
    });
  }, [decision, decisionById, edges]);

  const versionHistory = useMemo(() => {
    if (!decision) {
      return [];
    }

    const history: WorkspaceDecision[] = [];
    let cursorId = decision.id;
    const seen = new Set<string>();

    while (cursorId && !seen.has(cursorId)) {
      seen.add(cursorId);
      const supersedesEdge = edges.find(
        (edge) =>
          edge.type === "supersedes" && edge.sourceDecisionId === cursorId
      );

      if (!supersedesEdge) {
        break;
      }

      const previous = decisionById.get(supersedesEdge.targetDecisionId);

      if (!previous) {
        break;
      }

      history.push(previous);
      cursorId = previous.id;
    }

    return history;
  }, [decision, decisionById, edges]);

  if (!decision) {
    return (
      <aside className="pointer-events-none absolute inset-y-0 right-0 w-full translate-x-full border-l border-border/60 bg-background/95 transition-transform duration-200 ease-out" />
    );
  }

  const currentDecision = decision;
  const isOpenQuestion =
    currentDecision.kind === "open_question" &&
    currentDecision.status === "active";

  async function handleInjectContext() {
    const success = await bringDecisionToSandbox({
      decisionId: currentDecision.id,
      decisionTitle: currentDecision.title,
      kind: currentDecision.kind,
      content: currentDecision.content,
      rationale: currentDecision.rationale,
    });

    if (success) {
      setInjected(true);
      window.setTimeout(() => setInjected(false), 1000);
    }
  }

  function handleQuote() {
    queueReferenceDraft(
      `> [${currentDecision.id} · ${currentDecision.kind}] ${currentDecision.title}\n> ${currentDecision.content}`
    );
    setQuoted(true);
    window.setTimeout(() => setQuoted(false), 1000);
  }

  async function handleResolveOpenQuestion() {
    if (!activeTopicId) {
      return;
    }

    setIsResolving(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/decisions/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            decisionId: currentDecision.id,
            topicId: activeTopicId,
            kind: resolveKind,
            title: resolveTitle.trim(),
            content: resolveContent.trim(),
            rationale: resolveRationale.trim() || null,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to resolve open question");
      }

      const payload = (await response.json()) as {
        decision: WorkspaceDecision;
        snapshot: WorkspaceTruthSnapshot;
      };

      onUpdated(payload.snapshot);
      setSelectedDecisionId(payload.decision.id);
      setResolveOpen(false);
      toast.success("Open question resolved into a decision.");
    } catch (error) {
      console.error(error);
      toast.error("Failed to resolve open question.");
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-20 w-full border-l border-border/60 bg-background/95 shadow-[-18px_0_40px_rgba(0,0,0,0.08)] backdrop-blur transition-transform duration-200 ease-out",
        decision ? "translate-x-0" : "translate-x-full"
      )}
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/50 bg-background/95 px-4 py-4 backdrop-blur">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Decision Detail
          </p>
          <h3 className="mt-1 text-base font-semibold text-foreground">
            {decision.title}
          </h3>
        </div>
        <Button onClick={onClose} size="icon-sm" variant="ghost">
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="flex h-[calc(100%-72px)] flex-col gap-5 overflow-y-auto px-4 py-4">
        {isOpenQuestion && (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-900">
            This is an open question — no decision yet.
          </div>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={getDecisionKindTone(decision.kind)}
              variant="outline"
            >
              {getDecisionKindBadgeLabel(decision.kind)}
            </Badge>
            <Badge variant="secondary">active</Badge>
            <Badge variant="outline">{decision.weight}</Badge>
          </div>
          <p className="text-sm leading-6 text-foreground">
            {decision.content}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Because
          </p>
          <div className="border-l-2 border-border/70 pl-3">
            <p className="text-sm leading-6 text-muted-foreground">
              {decision.rationale ?? "No rationale captured yet."}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Confirmed {new Date(decision.createdAt).toLocaleString()}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Relations
          </p>
          {relations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No linked relations yet.
            </p>
          ) : (
            relations.map((relation) => (
              <button
                className="rounded-xl border border-border/50 px-3 py-2 text-left text-sm transition-colors hover:border-border hover:bg-card/70"
                key={`${decision.id}-${relation.targetId}-${relation.label}`}
                onClick={() => setSelectedDecisionId(relation.targetId)}
                type="button"
              >
                {relation.label}
              </button>
            ))
          )}
        </section>

        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Actions
          </p>
          <Button
            className={cn(
              injected && "bg-emerald-600 text-white hover:bg-emerald-600"
            )}
            onClick={() => {
              handleInjectContext().catch(console.error);
            }}
            size="sm"
          >
            {injected ? <CheckIcon className="size-4" /> : null}
            {isOpenQuestion ? "讨论这个问题" : "拉入对话"}
          </Button>
          <Button
            className={cn(quoted && "ring-2 ring-foreground/20")}
            onClick={handleQuote}
            size="sm"
            variant="outline"
          >
            引用
          </Button>
          {isOpenQuestion && (
            <Button
              onClick={() => {
                setResolveKind("plan");
                setResolveTitle(currentDecision.title);
                setResolveContent(currentDecision.content);
                setResolveRationale(currentDecision.rationale ?? "");
                setResolveOpen((current) => !current);
              }}
              size="sm"
              variant="default"
            >
              解决为决策
            </Button>
          )}
          {isOpenQuestion && resolveOpen && (
            <div className="rounded-2xl border border-border/60 bg-card/50 p-3">
              <div className="grid gap-3">
                <select
                  className="h-10 rounded-xl border border-border/60 bg-background px-3 text-sm"
                  onChange={(event) =>
                    setResolveKind(event.target.value as ResolveKind)
                  }
                  value={resolveKind}
                >
                  <option value="plan">plan</option>
                  <option value="constraint">constraint</option>
                  <option value="principle">principle</option>
                  <option value="hypothesis">hypothesis</option>
                  <option value="goal">goal</option>
                </select>
                <Input
                  onChange={(event) => setResolveTitle(event.target.value)}
                  placeholder="Decision title"
                  value={resolveTitle}
                />
                <Textarea
                  onChange={(event) => setResolveContent(event.target.value)}
                  placeholder="Decision content"
                  rows={4}
                  value={resolveContent}
                />
                <Textarea
                  onChange={(event) => setResolveRationale(event.target.value)}
                  placeholder="Rationale (optional)"
                  rows={3}
                  value={resolveRationale}
                />
                <div className="flex gap-2">
                  <Button
                    disabled={
                      isResolving ||
                      !resolveTitle.trim() ||
                      !resolveContent.trim()
                    }
                    onClick={() => {
                      handleResolveOpenQuestion().catch(console.error);
                    }}
                    size="sm"
                  >
                    Confirm
                  </Button>
                  <Button
                    onClick={() => setResolveOpen(false)}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        {versionHistory.length > 0 && (
          <section className="flex flex-col gap-2">
            <button
              className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-2 text-left"
              onClick={() => setHistoryOpen((current) => !current)}
              type="button"
            >
              <span className="text-sm font-medium text-foreground">
                历史版本 ({versionHistory.length} 次变更)
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-transform duration-200",
                  historyOpen && "rotate-180"
                )}
              />
            </button>
            <div
              className={cn(
                "grid transition-all duration-200 ease-out",
                historyOpen
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-70"
              )}
            >
              <div className="overflow-hidden">
                <div className="flex flex-col gap-2 pt-1">
                  {versionHistory.map((version, index) => {
                    const summary =
                      version.rationale?.split(/[。.!?]/)[0]?.trim() ||
                      version.content.slice(0, 80);
                    const expanded = expandedVersionId === version.id;

                    return (
                      <div
                        className="rounded-xl border border-border/50 bg-card/60"
                        key={version.id}
                      >
                        <button
                          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                          onClick={() =>
                            setExpandedVersionId((current) =>
                              current === version.id ? null : version.id
                            )
                          }
                          type="button"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              v{versionHistory.length - index} ·{" "}
                              {new Date(version.createdAt).toLocaleDateString()}{" "}
                              · {summary}
                            </p>
                          </div>
                          <ChevronDownIcon
                            className={cn(
                              "size-4 transition-transform duration-200",
                              expanded && "rotate-180"
                            )}
                          />
                        </button>
                        <div
                          className={cn(
                            "grid transition-all duration-200 ease-out",
                            expanded
                              ? "grid-rows-[1fr] opacity-100"
                              : "grid-rows-[0fr] opacity-70"
                          )}
                        >
                          <div className="overflow-hidden">
                            <div className="border-t border-border/50 px-3 py-3">
                              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                                {version.content}
                              </p>
                              {version.rationale && (
                                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                  {version.rationale}
                                </p>
                              )}
                              <p className="mt-3 text-xs text-muted-foreground">
                                confirmed_in{" "}
                                {new Date(version.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
