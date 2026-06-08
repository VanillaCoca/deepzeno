# P2 — Auto foreground model + quality knob + model-used badge

Status: design approved 2026-06-08. Part of the ZENO model-routing plan (P1 foundation already shipped).

## Goal

Give the foreground chat an optional **Auto** model that picks a model per message by simple rules, a global **Economy/Balanced/Best** quality knob that tunes how aggressive Auto is, and a **model-used badge** so the user can always see which model actually answered (transparency matters most exactly when Auto chose).

This builds directly on the P1 foundation: `lib/ai/model-policy.ts` (`selectModelForTask`, `pickModelByTier`, `QualityPreference`) and the model registry's `tier` / `capabilities` metadata.

## Decisions (locked)

- **Auto mechanism:** pure rules pre-routing (no extra model call, no added latency). Upgradeable later to a classifier/cascade; not in P2.
- **Knob scope:** the quality knob affects **foreground Auto only**. Background tasks (IR sweep, compaction summary, title, research) keep their own fixed tiers — protects IR-extraction quality from an "Economy" setting.
- **Auto positioning:** opt-in. New users / new topics still default to the current `DEFAULT_CHAT_MODEL`; Auto is one option in the model picker.
- **No DB migration** (knob is client-side; assistant `model` is already persisted).

## Component 1 — Auto routing (rules, foreground, opt-in)

A synthetic model entry `Auto` (id `"auto"`) is added to the picker with copy like "Auto — picks a model for each message". Selecting it stores `currentModelId = "auto"` (cookie, like other models).

When the effective model for a turn resolves to `"auto"`, the route computes the real model via a new pure function in `model-policy.ts`:

```
routeAutoModel(
  signals: { text: string; hasImage: boolean },
  preference: QualityPreference,
  env
): string
```

Logic:
1. `base = classifyTier(signals.text)`:
   - hard signals → `frontier`: text matches `/\b(explain|analy[sz]e|design|architect|debug|prove|derive|refactor|optimi[sz]e|research|compare|evaluate|plan)\b/i`, OR `text.length > 2000`, OR contains a fenced code block.
   - trivial → `economy`: `text.length < 120` and no hard signal.
   - otherwise → `standard`.
2. `shifted = clamp(rank(base) + shift(preference))` where `shift` is economy=-1, balanced=0, best=+1; clamp to [economy, frontier].
3. Pick a concrete model with `pickModel({ tier: shifted, requireVision: signals.hasImage, env })`:
   - candidates = active models; if `requireVision`, filter to `capabilities.vision === true`; if that empties the set, fall back to all active (best effort).
   - choose the candidate nearest the target tier (reuse the existing `tierDistance` ordering).

Precedence and interception: the route already computes the selected id as
`messageModelOverride ?? topic.defaultModelId ?? selectedChatModel`. `"auto"` is
intercepted **on the result of that chain**: if it equals `"auto"`, run
`routeAutoModel(...)` to get a concrete id, then proceed (resolve + load) with
that. An `@model` mention is a concrete id and is checked first, so it naturally
wins over Auto. Selecting Auto in the picker persists `"auto"` as the topic
default model (same path as picking any model today), so the chain yields
`"auto"` on subsequent turns until the user picks something else. The persisted
assistant `model` is always the **resolved** model id, never `"auto"`.

## Component 2 — Quality knob (Economy / Balanced / Best)

- Global client preference, default **Balanced**.
- Stored in `localStorage` under `zeno-quality` and read by a tiny client provider/hook (mirrors the locale pattern, minus the cookie — only the client needs it).
- UI: a "Response quality" submenu in the account menu (the same menu that hosts the Language submenu).
- Sent to the chat route in the request body as `qualityPreference` (alongside `locale`). The server uses it **only** when the effective model is `"auto"`.
- `QualityPreference` type already exists in `lib/ai/model-policy.ts`.

## Component 3 — Model-used badge

A small muted badge under each assistant bubble (e.g. `via DeepSeek`) showing the resolved model.

- **History:** `/api/messages` additionally loads the conversation's workspace messages and returns a `modelByMessageId` map (assistant messages only). Same plumbing pattern as the compaction checkpoint already added to that route.
- **Live (current turn):** the chat route emits the resolved model as a `data-model` stream part (the route already emits `data-chat-title`). Because the assistant message id is not known when the stream starts, the client attaches the emitted model to the in-flight assistant message (the latest one) rather than keying by id; on reload the `/api/messages` map is authoritative. This keeps the in-flight turn's badge visible immediately — important because Auto's pick is otherwise invisible until reload.
- Rendering: thread the model-by-id map from `useActiveChat` → `shell.tsx` → `Messages`, render the badge for assistant messages (same threading the compaction divider used).
- Shown for manually-picked models too (redundant but consistent and unobtrusive).

## Component 4 — Wiring & testing

- `app/(chat)/api/chat/route.ts`: read `qualityPreference` from the body; after resolving the selection, if the effective model id is `"auto"`, call `routeAutoModel({ text, hasImage }, preference)` to get the real model id before `getLanguageModel`. Emit `data-model`.
- `app/(chat)/api/chat/schema.ts` (`postRequestBodySchema`): allow `qualityPreference` and accept `"auto"` as `selectedChatModel`.
- `lib/ai/model-policy.ts`: add `routeAutoModel`, `classifyTier`, and a capability-aware `pickModel`. Keep `pickModelByTier` as-is.
- `components/chat/multimodal-input.tsx`: prepend the synthetic `Auto` entry to the model list; treat `"auto"` as a valid selection.
- Account-menu component: add the "Response quality" submenu.
- `app/(chat)/api/messages/route.ts`, `hooks/use-active-chat.tsx`, `components/chat/shell.tsx`, `components/chat/messages.tsx`, data-stream provider: thread + render the badge.
- Tests: pure-function unit tests for `routeAutoModel` / `classifyTier` (signals + preference → expected tier/model), in the P1 test style.

## Out of scope (deferred)

- Difficulty classifier (cheap-model scoring), cascade/verify-and-escalate, learned router — later phases.
- Per-topic or per-task knobs (knob is global, Auto-only for now).
- Changing background-task tiers (IR sweep / compaction stay as today).

## Success criteria

- Selecting Auto routes each turn to a sensible model by the rules above, respecting `@`-mention precedence and vision needs.
- The quality knob visibly shifts Auto's choices (Economy cheaper, Best stronger) and affects nothing else.
- Every assistant message shows the model that answered, live and in history.
- No behavior change when a concrete model is selected; no DB migration; `tsc` + `biome` clean; new unit tests pass.
