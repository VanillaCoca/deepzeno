# L2b Research UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the L2a research backend in the node detail pane: a "Research this" action on `open_question`/`hypothesis` nodes, run status with the rendered brief, and a quote-verified Evidence section — every claim inspectable before anything is confirmed.

**Architecture:** One client component (`components/research/research-section.tsx`) mounted as a body section of `IRDetailPane` (components/ir/ir-detail.tsx, after Sub-nodes, before the Source row). It consumes the three L2a routes via SWR (`/api/research/runs?nodeId=`, `/api/research/evidence?nodeId=`, POST `/api/research/run`), polls every 5s only while a run is `running`, renders the brief with the existing `Streamdown` component, and surfaces the 503 no-search-provider case distinctly. i18n keys extend the existing `detail.*` namespace.

**Tech Stack:** React client component, SWR (conditional `refreshInterval`), Streamdown for the brief markdown, sonner-backed toast (`components/chat/toast`), existing `detail.*` i18n.

**Spec:** `docs/superpowers/specs/2026-06-10-research-engine-l1-l2-design.md` Component 2 acceptance items: brief renders in the node's detail pane (new Evidence section); every evidence item shows url + verbatim quote + retrieved_at; run cost/status visible; research candidates render distinctly (already true via the Source row's sourceLayer text — no work).

**Branch:** `git fetch origin && git checkout -b feat/l2-research-ui origin/main`

**Conventions (same as L2a):** verify with `npx tsc --noEmit` + `npx ultracite check <files>`; commits via `.git/COMMIT_MSG_TMP` + `git commit -F`, ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**Verified facts (explorer, 2026-06-11):** `IRDetailPane({actions, detail, selectedNode, subNodes})` at components/ir/ir-detail.tsx:377-551; body sections end with the Source row at ~486-493; detail data comes from ir-drawer.tsx:302 `useSWR<IRDetail>(irNodeKey(selectedNodeId), fetcher)` with `mutateDetail` passed into `useIRActions`; `Spinner` from `@/components/ui/spinner`; toast wrapper at components/chat/toast (`toast({type, description})`); `Streamdown` import seen in components/ai-elements/message.tsx (check its exact import + required props before use); polling precedent components/candidate-hint.tsx:20-28 (`refreshInterval` conditional). API responses: POST run → 201 `{run, evidence_count, candidates_created, skipped_duplicates}`, 503 `{code:"service_unavailable:research", message}`; GET runs → `{runs}` (status running|done|partial|failed, brief, error, costEstimate, createdAt, finishedAt); GET evidence → `{evidence}` ({url, title, quote, claim, stance, retrievedAt}).

---

### Task 1: i18n keys (detail namespace)

**Files:**
- Modify: `lib/i18n/messages/detail.ts` (append to each locale block, after the existing `detail.use` key)

- [ ] **Step 1: Add the keys**

EN block:

```typescript
    "detail.research": "Research",
    "detail.researchAction": "Research this",
    "detail.researchCaption":
      "ZENO searches the web read-only and returns quote-verified evidence. Nothing becomes truth.",
    "detail.researchRunning": "Researching... this can take a few minutes.",
    "detail.researchStatusDone": "Completed",
    "detail.researchStatusPartial": "Partial (budget hit)",
    "detail.researchStatusFailed": "Failed",
    "detail.researchStatusRunning": "Running",
    "detail.researchBrief": "Brief",
    "detail.researchEvidence": "Evidence",
    "detail.researchNoRuns": "No research runs yet.",
    "detail.researchCost": "Est. cost",
    "detail.researchRetrieved": "Retrieved",
    "detail.researchStanceSupports": "supports",
    "detail.researchStanceContradicts": "contradicts",
    "detail.researchStanceNeutral": "neutral",
    "detail.researchDoneToast":
      "{evidence} evidence items, {candidates} candidates proposed.",
    "detail.researchUnavailableToast":
      "Web search isn't configured on this deployment.",
    "detail.researchFailedToast": "Research run failed. Try again.",
```

zh block:

