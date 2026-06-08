# P2 — Auto Model Routing + Quality Knob + Model Badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "Auto" foreground model that picks a model per message by simple rules, a global Economy/Balanced/Best quality knob that tunes Auto, and a badge showing which model answered.

**Architecture:** Pure-function rules router in `lib/ai/model-policy.ts` (builds on the P1 tier/capability registry). The chat route intercepts the special id `"auto"` and resolves a concrete model before loading it. A small client preference provider mirrors the existing locale provider. The badge is sourced from a persisted `/api/messages` map plus a live `data-model` stream part.

**Tech Stack:** Next.js App Router, AI SDK (`streamText`, `createUIMessageStream`), Zod, Supabase REST, Biome, `tsx --test`.

Spec: `docs/superpowers/specs/2026-06-08-p2-auto-model-routing-design.md`

Verification commands (run from the worktree root):
- Types: `corepack pnpm exec tsc --noEmit`
- Lint: `corepack pnpm exec biome check --write <files>`
- Tests: `corepack pnpm exec tsx --test tests/unit/model-policy.test.ts`

---

## Task 1: Auto routing core (pure functions + tests)

**Files:**
- Modify: `lib/ai/model-policy.ts`
- Test: `tests/unit/model-policy.test.ts`

- [ ] **Step 1: Write the failing tests**

First extend the EXISTING model-policy import at the top of `tests/unit/model-policy.test.ts` to add the two new symbols (do not add a second import statement):

```ts
import {
  classifyTier,
  pickModelByTier,
  routeAutoModel,
  selectModelForTask,
} from "../../lib/ai/model-policy.ts";
```

Then append these suites after the existing ones:

```ts
describe("classifyTier", () => {
  it("treats short plain messages as economy", () => {
    assert.equal(classifyTier("hi there"), "economy");
  });

  it("treats reasoning-keyword messages as frontier", () => {
    assert.equal(classifyTier("Explain the tradeoffs here"), "frontier");
  });

  it("treats fenced code as frontier", () => {
    assert.equal(classifyTier("fix this\n```\ncode\n```"), "frontier");
  });

  it("treats a normal medium sentence as standard", () => {
    assert.equal(
      classifyTier(
        "I want to add a settings page that lists the user's saved topics."
      ),
      "standard"
    );
  });
});

describe("routeAutoModel", () => {
  it("routes a trivial turn to economy (DeepSeek)", () => {
    assert.equal(
      routeAutoModel({ text: "hi", hasImage: false }, "balanced", sonnetAndDeepseek),
      "deepseek:default"
    );
  });

  it("routes a hard turn to the top available tier", () => {
    assert.equal(
      routeAutoModel(
        { text: "Explain and analyze this", hasImage: false },
        "balanced",
        sonnetAndDeepseek
      ),
      "anthropic:claude-sonnet-4-6"
    );
  });

  it("Best shifts a trivial turn up a tier", () => {
    assert.equal(
      routeAutoModel({ text: "hi", hasImage: false }, "best", sonnetAndDeepseek),
      "anthropic:claude-sonnet-4-6"
    );
  });

  it("Economy keeps a trivial turn at economy", () => {
    assert.equal(
      routeAutoModel({ text: "hi", hasImage: false }, "economy", sonnetAndDeepseek),
      "deepseek:default"
    );
  });

  it("requires a vision-capable model when an image is attached", () => {
    // DeepSeek has no vision; must fall to the vision-capable Sonnet.
    assert.equal(
      routeAutoModel({ text: "hi", hasImage: true }, "balanced", sonnetAndDeepseek),
      "anthropic:claude-sonnet-4-6"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm exec tsx --test tests/unit/model-policy.test.ts`
Expected: FAIL — `classifyTier` / `routeAutoModel` are not exported.

- [ ] **Step 3: Implement the router in `lib/ai/model-policy.ts`**

Add these exports. Reuse the existing `TIER_RANK`, `tierDistance`, `getActiveModels`, `getDefaultModelId`, and refactor `pickModelByTier` to delegate to the new capability-aware `pickModel`:

