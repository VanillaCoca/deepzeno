"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTopicTruth } from "@/hooks/use-topic-truth";
import {
  getDecisionKindBadgeLabel,
  getDecisionKindTone,
} from "@/lib/decision-kinds";
import { cn } from "@/lib/utils";
import type {
  WorkspaceCandidateDecision,
  WorkspaceTruthSnapshot,
} from "@/lib/workspace/types";

const EMPTY_CANDIDATES: WorkspaceCandidateDecision[] = [];

function formatConfidence(confidence: number | null) {
  if (confidence === null) {
    return null;
  }

  const normalized = confidence > 1 ? confidence : confidence * 100;
  return `${Math.round(normalized)}% confidence`;
}

function getSourceLabel(candidate: WorkspaceCandidateDecision) {
  const sourceMetadata = candidate.sourceMetadata ?? {};
  const candidateSourceLabel =
    (typeof sourceMetadata.source_model === "string" &&
      sourceMetadata.source_model) ||
    (typeof sourceMetadata.model === "string" && sourceMetadata.model) ||
    (typeof sourceMetadata.agent === "string" && sourceMetadata.agent) ||
    (typeof sourceMetadata.source === "string" && sourceMetadata.source) ||
    null;

  if (candidateSourceLabel) {
    return candidateSourceLabel;
  }

  if (candidate.source === "zeno_extraction") {
    return "ZENO extraction";
  }

  return candidate.source.replaceAll("_", " ");
}

