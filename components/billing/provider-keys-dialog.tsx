"use client";

import {
  AlertTriangleIcon,
  CheckIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

// Mirrors app/api/billing/keys/route.ts. Duplicated as a local type rather than
// imported from the route module: importing it would pull a "server-only"
// dependency chain into the client bundle through the type graph.
type ProviderId =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "openrouter"
  | "dashscope"
  | "gateway"
  | "tavily";

type ProviderKeySummary = {
  provider: ProviderId;
  keyHint: string;
  label: string | null;
  status: "active" | "invalid";
  lastError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type BillingKeysResponse = {
  keys: ProviderKeySummary[];
  providers: ProviderId[];
  usage: { spentUsd: number; allowanceUsd: number };
  storageConfigured: boolean;
  unmetered: boolean;
};

// Ordered by how much a key actually changes for the user, not alphabetically.
// DeepSeek and Tavily are first because they are what the default research
// stack burns; a user who connects only those two has handed over most of the
// real cost for a couple of dollars a month.
const PROVIDERS: {
  id: ProviderId;
  name: string;
  funds: string;
  console: string;
}[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    funds: "Default research + extraction engine. Cheapest, used the most.",
    console: "platform.deepseek.com",
  },
  {
    id: "tavily",
    name: "Tavily",
    funds:
      "Web search. Billed in credits, not tokens — so it never counts against the free allowance, and connecting a key is what removes the real ceiling on research volume.",
    console: "app.tavily.com",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    funds: "Claude models: chat and research synthesis.",
    console: "console.anthropic.com",
  },
  {
    id: "openai",
    name: "OpenAI",
    funds: "GPT models: chat and research synthesis.",
    console: "platform.openai.com",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    funds: "Frontier models routed through OpenRouter.",
    console: "openrouter.ai",
  },
  {
    id: "dashscope",
    name: "DashScope",
    funds: "Alibaba Qwen models.",
    console: "dashscope.console.aliyun.com",
  },
  {
    id: "gateway",
    name: "Vercel AI Gateway",
    funds: "Models served through the AI Gateway.",
    console: "vercel.com/ai",
  },
];

function apiPath(path: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

function AllowanceMeter({
  usage,
  unmetered,
}: {
  usage: { spentUsd: number; allowanceUsd: number };
  unmetered: boolean;
}) {
  if (unmetered) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <AlertTriangleIcon className="size-4" />
          Usage metering is not active on this deployment
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing is being counted right now — which is not the same as having
          spent nothing. Keys you connect here still route correctly.
        </p>
      </div>
    );
  }

  const ratio =
    usage.allowanceUsd > 0
      ? Math.min(1, usage.spentUsd / usage.allowanceUsd)
      : 1;
  const exhausted = usage.spentUsd >= usage.allowanceUsd;

  return (
    <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-foreground text-sm">
          Free usage this month
        </p>
        <p className="font-mono text-muted-foreground text-xs">
          {formatUsd(usage.spentUsd)} / {formatUsd(usage.allowanceUsd)}
        </p>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border/70">
        <div
          className={
            exhausted
              ? "h-full rounded-full bg-destructive"
              : "h-full rounded-full bg-primary"
          }
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-muted-foreground text-xs">
        {exhausted
          ? "The free allowance is used up until the next calendar month. Connect a key below to keep going now."
          : "Covers models paid for by ZENO. Calls that run on your own key below are billed by your provider directly and never touch this."}
      </p>
    </div>
  );
}

