"use client";

import { useMemo, useState } from "react";
import { toast } from "@/components/chat/toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  type KickoffProposal,
  statusForConfidence,
} from "@/lib/kickoff/proposal";
import { fetchWithErrorHandlers } from "@/lib/utils";

type ReviewTopic = KickoffProposal["topics"][number] & {
  checked: boolean;
  rowId: number;
};

export function KickoffReviewDialog({
  proposal,
  open,
  onOpenChange,
  onConfirmed,
}: {
  proposal: KickoffProposal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => void;
}) {
  const { t } = useLocale();
  const { activeProjectId, refreshWorkspace } = useWorkspace();
  const [topics, setTopics] = useState<ReviewTopic[]>(() =>
    proposal.topics.map((topic, i) => ({ ...topic, checked: true, rowId: i }))
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checkedTopics = useMemo(
    () => topics.filter((topic) => topic.checked),
    [topics]
  );
  const nodeCount = checkedTopics.reduce(
    (sum, topic) => sum + topic.nodes.length,
    0
  );

  async function handleConfirm() {
    if (!activeProjectId || checkedTopics.length === 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetchWithErrorHandlers("/api/kickoff/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: activeProjectId,
          topics: checkedTopics.map(
            ({ checked: _checked, rowId: _rowId, ...topic }) => ({
              ...topic,
              name: topic.name.trim(),
            })
          ),
        }),
      });
      const result = (await response.json()) as {
        topics: Array<{ id: string; label: string }>;
        pending_created: number;
        ideas_created: number;
      };

      toast({
        type: "success",
        description: t("kickoff.confirmedToast", {
          topics: result.topics.length,
          pending: result.pending_created,
          ideas: result.ideas_created,
        }),
      });
      await refreshWorkspace();
      onOpenChange(false);
      onConfirmed();
    } catch (error) {
      console.error(error);
      toast({ type: "error", description: t("kickoff.failedToast") });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("kickoff.reviewTitle")}</DialogTitle>
          <DialogDescription>{t("kickoff.reviewBody")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {topics.map((topic, index) => {
            const pending = topic.nodes.filter(
              (node) => statusForConfidence(node.confidence) === "pending"
            ).length;
            const ideas = topic.nodes.length - pending;

            return (
              <div
                className="rounded-lg border border-border/60 p-3"
                key={topic.rowId}
              >
                <div className="flex items-center gap-2">
                  <input
                    aria-label={topic.name}
                    checked={topic.checked}
                    className="size-4 shrink-0 accent-foreground"
                    onChange={(event) =>
                      setTopics((current) =>
                        current.map((entry, i) =>
                          i === index
                            ? { ...entry, checked: event.target.checked }
                            : entry
                        )
                      )
                    }
                    type="checkbox"
                  />
                  <Input
                    aria-label={t("kickoff.reviewTitle")}
                    className="h-8 flex-1 text-sm font-medium"
                    maxLength={120}
                    onChange={(event) =>
                      setTopics((current) =>
                        current.map((entry, i) =>
                          i === index
                            ? { ...entry, name: event.target.value }
                            : entry
                        )
                      )
                    }
                    value={topic.name}
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("kickoff.seedCount", { pending, ideas })}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("kickoff.charterLabel")}: {topic.charter}
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {topic.nodes.map((node, nodeIndex) => (
                    <li
                      className="flex items-baseline gap-2 text-sm"
                      key={`${node.title}-${nodeIndex}`}
                    >
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {node.kind.replace("_", " ")}
                      </span>
                      <span className="min-w-0 flex-1">{node.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {statusForConfidence(node.confidence)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            {t("kickoff.cancel")}
          </Button>
          <Button
            disabled={
              isSubmitting ||
              checkedTopics.length === 0 ||
              checkedTopics.some((topic) => !topic.name.trim())
            }
            onClick={handleConfirm}
          >
            {t("kickoff.confirm", {
              topics: checkedTopics.length,
              nodes: nodeCount,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
