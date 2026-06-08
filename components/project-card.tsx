"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";

export function ProjectCard({
  href,
  project,
}: {
  href: string;
  project: WorkspaceProjectSummary;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);

    try {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      const response = await fetch(
        `${base}/api/workspace/projects?projectId=${project.id}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Request failed");
      }

      toast.success(t("dialog.projectCard.deletedToast"));
      setConfirmOpen(false);
      router.refresh();
    } catch (error) {
      console.error("Delete project failed", error);
      toast.error(t("dialog.projectCard.deleteFailedToast"));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="relative">
      <Link
        className="block cursor-pointer rounded-lg border border-border bg-background p-4 pr-12 transition-colors hover:bg-muted/30"
        href={href}
      >
        <div className="flex items-start justify-between gap-4">
          <p className="text-base font-medium text-foreground">
            {project.name}
          </p>
          <p
            className="text-right text-sm text-muted-foreground"
            suppressHydrationWarning
          >
            {formatDistanceToNowStrict(new Date(project.updatedAt), {
              addSuffix: true,
            })}
          </p>
        </div>
        <p
          className="mt-2 text-sm text-muted-foreground"
          suppressHydrationWarning
        >
          {project.topicCount}{" "}
          {project.topicCount === 1
            ? t("dialog.projectCard.topicSingular")
            : t("dialog.projectCard.topicPlural")}
        </p>
      </Link>

      <div className="absolute top-3 right-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("dialog.projectCard.actionsFor", {
                name: project.name,
              })}
              className="text-muted-foreground hover:text-foreground"
              size="icon-sm"
              variant="ghost"
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setConfirmOpen(true);
              }}
              variant="destructive"
            >
              <Trash2Icon />
              {t("dialog.projectCard.deleteProject")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dialog.projectCard.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialog.projectCard.confirmDescription", {
                name: project.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("dialog.projectCard.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
            >
              {t("dialog.projectCard.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