```typescript
    "detail.research": "调研",
    "detail.researchAction": "调研此问题",
    "detail.researchCaption":
      "ZENO 以只读方式搜索网络，返回逐字核验过的证据。不会产生任何真相。",
    "detail.researchRunning": "调研中… 可能需要几分钟。",
    "detail.researchStatusDone": "已完成",
    "detail.researchStatusPartial": "部分完成（达到预算上限）",
    "detail.researchStatusFailed": "失败",
    "detail.researchStatusRunning": "进行中",
    "detail.researchBrief": "简报",
    "detail.researchEvidence": "证据",
    "detail.researchNoRuns": "还没有调研记录。",
    "detail.researchCost": "估算成本",
    "detail.researchRetrieved": "抓取于",
    "detail.researchStanceSupports": "支持",
    "detail.researchStanceContradicts": "矛盾",
    "detail.researchStanceNeutral": "中立",
    "detail.researchDoneToast": "{evidence} 条证据，提议 {candidates} 个候选。",
    "detail.researchUnavailableToast": "当前部署未配置网络搜索。",
    "detail.researchFailedToast": "调研运行失败，请重试。",
```

fr block:

```typescript
    "detail.research": "Recherche",
    "detail.researchAction": "Rechercher ceci",
    "detail.researchCaption":
      "ZENO effectue une recherche web en lecture seule et renvoie des preuves vérifiées mot à mot. Rien ne devient vérité.",
    "detail.researchRunning": "Recherche en cours… cela peut prendre quelques minutes.",
    "detail.researchStatusDone": "Terminée",
    "detail.researchStatusPartial": "Partielle (budget atteint)",
    "detail.researchStatusFailed": "Échouée",
    "detail.researchStatusRunning": "En cours",
    "detail.researchBrief": "Synthèse",
    "detail.researchEvidence": "Preuves",
    "detail.researchNoRuns": "Aucune recherche pour l'instant.",
    "detail.researchCost": "Coût estimé",
    "detail.researchRetrieved": "Consulté le",
    "detail.researchStanceSupports": "soutient",
    "detail.researchStanceContradicts": "contredit",
    "detail.researchStanceNeutral": "neutre",
    "detail.researchDoneToast":
      "{evidence} preuves, {candidates} candidats proposés.",
    "detail.researchUnavailableToast":
      "La recherche web n'est pas configurée sur ce déploiement.",
    "detail.researchFailedToast": "La recherche a échoué. Réessayez.",
```

- [ ] **Step 2: Verify + commit**

`npx tsc --noEmit` clean; `npx ultracite check lib/i18n/messages/detail.ts` clean.
Commit: `feat(research-ui): detail-pane i18n strings (EN/zh/fr)`

---

### Task 2: ResearchSection component + mount

**Files:**
- Create: `components/research/research-section.tsx`
- Modify: `components/ir/ir-detail.tsx` (mount after the Sub-nodes section, before the Source row, ~line 484)

- [ ] **Step 1: Component**

Create `components/research/research-section.tsx`:

