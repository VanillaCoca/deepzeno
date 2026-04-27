"use client";

import { CheckIcon, CopyIcon, KeyRoundIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { WorkspaceApiKey } from "@/lib/workspace/types";

type CreatedKeyPayload = {
  id: string;
  keyPrefix: string;
  label: string | null;
  token: string;
};

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ProjectApiKeyDialog({
  disabled,
  projectId,
  projectName,
}: {
  disabled?: boolean;
  projectId: string | null;
  projectName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [apiKeys, setApiKeys] = useState<WorkspaceApiKey[]>([]);
  const [label, setLabel] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedKeyPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const mcpUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "/api/mcp";
    }

    return `${window.location.origin}${
      process.env.NEXT_PUBLIC_BASE_PATH ?? ""
    }/api/mcp`;
  }, []);

  useEffect(() => {
    if (!open || !projectId) {
      return;
    }

    let cancelled = false;

    async function loadApiKeys() {
      setIsLoading(true);

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/api-keys?projectId=${projectId}`
        );

        if (!response.ok) {
          throw new Error("Failed to load API keys");
        }

        const payload = (await response.json()) as { apiKeys: WorkspaceApiKey[] };

        if (!cancelled) {
          setApiKeys(payload.apiKeys);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          toast.error("Failed to load API keys.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadApiKeys().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  async function handleCreateKey() {
    if (!projectId) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/api-keys`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId,
            label: label.trim() || undefined,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to create API key");
      }

      const payload = (await response.json()) as {
        apiKeys: WorkspaceApiKey[];
        createdKey: CreatedKeyPayload;
      };

      setApiKeys(payload.apiKeys);
      setCreatedKey(payload.createdKey);
      setLabel("");
      toast.success("API key generated. Copy it now — it won't be shown again.");
    } catch (error) {
      console.error(error);
      toast.error("Failed to create API key.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevokeKey(keyId: string) {
    if (!projectId) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/api-keys/${keyId}/revoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ projectId }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to revoke API key");
      }

      const payload = (await response.json()) as {
        apiKeys: WorkspaceApiKey[];
      };

      setApiKeys(payload.apiKeys);
      toast.success("API key revoked.");
    } catch (error) {
      console.error(error);
      toast.error("Failed to revoke API key.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy(text: string, message: string) {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard is unavailable in this browser.");
      return;
    }

    setIsCopying(true);

    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch (error) {
      console.error(error);
      toast.error("Failed to copy to clipboard.");
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setCreatedKey(null);
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button
          className="w-full justify-start rounded-xl"
          disabled={disabled || !projectId}
          size="sm"
          variant="outline"
        >
          <KeyRoundIcon className="size-4" />
          MCP & API Keys
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl rounded-3xl">
        <DialogHeader>
          <DialogTitle>MCP Access</DialogTitle>
          <DialogDescription>
            Generate project-bound API keys for external coding agents. Each key
            can only read this project's truth and submit candidates back for
            review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{projectName ?? "Current project"}</Badge>
              <Badge variant="secondary">MCP endpoint</Badge>
            </div>
            <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
              <Input readOnly value={mcpUrl} />
              <Button
                disabled={isCopying}
                onClick={() =>
                  handleCopy(mcpUrl, "MCP endpoint copied to clipboard.")
                }
                size="sm"
                variant="outline"
              >
                <CopyIcon className="size-4" />
                Copy URL
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Use this URL as the MCP server endpoint and send the generated key
              as a Bearer token.
            </p>
          </div>

          <div className="rounded-2xl border border-border/60 bg-background p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Input
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Key label (optional, e.g. Claude Code · Laptop)"
                value={label}
              />
              <Button disabled={isSubmitting || !projectId} onClick={handleCreateKey}>
                {isSubmitting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <KeyRoundIcon className="size-4" />
                )}
                Generate Key
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Keys are shown once. We store only a SHA-256 hash, never the raw
              token.
            </p>
          </div>

          {createdKey && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    New key generated
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Copy this token now. It will not be visible again after you
                    close this dialog.
                  </p>
                </div>
                <Badge className="bg-emerald-500/10 text-emerald-700" variant="outline">
                  shown once
                </Badge>
              </div>
              <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
                <Input readOnly value={createdKey.token} />
                <Button
                  disabled={isCopying}
                  onClick={() =>
                    handleCopy(createdKey.token, "API key copied to clipboard.")
                  }
                  size="sm"
                >
                  <CheckIcon className="size-4" />
                  Copy key
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Existing keys</p>
              <Badge variant="outline">{apiKeys.length}</Badge>
            </div>

            {isLoading ? (
              <div className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                Loading API keys...
              </div>
            ) : apiKeys.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                No API keys yet for this project.
              </div>
            ) : (
              <div className="space-y-3">
                {apiKeys.map((apiKey) => (
                  <div
                    className="rounded-2xl border border-border/60 bg-card/70 p-4"
                    key={apiKey.id}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {apiKey.label ?? "Untitled key"}
                          </p>
                          <Badge variant={apiKey.revokedAt ? "outline" : "secondary"}>
                            {apiKey.revokedAt ? "Revoked" : "Active"}
                          </Badge>
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {apiKey.keyPrefix}...
                        </p>
                        <div className="mt-3 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                          <p>Created: {formatDate(apiKey.createdAt)}</p>
                          <p>Last used: {formatDate(apiKey.lastUsedAt)}</p>
                        </div>
                      </div>
                      {!apiKey.revokedAt && (
                        <Button
                          disabled={isSubmitting}
                          onClick={() => handleRevokeKey(apiKey.id)}
                          size="sm"
                          variant="outline"
                        >
                          <Trash2Icon className="size-4" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-start">
          <p className="text-xs text-muted-foreground">
            Revoked keys return 401 immediately. Each key is bound to exactly one
            project.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
