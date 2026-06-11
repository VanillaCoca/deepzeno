"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/chat/toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { KickoffReviewDialog } from "@/components/kickoff/kickoff-review-dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { KickoffProposal } from "@/lib/kickoff/proposal";
import { fetcher, fetchWithErrorHandlers } from "@/lib/utils";

export function KickoffBanner() {
  const { t } = useLocale();
  const { activeProjectId, activeTopic } = useWorkspace();
  const isGeneral = Boolean(activeTopic?.isGeneral);
  const { data, mutate } = useSWR<{ state: string }>(
    activeProjectId && isGeneral
      ? `/api/kickoff/status?projectId=${activeProjectId}`
      : null,
    fetcher
  );
  const [isProposing, setIsProposing] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [proposal, setProposal] = useState<KickoffProposal | null>(null);
  const [proposalVersion, setProposalVersion] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);

  if (!(activeProjectId && isGeneral) || data?.state !== "intake") {
    return null;
  }

  async function handlePropose() {
    setIsProposing(true);

    try {
      const response = await fetchWithErrorHandlers("/api/kickoff/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: activeProjectId }),
      });
      const result = (await response.json()) as { proposal: KickoffProposal };

      if (result.proposal.topics.length === 0) {
        toast({ type: "error", description: t("kickoff.emptyProposal") });
        return;
      }

      setProposal(result.proposal);
      setProposalVersion((v) => v + 1);
      setReviewOpen(true);
    } catch (error) {
      console.error(error);
      // ChatbotError stores the server cause string in error.cause (not error.message,
      // which is the visibility-filtered generic text from getMessageByErrorCode).
      // The synthesize route throws cause = "Answer the intake questions…" so we
      // detect the intake case via error.cause rather than error.message.
      const isIntakeError =
        error instanceof Error && /intake/i.test(String(error.cause));
      toast({
        type: "error",
        description: isIntakeError
          ? t("kickoff.needsAnswers")
          : t("kickoff.failedToast"),
      });
      await mutate();
    } finally {
      setIsProposing(false);
    }
  }

  async function handleSkip() {
    setIsSkipping(true);

    try {
      await fetchWithErrorHandlers("/api/kickoff/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: activeProjectId }),
      });
      toast({ type: "success", description: t("kickoff.skippedToast") });
      await mutate();
    } catch (error) {
      console.error(error);
      toast({ type: "error", description: t("kickoff.failedToast") });
    } finally {
      setIsSkipping(false);
    }
  }

  return (
    <>
      <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-4 text-sm">
        <p className="font-medium text-foreground">
          {t("kickoff.bannerTitle")}
        </p>
        <p className="mt-1 text-muted-foreground">{t("kickoff.bannerBody")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={isProposing || isSkipping}
            onClick={handlePropose}
            size="sm"
          >
            {isProposing ? t("kickoff.proposing") : t("kickoff.propose")}
          </Button>
          <Button
            disabled={isProposing || isSkipping}
            onClick={handleSkip}
            size="sm"
            variant="ghost"
          >
            {t("kickoff.skip")}
          </Button>
        </div>
      </div>
      {proposal ? (
        <KickoffReviewDialog
          key={proposalVersion}
          onConfirmed={() => mutate()}
          onOpenChange={setReviewOpen}
          open={reviewOpen}
          proposal={proposal}
        />
      ) : null}
    </>
  );
}
