"use client";

import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/components/i18n/locale-provider";
import { LoadingOverlay } from "@/components/loading-overlay";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { IRNode } from "@/lib/ir/types";
import { getIRTypeLabel } from "@/lib/ir/types";

export function ProjectSearchDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { activeProjectId, requestView } = useWorkspace();
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IRNode[] | null>(null);
  const [mode, setMode] = useState<"semantic" | "keyword" | null>(null);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    const trimmed = query.trim();
    if (!(trimmed && activeProjectId)) {
      return;
    }

    setSearching(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/ir/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeProjectId, query: trimmed }),
        }
      );
      if (!response.ok) {
        throw new Error("Search failed");
      }
      const data = (await response.json()) as {
        mode: "semantic" | "keyword";
        results: IRNode[];
      };
      setResults(data.results ?? []);
      setMode(data.mode ?? null);
    } catch (error) {
      console.error(error);
      toast.error(t("dialog.search.failedToast"));
      setResults([]);
      setMode(null);
    } finally {
      setSearching(false);
    }
  }

  function openResult() {
    // Jump to the truth graph so the match can be explored in context.
    requestView("truth-graph");
    onOpenChange(false);
  }

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="max-h-[82vh] w-[92vw] gap-4 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("dialog.search.title")}</DialogTitle>
            <DialogDescription>
              {t("dialog.search.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <Input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runSearch();
                }
              }}
              placeholder={t("dialog.search.placeholder")}
              value={query}
            />
            <Button
              disabled={!query.trim() || searching}
              onClick={runSearch}
              size="sm"
            >
              <SearchIcon className="size-4" />
              {t("dialog.search.button")}
            </Button>
          </div>

          {results && results.length > 0 && mode ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              {mode === "semantic"
                ? t("dialog.search.rankedByRelevance")
                : t("dialog.search.keywordMatches")}
            </p>
          ) : null}

          <div className="max-h-[60vh] min-h-[40vh] space-y-1 overflow-y-auto pr-1">
            {results === null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("dialog.search.prompt")}
              </p>
            ) : results.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("dialog.search.noMatches")}
              </p>
            ) : (
              results.map((node) => (
                <button
                  className="flex w-full flex-col gap-0.5 rounded-lg border border-border/50 px-3 py-2 text-left transition-colors hover:bg-accent"
                  key={node.id}
                  onClick={openResult}
                  type="button"
                >
                  <span className="break-words font-medium text-foreground text-sm">
                    {node.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {getIRTypeLabel(node.kind, node.subtype)} · {node.status}
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <LoadingOverlay
        message={t("dialog.search.overlayMessage")}
        show={searching}
        submessage={t("dialog.search.overlaySubmessage")}
      />
    </>
  );
}