```tsx
"use client";

import { GlobeIcon } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "@/components/chat/toast";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { EvidenceItem, ResearchRun } from "@/lib/research/queries";
import { fetcher } from "@/lib/utils";

const POLL_MS = 5000;

const STANCE_STYLE: Record<EvidenceItem["stance"], string> = {
  supports: "bg-emerald-500/10 text-emerald-600",
  contradicts: "bg-amber-500/10 text-amber-600",
  neutral: "bg-muted text-muted-foreground",
};

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ResearchSection({
  nodeId,
  onLanded,
}: {
  nodeId: string;
  onLanded: () => void;
}) {
  const { t } = useLocale();
  const [isStarting, setIsStarting] = useState(false);
  const runsKey = `/api/research/runs?nodeId=${encodeURIComponent(nodeId)}`;
  const evidenceKey = `/api/research/evidence?nodeId=${encodeURIComponent(nodeId)}`;
  const { data: runsData, mutate: mutateRuns } = useSWR<{
    runs: ResearchRun[];
  }>(runsKey, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: (latest) =>
      latest?.runs.some((run) => run.status === "running") ? POLL_MS : 0,
  });
  const { data: evidenceData, mutate: mutateEvidence } = useSWR<{
    evidence: EvidenceItem[];
  }>(evidenceKey, fetcher, { revalidateOnFocus: false });

  const latestRun = runsData?.runs[0] ?? null;
  const isRunning = isStarting || latestRun?.status === "running";
  const evidence = evidenceData?.evidence ?? [];

  async function handleResearch() {
    setIsStarting(true);

    try {
      const response = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: nodeId }),
      });
      const payload = await response.json();

      if (!response.ok) {
        const description =
          payload?.code === "service_unavailable:research"
            ? t("detail.researchUnavailableToast")
            : t("detail.researchFailedToast");
        toast({ type: "error", description });
        return;
      }

      toast({
        type: "success",
        description: t("detail.researchDoneToast", {
          evidence: payload.evidence_count,
          candidates: payload.candidates_created,
        }),
      });
      onLanded();
    } catch (error) {
      console.error(error);
      toast({ type: "error", description: t("detail.researchFailedToast") });
    } finally {
      setIsStarting(false);
      await Promise.all([mutateRuns(), mutateEvidence()]);
    }
  }

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ir-text-tertiary)]">
        {t("detail.research")}
      </p>

      <div className="flex items-center gap-2">
        <Button
          disabled={isRunning}
          onClick={handleResearch}
          size="sm"
          variant="secondary"
        >
          {isRunning ? <Spinner className="size-4" /> : <GlobeIcon className="size-4" />}
          {isRunning ? t("detail.researchRunning") : t("detail.researchAction")}
        </Button>
      </div>
      <p className="text-xs text-[var(--ir-text-tertiary)]">
        {t("detail.researchCaption")}
      </p>

      {latestRun ? (
        <RunSummary run={latestRun} />
      ) : (
        <p className="text-xs text-[var(--ir-text-tertiary)]">
          {t("detail.researchNoRuns")}
        </p>
      )}

      {evidence.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--ir-text-secondary)]">
            {t("detail.researchEvidence")} ({evidence.length})
          </p>
          <ul className="space-y-2">
            {evidence.map((item) => (
              <li
                className="rounded-lg border border-[var(--ir-border-default)] p-2 text-xs"
                key={item.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <a
                    className="truncate font-medium text-[var(--ir-accent-blue)] hover:underline"
                    href={item.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {item.title || hostOf(item.url)}
                  </a>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${STANCE_STYLE[item.stance]}`}
                  >
                    {t(
                      item.stance === "supports"
                        ? "detail.researchStanceSupports"
                        : item.stance === "contradicts"
                          ? "detail.researchStanceContradicts"
                          : "detail.researchStanceNeutral"
                    )}
                  </span>
                </div>
                <blockquote className="mt-1 border-l-2 border-[var(--ir-border-strong)] pl-2 italic text-[var(--ir-text-secondary)]">
                  {item.quote}
                </blockquote>
                <p className="mt-1 text-[var(--ir-text-secondary)]">
                  {item.claim}
                </p>
                <p className="mt-1 text-[10px] text-[var(--ir-text-tertiary)]">
                  {t("detail.researchRetrieved")}{" "}
                  {new Date(item.retrievedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function RunSummary({ run }: { run: ResearchRun }) {
  const { t } = useLocale();
  const statusKey =
    run.status === "done"
      ? "detail.researchStatusDone"
      : run.status === "partial"
        ? "detail.researchStatusPartial"
        : run.status === "failed"
          ? "detail.researchStatusFailed"
          : "detail.researchStatusRunning";

  return (
    <div className="space-y-1 rounded-lg border border-[var(--ir-border-default)] p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-[var(--ir-text-secondary)]">
          {t(statusKey)}
        </span>
        <span className="text-[10px] text-[var(--ir-text-tertiary)]">
          {new Date(run.createdAt).toLocaleString()}
          {run.costEstimate != null
            ? ` · ${t("detail.researchCost")} $${run.costEstimate.toFixed(3)}`
            : ""}
        </span>
      </div>
      {run.error ? (
        <p className="text-[var(--ir-warning-fg)]">{run.error}</p>
      ) : null}
      {run.brief ? <BriefBody brief={run.brief} /> : null}
    </div>
  );
}

function BriefBody({ brief }: { brief: string }) {
  const { t } = useLocale();

  return (
    <details>
      <summary className="cursor-pointer text-[var(--ir-text-secondary)]">
        {t("detail.researchBrief")}
      </summary>
      <div className="mt-1 whitespace-pre-wrap text-[var(--ir-text-secondary)]">
        {brief}
      </div>
    </details>
  );
}
```

Implementation notes for the implementer:
- **SWR `refreshInterval` as a function**: supported in the installed SWR version? Check node_modules/swr typings; if not, derive from current data via a second `useSWR` opts pattern or use a plain ternary on the previous render's state (`refreshInterval: hasRunning ? POLL_MS : 0` where `hasRunning` comes from `runsData` — acceptable one-render lag). Use whichever compiles.
- **Brief rendering**: the plan defaults to `whitespace-pre-wrap` plain text inside `<details>` (易学易用: collapsed by default; markdown fidelity is a nice-to-have). IF `Streamdown` from the chat stack is trivially reusable client-side (check components/ai-elements/message.tsx imports — it may need plugins/props), you MAY swap the inner div for `<Streamdown>{brief}</Streamdown>`; if it drags in heavy plugins, keep plain text and note it.
- **`fetcher` from `@/lib/utils`** throws ChatbotError on !ok — that's why handleResearch uses plain `fetch` (needs the 503 body).
- **Types import**: `lib/research/queries.ts` has `import "server-only"` at the top — a CLIENT component cannot import VALUES from it, but `import type { ... }` is erased at compile time. Verify Next 16 + tsc accept `import type` from a server-only module in a client file (it does — types are stripped); if the bundler complains anyway, re-declare the two types locally in the component file with a comment pointing at the source of truth, and note the duplication.

- [ ] **Step 2: Mount in IRDetailPane**

In `components/ir/ir-detail.tsx`, after the Sub-nodes section block (ends ~line 483) and before the Source row block (~line 486), insert:

```tsx
          {(selectedNode.kind === "open_question" ||
            selectedNode.kind === "hypothesis") && (
            <ResearchSection
              nodeId={selectedNode.id}
              onLanded={actions.refreshAfterMutation ?? (() => undefined)}
            />
          )}
```

Wiring note: inspect `useIRActions` (components/ir/use-ir-actions.ts) for the existing post-mutation refresh function (the explorer saw `mutateDetail` called at line ~94). Use whatever callback refreshes the detail + drawer lists after research lands candidates (new pending nodes + edges to this node). If no single function exists, pass `() => { void actions.<the mutate detail fn>?.(); }` — or thread `mutateDetail` down from ir-drawer.tsx as a prop if that's cleaner. Smallest correct wiring; report what you chose.

- [ ] **Step 3: Verify + commit**

`npx tsc --noEmit` clean; `npx ultracite check components/research components/ir/ir-detail.tsx` clean.
Commit: `feat(research-ui): Research section in node detail pane`

---

### Task 3: Verification + final review + PR

- [ ] `npx tsc --noEmit`; `npx ultracite check components/research components/ir lib/i18n/messages/detail.ts`
- [ ] All unit suites still green: `node --test tests/unit/research-text.test.ts tests/unit/research-budget.test.ts tests/unit/research-search.test.ts tests/unit/kickoff-proposal.test.ts`
- [ ] `npx playwright test tests/e2e/import-validation.test.ts` (18)
- [ ] i18n parity: en/zh/fr key sets identical for the new detail.research* keys
- [ ] Final review subagent (cross-cutting: key usage vs definitions, types-only import safety, polling stops when no run is running, 503 mapping path, no server-only value imports in client code)
- [ ] Push, PR via REST payload (body notes: completes the L2 spec's UI acceptance items; depends on PR #29; migrations still pending on Supabase), CI poll, merge after double-green

## Self-review notes

- Spec acceptance mapping: brief in detail pane ✓ (collapsed details); url+quote+retrieved_at per evidence item ✓; run cost + status visible ✓ (RunSummary); distinct rendering of research candidates ✓ (pre-existing Source row). "Research this" only on open_question/hypothesis ✓ (mount condition mirrors the server gate).
- The POST can take minutes — button disabled + polling covers navigation-away; stale-running rewrite comes from the server.
- Type-only imports from server-only modules: flagged with a fallback instruction in Task 2.