export function CandidatePool() {
  const { activeTopicId, isGeneralTopic, isLoading, mutate, snapshot } =
    useTopicTruth();
  const candidates = snapshot?.pendingCandidates ?? EMPTY_CANDIDATES;
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(
    null
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isPulsing, setIsPulsing] = useState(false);
  const knownCandidateIdsRef = useRef<string[] | null>(null);
  const previousTopicIdRef = useRef<string | null>(null);

  useEffect(() => {
    setCheckedIds((current) => {
      const next: Record<string, boolean> = {};

      for (const candidate of candidates) {
        next[candidate.id] = current[candidate.id] ?? candidate.preSelected;
      }

      const currentIds = Object.keys(current);
      const nextIds = Object.keys(next);
      const hasSameEntries =
        currentIds.length === nextIds.length &&
        nextIds.every(
          (candidateId) => current[candidateId] === next[candidateId]
        );

      if (hasSameEntries) {
        return current;
      }

      return next;
    });
  }, [candidates]);

  useEffect(() => {
    const candidateIds = candidates.map((candidate) => candidate.id);
    const topicChanged = previousTopicIdRef.current !== activeTopicId;

    if (topicChanged) {
      previousTopicIdRef.current = activeTopicId;
      knownCandidateIdsRef.current = snapshot ? candidateIds : null;
      setExpandedCandidateId(null);
      setIsExpanded(false);
      setUnreadCount(0);
      setIsPulsing(false);
      return;
    }

    if (knownCandidateIdsRef.current === null) {
      if (snapshot === null && isLoading) {
        return;
      }

      knownCandidateIdsRef.current = candidateIds;
      return;
    }

    const knownCandidateIds = knownCandidateIdsRef.current ?? [];
    const newIds = candidateIds.filter(
      (candidateId) => !knownCandidateIds.includes(candidateId)
    );

    if (!isExpanded && newIds.length > 0) {
      setUnreadCount((current) => current + newIds.length);
      setIsPulsing(true);
    }

    knownCandidateIdsRef.current = candidateIds;
  }, [activeTopicId, candidates, isExpanded, isLoading, snapshot]);

  useEffect(() => {
    if (!isPulsing) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsPulsing(false);
    }, 600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isPulsing]);

  const selectedCandidateIds = useMemo(
    () =>
      candidates
        .filter((candidate) => checkedIds[candidate.id] !== false)
        .map((candidate) => candidate.id),
    [candidates, checkedIds]
  );

  async function post(path: string, body: Record<string, unknown>) {
    setIsMutating(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const payload = (await response.json()) as WorkspaceTruthSnapshot;
      await mutate(payload, false);
    } catch (error) {
      console.error(error);
      toast.error("Failed to update candidate decisions.");
    } finally {
      setIsMutating(false);
    }
  }

  function toggleExpanded() {
    setIsExpanded((current) => {
      const next = !current;

      if (next) {
        setUnreadCount(0);
      } else {
        setExpandedCandidateId(null);
      }

      return next;
    });
  }

  const collapsedLabel =
    isLoading && snapshot === null
      ? "Loading candidates..."
      : candidates.length > 0
        ? `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} pending`
        : "No pending candidates";

  const expandedEmptyMessage = isGeneralTopic
    ? "General topic keeps the sandbox chat-only, so candidates are not collected here."
    : "New extracted candidates will appear here.";

  return (
    <section
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-border/35 bg-card/45 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.28)] backdrop-blur-sm transition-all duration-200",
        isExpanded ? "max-h-[50dvh]" : "max-h-12",
        candidates.length === 0 && !isLoading && "opacity-50",
        isPulsing && "animate-[glow-pulse_0.6s_ease-out_1]"
      )}
      data-testid="candidate-pool"
    >
      <button
        aria-expanded={isExpanded}
        className="flex h-12 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-accent/20"
        data-testid="candidate-pool-toggle"
        onClick={toggleExpanded}
        type="button"
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-background/70 text-muted-foreground">
          <SparklesIcon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{collapsedLabel}</p>
        </div>
        {unreadCount > 0 && !isExpanded ? (
          <Badge
            className="rounded-full border-border/50 bg-background/80 px-2 py-0.5 text-[11px] text-foreground"
            data-testid="candidate-pool-unread-badge"
            variant="outline"
          >
            +{unreadCount}
          </Badge>
        ) : null}
        {isExpanded ? (
          <ChevronUpIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {isExpanded ? (
        <div className="flex max-h-[calc(50dvh-3rem)] min-h-0 flex-col border-t border-border/40">
          <div
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
            data-testid="candidate-pool-list"
          >
            {isLoading && snapshot === null ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                Loading candidates...
              </div>
            ) : candidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                {expandedEmptyMessage}
              </div>
            ) : (
              candidates.map((candidate) => {
                const isCandidateExpanded =
                  expandedCandidateId === candidate.id;
                const confidenceLabel = formatConfidence(candidate.confidence);
                const sourceLabel = getSourceLabel(candidate);

                return (
                  <div
                    className="rounded-2xl border border-border/60 bg-background/75 p-3 transition-colors hover:border-border"
                    key={candidate.id}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        checked={checkedIds[candidate.id] !== false}
                        className="mt-1 h-4 w-4 rounded border-border"
                        onChange={(event) =>
                          setCheckedIds((current) => ({
                            ...current,
                            [candidate.id]: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p
                            className={cn(
                              "truncate text-sm font-medium text-foreground",
                              candidate.proposedKind === "rejection" &&
                                "line-through opacity-70"
                            )}
                          >
                            {candidate.proposedTitle ?? "Untitled candidate"}
                          </p>
                          <Badge
                            className={getDecisionKindTone(
                              candidate.proposedKind ?? "plan"
                            )}
                            variant="outline"
                          >
                            {getDecisionKindBadgeLabel(
                              candidate.proposedKind ?? "plan"
                            )}
                          </Badge>
                          {confidenceLabel ? (
                            <Badge variant="secondary">{confidenceLabel}</Badge>
                          ) : null}
                          <Badge variant="secondary">{sourceLabel}</Badge>
                        </div>
                        <button
                          className="mt-2 text-left text-sm leading-6 text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() =>
                            setExpandedCandidateId((current) =>
                              current === candidate.id ? null : candidate.id
                            )
                          }
                          type="button"
                        >
                          <span
                            className={cn(
                              !isCandidateExpanded && "line-clamp-2"
                            )}
                          >
                            {candidate.proposedContent}
                          </span>
                        </button>
                        {candidate.externalEvidence ? (
                          <a
                            className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4"
                            href={candidate.externalEvidence}
                            rel="noreferrer"
                            target="_blank"
                          >
                            external evidence
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border/50 bg-background/95 px-4 py-3 backdrop-blur">
            <Button
              disabled={!activeTopicId || candidates.length === 0 || isMutating}
              onClick={() =>
                activeTopicId &&
                post("/api/workspace/candidates/confirm", {
                  topicId: activeTopicId,
                  selectedCandidateIds,
                })
              }
              size="sm"
            >
              <CheckIcon className="size-4" />
              Confirm Selected
            </Button>
            <Button
              disabled={!activeTopicId || candidates.length === 0 || isMutating}
              onClick={() =>
                activeTopicId &&
                post("/api/workspace/candidates/dismiss", {
                  topicId: activeTopicId,
                })
              }
              size="sm"
              variant="outline"
            >
              <XIcon className="size-4" />
              Dismiss All
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