```ts
export type AutoRoutingSignals = {
  text: string;
  hasImage: boolean;
};

const HARD_SIGNAL =
  /\b(explain|analy[sz]e|design|architect|debug|prove|derive|refactor|optimi[sz]e|research|compare|evaluate|plan)\b/i;
const CODE_FENCE = /```/;
const TRIVIAL_MAX_CHARS = 120;
const HARD_MAX_CHARS = 2000;

export function classifyTier(text: string): ModelTier {
  const trimmed = text.trim();
  if (
    HARD_SIGNAL.test(trimmed) ||
    trimmed.length > HARD_MAX_CHARS ||
    CODE_FENCE.test(trimmed)
  ) {
    return "frontier";
  }
  if (trimmed.length < TRIVIAL_MAX_CHARS) {
    return "economy";
  }
  return "standard";
}

const TIER_BY_RANK: ModelTier[] = ["economy", "standard", "frontier"];

const PREFERENCE_SHIFT: Record<QualityPreference, number> = {
  economy: -1,
  balanced: 0,
  best: 1,
};

function shiftTier(tier: ModelTier, preference: QualityPreference): ModelTier {
  const shifted = TIER_RANK[tier] + PREFERENCE_SHIFT[preference];
  const clamped = Math.max(0, Math.min(TIER_BY_RANK.length - 1, shifted));
  return TIER_BY_RANK[clamped];
}

// Capability-aware tier pick. requireVision filters to vision-capable models
// (falling back to all active if none qualify).
export function pickModel(
  { tier, requireVision = false }: { tier: ModelTier; requireVision?: boolean },
  env: EnvLike = process.env
): string {
  const active = getActiveModels(env);
  if (active.length === 0) {
    return getDefaultModelId(env);
  }
  const eligible = requireVision
    ? active.filter((model) => model.capabilities.vision)
    : active;
  const pool = eligible.length > 0 ? eligible : active;
  const target = TIER_RANK[tier];
  const [best] = [...pool].sort(
    (a, b) => tierDistance(a.tier, target) - tierDistance(b.tier, target)
  );
  return best.id;
}