function ProviderRow({
  provider,
  summary,
  busy,
  onSave,
  onRemove,
  disabled,
}: {
  provider: (typeof PROVIDERS)[number];
  summary: ProviderKeySummary | undefined;
  busy: boolean;
  onSave: (apiKey: string) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");

  const connected = Boolean(summary);
  const invalid = summary?.status === "invalid";

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-foreground text-sm">{provider.name}</p>
        {connected ? (
          <Badge variant={invalid ? "outline" : "secondary"}>
            {invalid ? "Not working" : "Connected"}
          </Badge>
        ) : null}
        {connected ? (
          <span className="font-mono text-muted-foreground text-xs">
            ···{summary?.keyHint}
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-muted-foreground text-xs">{provider.funds}</p>

      {invalid && summary?.lastError ? (
        <p className="mt-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-destructive text-xs">
          {summary.lastError}
        </p>
      ) : null}

      {connected ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-muted-foreground text-xs">
            {provider.console}
          </span>
          <Button
            disabled={busy || disabled}
            onClick={onRemove}
            size="sm"
            variant="outline"
          >
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <Trash2Icon className="size-4" />
            )}
            Remove
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <Input
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Paste your ${provider.name} key`}
            spellCheck={false}
            type="password"
            value={draft}
          />
          <Button
            disabled={busy || disabled || draft.trim().length < 8}
            onClick={() => {
              onSave(draft.trim());
              setDraft("");
            }}
            size="sm"
          >
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <CheckIcon className="size-4" />
            )}
            Connect
          </Button>
        </div>
      )}
    </div>
  );
}

export function ProviderKeysDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<BillingKeysResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<ProviderId | null>(
    null
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(apiPath("/api/billing/keys"));
      if (!response.ok) {
        throw new Error("Failed to load billing settings");
      }
      setData((await response.json()) as BillingKeysResponse);
    } catch (error) {
      console.error(error);
      toast.error("Couldn't load your usage and keys.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load().catch(console.error);
    }
  }, [open, load]);

  async function handleSave(provider: ProviderId, apiKey: string) {
    setPendingProvider(provider);
    try {
      const response = await fetch(apiPath("/api/billing/keys"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const payload = (await response.json()) as {
        cause?: string;
        validation?: { verdict: string; detail: string };
      };

      if (!response.ok) {
        throw new Error(payload.cause ?? "Failed to save the key");
      }

      // The save succeeded either way; the verdict decides which sentence the
      // user reads. A rejected key is still stored (see validate-key.ts), so
      // this is a warning, not a failure.
      if (payload.validation?.verdict === "rejected") {
        toast.warning(payload.validation.detail);
      } else if (payload.validation?.verdict === "unverified") {
        toast.success(`Key saved. ${payload.validation.detail}`);
      } else {
        toast.success(`${provider} key connected. Calls now run on your key.`);
      }

      await load();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save the key"
      );
    } finally {
      setPendingProvider(null);
    }
  }

  async function handleRemove(provider: ProviderId) {
    setPendingProvider(provider);
    try {
      const response = await fetch(
        apiPath(`/api/billing/keys?provider=${provider}`),
        { method: "DELETE" }
      );
      if (!response.ok) {
        throw new Error("Failed to remove the key");
      }
      toast.success(
        `${provider} key removed. Those calls fall back to the free allowance.`
      );
      await load();
    } catch (error) {
      console.error(error);
      toast.error("Failed to remove the key.");
    } finally {
      setPendingProvider(null);
    }
  }

  const byProvider = new Map(
    (data?.keys ?? []).map((key) => [key.provider, key])
  );
  const storageOff = data ? !data.storageConfigured : false;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl rounded-3xl">
        <DialogHeader>
          <DialogTitle>Usage & API keys</DialogTitle>
          <DialogDescription>
            ZENO covers a free allowance of model usage every month. Connect
            your own provider keys to run past it — those calls are billed by
            the provider to you directly, at their price, with nothing added.
          </DialogDescription>
        </DialogHeader>

        {isLoading && !data ? (
          <div className="rounded-2xl border border-dashed border-border/60 px-4 py-10 text-center text-muted-foreground text-sm">
            Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {data ? (
              <AllowanceMeter unmetered={data.unmetered} usage={data.usage} />
            ) : null}

            {storageOff ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <AlertTriangleIcon className="size-4" />
                  Key storage isn't configured on this deployment
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  ZENO_BYOK_SECRET is unset, so keys can't be encrypted at rest
                  — and storing them any other way isn't an option. Saving is
                  disabled until the operator sets it.
                </p>
              </div>
            ) : null}

            <ScrollArea className="max-h-[46vh] pr-3">
              <div className="space-y-3">
                {PROVIDERS.map((provider) => (
                  <ProviderRow
                    busy={pendingProvider === provider.id}
                    disabled={storageOff}
                    key={provider.id}
                    onRemove={() => handleRemove(provider.id)}
                    onSave={(apiKey) => handleSave(provider.id, apiKey)}
                    provider={provider}
                    summary={byProvider.get(provider.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="sm:justify-start">
          <p className="text-muted-foreground text-xs">
            Keys are encrypted before they are stored and are never shown again
            — only the last four characters. Remove one at any time and those
            calls fall back to the free allowance.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
