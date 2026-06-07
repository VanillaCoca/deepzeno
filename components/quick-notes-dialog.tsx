"use client";

import { ArrowDownToLineIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/components/i18n/locale-provider";
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

type QuickNote = {
  id: string;
  text: string;
  createdAt: number;
  lastDiscussedAt: number | null;
};

// Per-project scratchpad persisted in localStorage (a lightweight v1 — no
// server round-trip, instant, survives reloads on this device).
function storageKey(projectId: string) {
  return `zeno:quick-notes:${projectId}`;
}

function loadNotes(projectId: string): QuickNote[] {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as QuickNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatWhen(value: number | null) {
  if (!value) {
    return null;
  }
  return new Date(value).toLocaleString();
}

export function QuickNotesDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const {
    activeProjectId,
    beginSandboxNav,
    bringDecisionToSandbox,
    requestView,
  } = useWorkspace();
  const { t } = useLocale();
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [draft, setDraft] = useState("");

  // Load when the dialog opens for the active project.
  useEffect(() => {
    if (open && activeProjectId) {
      setNotes(loadNotes(activeProjectId));
    }
  }, [open, activeProjectId]);

  const persist = useMemo(
    () => (next: QuickNote[]) => {
      setNotes(next);
      if (activeProjectId) {
        localStorage.setItem(storageKey(activeProjectId), JSON.stringify(next));
      }
    },
    [activeProjectId]
  );

  function addNote() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    const note: QuickNote = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      text,
      createdAt: Date.now(),
      lastDiscussedAt: null,
    };
    persist([note, ...notes]);
    setDraft("");
  }

  function deleteNote(id: string) {
    persist(notes.filter((note) => note.id !== id));
  }

  function bringToSandbox(note: QuickNote) {
    beginSandboxNav();
    const ok = bringDecisionToSandbox({
      decisionId: note.id,
      decisionTitle: t("dialog.quickNotes.noteLabel"),
      kind: "Note",
      content: note.text,
    });
    if (ok) {
      persist(
        notes.map((item) =>
          item.id === note.id ? { ...item, lastDiscussedAt: Date.now() } : item
        )
      );
      onOpenChange(false);
      requestView("conversation");
      toast.success(t("dialog.quickNotes.loadedToast"));
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[82vh] w-[92vw] gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("dialog.quickNotes.title")}</DialogTitle>
          <DialogDescription>
            {t("dialog.quickNotes.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] min-h-[40vh] space-y-2 overflow-y-auto pr-1">
          {notes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("dialog.quickNotes.empty")}
            </p>
          ) : (
            notes.map((note) => {
              const discussed = formatWhen(note.lastDiscussedAt);
              return (
                <div
                  className="group rounded-lg border border-border/60 bg-card/50 p-3"
                  key={note.id}
                >
                  <p className="whitespace-pre-wrap break-words text-sm leading-[1.5] text-foreground">
                    {note.text}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {discussed
                        ? t("dialog.quickNotes.lastDiscussed", {
                            when: discussed,
                          })
                        : t("dialog.quickNotes.notDiscussed")}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => bringToSandbox(note)}
                        size="sm"
                        variant="secondary"
                      >
                        <ArrowDownToLineIcon className="size-3.5" />
                        {t("dialog.quickNotes.sandbox")}
                      </Button>
                      <Button
                        aria-label={t("dialog.quickNotes.deleteNote")}
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => deleteNote(note.id)}
                        size="sm"
                        variant="ghost"
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border/60 pt-3">
          <Input
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                addNote();
              }
            }}
            placeholder={t("dialog.quickNotes.placeholder")}
            value={draft}
          />
          <Button disabled={!draft.trim()} onClick={addNote} size="sm">
            {t("dialog.quickNotes.add")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