export function routeAutoModel(
  signals: AutoRoutingSignals,
  preference: QualityPreference,
  env: EnvLike = process.env
): string {
  const tier = shiftTier(classifyTier(signals.text), preference);
  return pickModel({ tier, requireVision: signals.hasImage }, env);
}
```

Then replace the existing `pickModelByTier` body to delegate (keep its signature):

```ts
export function pickModelByTier(
  tier: ModelTier,
  env: EnvLike = process.env
): string {
  return pickModel({ tier }, env);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm exec tsx --test tests/unit/model-policy.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
corepack pnpm exec tsc --noEmit
corepack pnpm exec biome check --write lib/ai/model-policy.ts tests/unit/model-policy.test.ts
git add lib/ai/model-policy.ts tests/unit/model-policy.test.ts
git commit -m "feat(ai): rules-based Auto model router (routeAutoModel/classifyTier)"
```

---

## Task 2: Wire Auto into the chat route + schema + data part type

**Files:**
- Modify: `app/(chat)/api/chat/schema.ts`
- Modify: `lib/types.ts` (add the `model` data part type)
- Modify: `app/(chat)/api/chat/route.ts`

- [ ] **Step 1: Add `qualityPreference` to the request schema**

In `app/(chat)/api/chat/schema.ts`, add to `postRequestBodySchema` (after the `locale` line). `selectedChatModel` stays `z.string()`, so `"auto"` is already accepted:

```ts
  locale: z.enum(["en", "zh", "fr"]).optional(),
  qualityPreference: z.enum(["economy", "balanced", "best"]).optional(),
```

- [ ] **Step 2: Add the `model` data part type**

In `lib/types.ts`, add to `CustomUIDataTypes` (next to `"chat-title": string;`):

```ts
  "chat-title": string;
  model: string;
```

- [ ] **Step 3: Intercept `"auto"` in the route and emit the resolved model**

In `app/(chat)/api/chat/route.ts`:

(a) Add imports near the other `@/lib/ai` imports:

```ts
import { routeAutoModel } from "@/lib/ai/model-policy";
```

(b) Destructure `qualityPreference` from the body (in the `const { ... } = requestBody;` block):

```ts
      locale,
      qualityPreference,
```

(c) Add a helper near `getMessageModelOverride` (top of file):

```ts
function messageHasImage(message?: ChatMessage): boolean {
  return Boolean(
    message?.parts?.some(
      (part) =>
        part.type === "file" &&
        typeof part.mediaType === "string" &&
        part.mediaType.startsWith("image/")
    )
  );
}
```

(d) Replace the `resolvedModel` resolution. Find:

```ts
    const resolvedModel = resolveChatModelSelection(
      messageModelOverride ??
        workspaceSelection.topic.defaultModelId ??
        selectedChatModel,
      process.env
    );
```

Replace with:

```ts
    const selectedModelId =
      messageModelOverride ??
      workspaceSelection.topic.defaultModelId ??
      selectedChatModel;
    const effectiveModelId =
      selectedModelId === "auto"
        ? routeAutoModel(
            {
              text: message ? getTextFromMessage(message) : "",
              hasImage: messageHasImage(message as ChatMessage | undefined),
            },
            qualityPreference ?? "balanced",
            process.env
          )
        : selectedModelId;
    const resolvedModel = resolveChatModelSelection(
      effectiveModelId,
      process.env
    );
```

(e) Emit the resolved model as a live data part. Inside `createUIMessageStream`'s `execute`, right after `const result = streamText({ ... });` and before `dataStream.merge(...)`, add:

```ts
        dataStream.write({ type: "data-model", data: chatModel });
```

(`chatModel` is already `resolvedModel.id` later in the file — confirm `chatModel` is defined before `execute`; it is, at `const chatModel = resolvedModel.id;`.)

- [ ] **Step 4: Verify**

Run: `corepack pnpm exec tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 5: Lint + commit**

```bash
corepack pnpm exec biome check --write "app/(chat)/api/chat/schema.ts" "app/(chat)/api/chat/route.ts" lib/types.ts
git add "app/(chat)/api/chat/schema.ts" "app/(chat)/api/chat/route.ts" lib/types.ts
git commit -m "feat(chat): resolve Auto model server-side + emit data-model"
```

---

## Task 3: Quality preference provider + account-menu submenu + send in request

**Files:**
- Create: `components/quality/quality-provider.tsx`
- Modify: the file that renders `<LocaleProvider>` (find with grep)
- Modify: `components/project-sidebar.tsx`
- Modify: `hooks/use-active-chat.tsx`
- Modify: `lib/i18n/messages/chat.ts` (or a small fragment) for the menu strings

- [ ] **Step 1: Create the provider** (`components/quality/quality-provider.tsx`)

Mirrors the locale provider pattern (localStorage-backed, default `balanced`; no cookie — only the client needs it):

```tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { QualityPreference } from "@/lib/ai/model-policy";

const STORAGE_KEY = "zeno-quality";
const DEFAULT_QUALITY: QualityPreference = "balanced";

function isQuality(value: unknown): value is QualityPreference {
  return value === "economy" || value === "balanced" || value === "best";
}

type QualityContextValue = {
  quality: QualityPreference;
  setQuality: (next: QualityPreference) => void;
};

const QualityContext = createContext<QualityContextValue | null>(null);

export function QualityProvider({ children }: { children: React.ReactNode }) {
  const [quality, setQualityState] =
    useState<QualityPreference>(DEFAULT_QUALITY);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isQuality(stored)) {
      setQualityState(stored);
    }
  }, []);

  const value = useMemo<QualityContextValue>(
    () => ({
      quality,
      setQuality: (next: QualityPreference) => {
        setQualityState(next);
        localStorage.setItem(STORAGE_KEY, next);
      },
    }),
    [quality]
  );

  return (
    <QualityContext.Provider value={value}>{children}</QualityContext.Provider>
  );
}

export function useQuality() {
  const context = useContext(QualityContext);
  if (!context) {
    throw new Error("useQuality must be used within QualityProvider");
  }
  return context;
}
```

- [ ] **Step 2: Mount the provider**

Run: `corepack pnpm exec rg -n "<LocaleProvider" --glob "**/*.tsx"` (or use the Grep tool).
In that file, wrap the children with `<QualityProvider>` directly inside (or around) `<LocaleProvider>`:

```tsx
<LocaleProvider>
  <QualityProvider>{children}</QualityProvider>
</LocaleProvider>
```

Add the import: `import { QualityProvider } from "@/components/quality/quality-provider";`

- [ ] **Step 3: Add i18n strings**

In `lib/i18n/messages/chat.ts`, add to each locale block:

```ts
// en
    "chat.quality": "Response quality",
    "chat.qualityEconomy": "Economy",
    "chat.qualityBalanced": "Balanced",
    "chat.qualityBest": "Best",
// zh
    "chat.quality": "回复质量",
    "chat.qualityEconomy": "经济",
    "chat.qualityBalanced": "均衡",
    "chat.qualityBest": "最佳",
// fr
    "chat.quality": "Qualité des réponses",
    "chat.qualityEconomy": "Économique",
    "chat.qualityBalanced": "Équilibré",
    "chat.qualityBest": "Meilleur",
```

- [ ] **Step 4: Add the submenu to the account menu**

In `components/project-sidebar.tsx`, import `GaugeIcon` from `lucide-react` (add to the existing lucide import block) and `useQuality`:

```tsx
import { useQuality } from "@/components/quality/quality-provider";
```

In the account-menu component, read the hook next to `const { locale, setLocale, t } = useLocale();`:

```tsx
  const { quality, setQuality } = useQuality();
```

Add this `DropdownMenuSub` immediately after the existing Language `DropdownMenuSub` (before the `DropdownMenuSeparator`):

```tsx
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <GaugeIcon />
            {t("chat.quality")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              onValueChange={(value) =>
                setQuality(value as "economy" | "balanced" | "best")
              }
              value={quality}
            >
              <DropdownMenuRadioItem value="economy">
                {t("chat.qualityEconomy")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="balanced">
                {t("chat.qualityBalanced")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="best">
                {t("chat.qualityBest")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
```

- [ ] **Step 5: Send `qualityPreference` in the chat request**

In `hooks/use-active-chat.tsx`, import and read the hook:

```tsx
import { useQuality } from "@/components/quality/quality-provider";
```

Inside `ActiveChatProvider`, near `const { locale } = useLocale();`:

```tsx
  const { quality } = useQuality();
  const qualityRef = useRef(quality);
  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);
```

In `prepareSendMessagesRequest`'s returned `body`, add (next to `locale: localeRef.current,`):

```tsx
            qualityPreference: qualityRef.current,
```

- [ ] **Step 6: Verify + commit**

```bash
corepack pnpm exec tsc --noEmit
corepack pnpm exec biome check --write components/quality/quality-provider.tsx components/project-sidebar.tsx hooks/use-active-chat.tsx lib/i18n/messages/chat.ts
git add -A
git commit -m "feat(ui): response-quality preference (provider + account submenu + request wiring)"
```

---

## Task 4: "Auto" entry in the model selector

**Files:**
- Modify: `components/chat/multimodal-input.tsx`

- [ ] **Step 1: Add the Auto option to the picker**

In `PureModelSelectorCompact`:

(a) Compute an `isAuto` flag and render the trigger label for it. Replace the early bail/return path so that when `selectedModelId === "auto"`, the trigger shows "Auto". Add near the top of the component body:

```tsx
  const isAuto = selectedModelId === "auto";
```

(b) In the `ModelSelectorTrigger` button, render the Auto label when `isAuto`. Replace the `<ModelSelectorLogo .../><ModelSelectorName>{selectedModel.name}</ModelSelectorName>` pair with:

```tsx
          {isAuto ? (
            <ModelSelectorName>{t("chat.autoModel")}</ModelSelectorName>
          ) : (
            <>
              <ModelSelectorLogo provider={selectedModel.provider} />
              <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
            </>
          )}
```

(Keep the existing `if (!selectedModel) { return null; }` guard, but move it so it does not early-return when `isAuto` — i.e. change it to `if (!(selectedModel || isAuto)) { return null; }`.)

(c) Add an "Auto" item as the first entry in the list, above the grouped models. Inside `ModelSelectorList`, before the `{(() => { ... grouped ... })()}` block:

```tsx
          <ModelSelectorItem
            className="flex w-full"
            data-testid="model-selector-item"
            key="auto"
            onClick={() => handleModelSelect("auto")}
            onSelect={() => handleModelSelect("auto")}
            value="auto"
          >
            <ModelSelectorName>{t("chat.autoModel")}</ModelSelectorName>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {t("chat.autoModelHint")}
            </span>
          </ModelSelectorItem>
```

`handleModelSelect("auto")` already does the right thing: it sets the `chat-model` cookie to `auto` and POSTs `auto` as the topic default model, which the route intercepts.

- [ ] **Step 2: Ensure the default-model endpoint accepts `"auto"`**

Open `app/(chat)/api/workspace/topics/[id]/default-model/route.ts` and check whether it validates `modelId` against the known/active model list. If it does, allow the sentinel `"auto"` to pass (e.g. `if (modelId !== "auto" && !isKnownModel(modelId)) { reject }`), so selecting Auto persists as the topic default. If it stores the string without validation, no change is needed. Run `corepack pnpm exec tsc --noEmit` after any change.

- [ ] **Step 3: Add i18n strings**

In `lib/i18n/messages/chat.ts`, add to each locale:

```ts
// en
    "chat.autoModel": "Auto",
    "chat.autoModelHint": "Picks a model per message",
// zh
    "chat.autoModel": "自动",
    "chat.autoModelHint": "每条消息自动选模型",
// fr
    "chat.autoModel": "Auto",
    "chat.autoModelHint": "Choisit un modèle par message",
```

- [ ] **Step 4: Verify + commit**

```bash
corepack pnpm exec tsc --noEmit
corepack pnpm exec biome check --write components/chat/multimodal-input.tsx lib/i18n/messages/chat.ts
git add -A
git commit -m "feat(ui): add Auto entry to the model selector"
```

---

## Task 5: Model-used badge (history map + live part + rendering)

**Files:**
- Modify: `app/(chat)/api/messages/route.ts`
- Modify: `hooks/use-active-chat.tsx`
- Modify: `components/chat/shell.tsx`
- Modify: `components/chat/messages.tsx`
- Modify: `lib/i18n/messages/chat.ts`

- [ ] **Step 1: Return a per-message model map from `/api/messages`**

In `app/(chat)/api/messages/route.ts`:

(a) Add the import:

```ts
import { listWorkspaceMessagesByConversationId } from "@/lib/workspace/queries";
```

(b) Add it to the `Promise.all` (alongside `getMessagesByChatId`):

```ts
  const [session, chat, messages, checkpoint, workspaceMessages] =
    await Promise.all([
      auth(),
      getChatById({ id: chatId }),
      getMessagesByChatId({ id: chatId }),
      getCompactionCheckpoint(chatId),
      listWorkspaceMessagesByConversationId(chatId),
    ]);
```

(c) Build the map after the access checks and include it in the success response (the `!chat` branch returns `models: {}`):

```ts
  const modelByMessageId: Record<string, string> = {};
  for (const workspaceMessage of workspaceMessages) {
    if (workspaceMessage.role === "assistant" && workspaceMessage.model) {
      modelByMessageId[workspaceMessage.id] = workspaceMessage.model;
    }
  }
```

Add `models: modelByMessageId,` to the main `Response.json({ ... })`, and `models: {},` to the early `!chat` response.

- [ ] **Step 2: Expose the map (and live model) from `useActiveChat`**

In `hooks/use-active-chat.tsx`:

(a) After `const visibility ...`:

```ts
  const modelByMessageId: Record<string, string> = chatData?.models ?? {};
```

(b) Add `modelByMessageId` to the `ActiveChatContextValue` type and to the `value` object + its dependency array (same pattern as `compactedThroughMessageId`).

- [ ] **Step 3: Thread it through `shell.tsx`**

In `components/chat/shell.tsx`, destructure `modelByMessageId` from `useActiveChat()` and pass `modelByMessageId={modelByMessageId}` to `<Messages>`.

- [ ] **Step 4: Render the badge in `messages.tsx`**

In `components/chat/messages.tsx`:

(a) Add the prop to `MessagesProps`:

```ts
  modelByMessageId?: Record<string, string>;
```

(b) Destructure it in `PureMessages` params: `modelByMessageId,`.

(c) Derive the live model from the data stream. Add near the top of `PureMessages` (it already calls `useDataStream()` — capture its return):

```ts
  const { dataStream } = useDataStream();
  const liveModel = (() => {
    for (let i = dataStream.length - 1; i >= 0; i -= 1) {
      if (dataStream[i].type === "data-model") {
        return dataStream[i].data as string;
      }
    }
    return null;
  })();
```

(Replace the existing bare `useDataStream();` call with the destructured form above.)

(d) Add a label helper and badge component (top of file, after imports):

```tsx
import { chatModels } from "@/lib/ai/models";

function modelLabel(id: string): string {
  const known = chatModels.find((model) => model.id === id);
  if (known) {
    return known.name;
  }
  const tail = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return tail;
}

function ModelBadge({ label }: { label: string }) {
  return (
    <div className="mt-1 text-[11px] text-muted-foreground/45">{label}</div>
  );
}
```

(e) In the `messages.map(...)` Fragment, after `<PreviewMessage .../>` and before the compaction divider, render the badge for assistant messages:

```tsx
              {message.role === "assistant" &&
                (() => {
                  const modelId =
                    modelByMessageId?.[message.id] ??
                    (index === messages.length - 1 ? liveModel : null);
                  return modelId ? (
                    <ModelBadge
                      label={t("chat.answeredVia", {
                        model: modelLabel(modelId),
                      })}
                    />
                  ) : null;
                })()}
```

- [ ] **Step 5: Add the i18n string**

In `lib/i18n/messages/chat.ts`, add to each locale:

```ts
// en
    "chat.answeredVia": "via {model}",
// zh
    "chat.answeredVia": "由 {model} 回答",
// fr
    "chat.answeredVia": "via {model}",
```

- [ ] **Step 6: Verify + commit**

```bash
corepack pnpm exec tsc --noEmit
corepack pnpm exec biome check --write "app/(chat)/api/messages/route.ts" hooks/use-active-chat.tsx components/chat/shell.tsx components/chat/messages.tsx lib/i18n/messages/chat.ts
git add -A
git commit -m "feat(chat): model-used badge (history map + live data part)"
```

---

## Task 6: Full verification

- [ ] **Step 1: Whole-project typecheck**

Run: `corepack pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full unit suite**

Run: `corepack pnpm exec tsx --test tests/unit/*.test.ts`
Expected: all pass (P1 + new Auto-router tests).

- [ ] **Step 3: Manual smoke (user, localhost)**

- Pick **Auto** in the model selector → send a short message ("hi") → badge shows an economy model (DeepSeek).
- Send "Explain the tradeoffs of X in depth" → badge shows a stronger model.
- Switch account menu **Response quality** to **Best** → a short message now routes to a stronger model.
- Pick a concrete model manually → behaves exactly as before; badge shows that model.

---

## Notes / cross-task invariants

- New symbols and their owners: `classifyTier`, `pickModel`, `routeAutoModel`, `AutoRoutingSignals` (Task 1, `model-policy.ts`); data part `model` (Task 2, `lib/types.ts`); `QualityProvider`/`useQuality` (Task 3); i18n keys `chat.quality*`, `chat.autoModel*`, `chat.answeredVia` (Tasks 3–5, `lib/i18n/messages/chat.ts`); `modelByMessageId` (Task 5).
- `QualityPreference` already exists in `lib/ai/model-policy.ts` (P1) — do not redefine it.
- No DB migration. `pickModelByTier` keeps its signature (now delegates to `pickModel`), so the P1 tests and the background-task call sites are unaffected.
