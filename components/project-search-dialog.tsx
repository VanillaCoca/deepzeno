"use client";

import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
      toast.error("Search failed.");
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>
              Search across this project's truths, candidates, and ideas.
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
              placeholder="Search the project…"
              value={query}
            />
            <Button
              disabled={!query.trim() || searching}
              onClick={runSearch}
              size="sm"
            >
              <SearchIcon className="size-4" />
              Search
            </Button>
          </div>

          {results && results.length > 0 && mode ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              {mode === "semantic" ? "Ranked by relevance" : "Keyword matches"}
            </p>
          ) : null}

          <div className="max-h-[44vh] space-y-1 overflow-y-auto pr-1">
            {results === null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Type a query and press Enter.
              </p>
            ) : results.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No matches found.
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
        message="Searching the project"
        show={searching}
        submessage="Looking across truths, candidates, and ideas"
      />
    </>
  );
}
