<p align="center">
  <h1 align="center">ZENO</h1>
  <p align="center">
    <strong>A judgment-native AI workspace for long-cycle projects</strong>
  </p>
</p>

<p align="center">
  <strong>English</strong> ｜ <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-Private%20Beta-green" alt="Status" />
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/AI%20SDK-6-black" alt="AI SDK 6" />
  <img src="https://img.shields.io/badge/db-Drizzle%20%2B%20Postgres-blue" alt="Drizzle + Postgres" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0" />
</p>

> **Status note.** This README describes what ZENO does **today**. Features that are
> designed but not yet built are collected under [Roadmap](#roadmap--not-yet-built)
> so the picture stays honest.

---

## What is ZENO?

ZENO is an AI workspace where project judgment persists across sessions, topics, and AI agents — so the decisions, constraints, and open questions you've already worked through don't have to be reconstructed every time you return.

Unlike normal AI chat tools, ZENO does not treat conversation history as the source of truth. It treats **confirmed judgment** as the durable state of a project. Nothing enters project truth without explicit user confirmation.

---

## Why ZENO exists

When people use AI in long-cycle projects, the problem is rarely "the model is not smart enough." The real problem is that **project judgment does not accumulate**.

Over time:

- context gets buried in chat history
- prior decisions get forgotten
- rationale disappears
- different AI agents start from zero again and again

65% of developers cite missing context as the top cause of poor AI code quality (Stack Overflow 2026). Projects with well-maintained context files see 40% fewer agent errors and 55% faster task completion (Anthropic Agentic Coding Report 2026). People are already solving this manually — maintaining CLAUDE.md files, writing session handoff notes, building 18,000-line PROJECT_JOURNAL systems. ZENO makes this structural, not manual.

---

## How it works

### 1. Work inside a project, not isolated chats
Each project has multiple topics. Each topic hosts an ongoing conversation — the **Sandbox** — where you actually think, explore, and decide.

### 2. Three-stage funnel: Idea → Candidate → Truth
Not every thought is project truth. ZENO uses a three-stage funnel (backed by node statuses `idea` → `pending` → `active`):

- **Idea** — mid-confidence things ZENO noticed in your conversation but isn't sure are decisions yet. Quietly listed; no action required.
- **Candidate** — high-confidence judgments waiting for your confirmation.
- **Truth** — confirmed judgments. The durable state of your project. Read-only afterward; changes go through supersede, not edit.

### 3. Extraction mechanisms
ZENO captures judgment from your conversation through several mechanisms, ordered by user-signal strength:

| Mechanism | Trigger | Status |
|---|---|---|
| Inline marker | AI marks a clear judgment as it writes | ✅ Live |
| Sweep on "Explore new idea" | You click "Explore new idea" — the primary signal | ✅ Live |
| Manual sweep | You trigger an extraction sweep over the conversation | ✅ Live |
| `/save` | You select text and save it manually | 🔜 Planned |
| Periodic safety sweep | Auto-trigger after N turns as a backstop | 🔜 Planned |
| Agent-handoff sweep | Blocking sweep before a coding agent reads truth via MCP | 🔜 Planned |

The principle is simple: **prefer to miss a judgment than to make one up**. ZENO never auto-writes truth — every candidate requires your explicit confirmation.

### 4. The Truth Graph makes judgment inspectable
The right panel renders your project's judgment as an interactive **graph canvas** (custom SVG + [ELK](https://github.com/kieler/elkjs) layout), not a flat list. Two scope modes: **All** (truths + candidates + ideas, with cross-stage edges) and **Truth** (confirmed truths only). Click any node — its full detail (rationale, source, relations, actions) opens in a unified detail pane below the canvas. One place where details live: no modals, no nested panels.

### 5. Future sessions inherit truth automatically
Every new conversation in the same project automatically receives the relevant confirmed truth as context. The AI knows what you've decided, what you've rejected, and why — without you pasting anything.

### 6. Coding agents read your truth via MCP
When you hand off to a coding agent (Claude Code, Cursor, Codex), ZENO's MCP server gives it the same project truth. It exposes **read tools** (project/topic context, decisions, open questions, rejections, IR search/get) plus **write tools**, all of them **candidate-first and enforced server-side**: every MCP write — create, update, archive, supersede, resolve, edges — lands as a candidate in your review queue and becomes truth only after you confirm it (Iron Law 4). There is no direct mutation path.

---

## Who ZENO is for

ZENO V1 is built for **solo founders and independent builders running long-cycle projects with AI**. More precisely: people who are both the judgment owner and the implementer, switching between thinking AI (for product/strategy decisions) and coding AI (for execution).

V1 is not for everyone. It assumes:

- **You take project context seriously.** You already maintain CLAUDE.md / AGENTS.md / handoff notes manually; ZENO automates and structures this.
- **You are the single judgment owner.** V1 assumes one person makes the calls. Multi-person team coordination is V2.
- **You work across multiple AI agents.** Claude, GPT, Gemini for thinking; Claude Code / Cursor / Codex for implementation. ZENO gives them all the same judgment substrate.
- **Your projects span weeks or months.** Short one-off tasks don't need ZENO.

---

## V1 scope

### Built today

- Project → topic → Sandbox conversation structure
- Three-stage funnel (Idea → Candidate → Truth) with explicit user confirmation
- Extraction: inline markers, "Explore new idea" sweep, manual sweep
- Truth Graph canvas (SVG + ELK) with **All** / **Truth** scope modes and a unified detail pane
- Inline references in chat — active truth (blue underline), pending candidate (blue dashed pill), superseded (gray strikethrough), all clickable
- Reactivation Anchor — load a past truth node back into the conversation as active context
- Git-style immutable history (supersede instead of edit)
- MCP server: read tools + `submit_candidate` + controlled decision/edge writes
- Automatic truth inheritance into every new conversation in a project
- Multi-provider model routing (Anthropic · Amazon Bedrock · OpenAI) with a thinking-depth control
- In-app localization (English · 中文 · Français)

### What V1 deliberately does not do

- No auto-writing to project truth — every entry requires user confirmation
- No execution and no write-side autonomy — read-only autonomous research is core (see Iron Law 0); executing code or tools is not
- No BYOK (bring your own key) — platform keys only
- No conversation import — projects start fresh in ZENO
- No general-purpose knowledge base — ZENO stores project judgment, not arbitrary notes
- No multi-user collaboration in V1 (single judgment owner; multi-user is V2)
- No mobile UI in V1 (desktop only; mobile in V1.5)

---

## Core concepts

### Truth Substrate
Project-level confirmed judgment that persists across sessions, AI agents, and tools. Not chat history. Not memory snippets. Structured nodes with a **kind** (`open_question` / `goal` / `constraint` / `plan` / `hypothesis` / `principle` / `rejection`), a status, relations, and rationale. Read-only after confirmation; modifications go through supersede.

### Sandbox
The chat container under each topic. Where actual thinking and exploration happens. A user can "Explore new idea" to clear the chat and trigger sweep extraction — declaring "I want to switch to a different idea." The cleared conversation is preserved server-side as immutable history; only the visual chat is reset.

### Truth Graph
The right-side interface where project judgment becomes inspectable: an interactive graph canvas (SVG + ELK layout) rather than a flat list. Nodes are laid out by their relations; a draggable detail pane below the canvas shows the selected node's rationale, source, and actions. Scope toggles between **All** (truths + candidates + ideas) and **Truth** (confirmed only).

### Reactivation Anchor
When you load a past truth node into the current conversation, ZENO sets it as the **active context anchor** — the AI knows you're refining or extending this specific judgment. New candidates extracted in that session default to a relation hint pointing at the anchor.

### Inline Reference
When AI generates a response and judges that the conversation just produced a clear truth-worthy judgment, it embeds a marker. The marker renders inline in chat as a clickable reference — blue underlined for active truth, blue dashed pill for pending candidate, gray strikethrough for superseded. Click → open in the detail pane.

### Core loop
**Sandbox conversation → Extraction → Idea / Candidate funnel → User confirmation → Truth → Inherited by future sessions and agents**

---

## What makes ZENO different

Most AI products are built around one of these units: chat history, prompts, documents, or memory snippets.

ZENO is built around a different unit:

### **Judgment**

A judgment is not just text. It has a kind, a status, a rationale, relations to other judgments, and consequences inside a project. That is the foundation of judgment continuity across time and agents.

---

## What ZENO is NOT

- Not a general-purpose chatbot
- Not a tool aggregator or navigation hub
- Not a multi-model shell
- Not a one-shot result generator
- Not a chat-history wrapper with "memory" branding
- Not a competitor to coding agents — ZENO **feeds** them, doesn't replace them

---

## Design principles

ZENO follows one duty and four iron laws that guide every design decision:

- **Iron Law 0 — Proactive diligence.**
  ZENO must act on the project unprompted: decompose, research, verify, report. Its autonomy is always read-only — everything it produces enters the funnel as idea / candidate / evidence, never becomes truth on its own, and nothing is ever executed. Laws 1–4 are boundaries; when the duty conflicts with a boundary, the boundary wins.

- **Iron Law 1 — Never own the execution environment, only judgment.**
  ZENO does not run code, write files, or do automated tasks. It maintains decision truth. Coding agents do execution; ZENO supplies their context. This is a neutrality commitment — agents trust ZENO precisely because it never executes and never competes with them.

- **Iron Law 2 — Prefer to miss than to make up.**
  Trust-preserving recall beats maximum recall. A wrong truth poisons all downstream work; a missed truth can be added later.

- **Iron Law 3 — Don't store raw transcripts, casual preferences, or auto-generated plans as truth.**
  Truth is what the user explicitly confirms. The boundary between conversation and truth must be sharp.

- **Iron Law 4 — MCP write is candidate-first; truth is user-confirmed.**
  External coding agents propose new candidates via MCP; only the user promotes a candidate to truth.

Beyond the iron laws:

- **Automate investigation; confirm truth; ration confirmation** — investigation can be unlimited, but confirmation is a scarce resource: ZENO never auto-writes truth, and never converts investigation volume into confirmation-request volume.
- **Project state is the source of truth, not any single conversation.**
- **Build only what must be built — no unnecessary wheels.**

---

## Roadmap / not yet built

These are designed but **not implemented yet** — listed for context, not commitment.

| Item | Stage |
|---|---|
| `/save` select-to-save extraction | V1 |
| Periodic safety sweep (every N turns) | V1 |
| Agent-handoff blocking sweep before MCP read | V1 |
| Reactivation-anchor decay over turns | V1 |
| Credit-based pricing / billing | V1 |
| **L1 Kickoff** — intake interview + seeded topic decomposition on project creation | V1 |
| **L2 Research Brief** — "Research this" on a node → sourced evidence brief | V1.x |
| Multi-model `@mentions` (`@opus`, `@gpt54`) | V1.5+ |
| Mobile UI | V1.5 |
| **Watchtower (L3)** — scheduled re-verification of externally exposed assumptions | V1.5 |
| **Council (redefined)** — adversarial check on high-stakes candidates before confirmation | V1.5+ |
| **Multi-user collaboration** — team-level decision substrate | V2 |

---

## Status

🟢 **V1 — Private Beta (invite-only).** The core judgment-continuity loop is live behind invite codes: Sandbox conversation → extraction → 3-stage funnel → user confirmation → truth → inherited by future sessions and coding agents. Current focus is hardening the research pipeline (source scoring, quote verification, provider resilience) based on beta usage.

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/ir-ui-interaction-v1.3.md`](./docs/ir-ui-interaction-v1.3.md) | IR UI / UX spec — visual states, interaction flows, components |
| [`docs/zeno-truth-graph-rules.md`](./docs/zeno-truth-graph-rules.md) | Truth Graph layout and interaction rules |
| [`docs/phase-2-risks-and-todo.md`](./docs/phase-2-risks-and-todo.md) | Phase-2 risks and open TODOs |
| [`docs/superpowers/`](./docs/superpowers/) | Per-feature design specs and implementation plans |

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) · React 19 |
| Language | TypeScript |
| AI | Vercel AI SDK 6 · providers: Anthropic, Amazon Bedrock, OpenAI |
| Database | PostgreSQL via Drizzle ORM (`drizzle-kit` migrations) |
| Auth | Supabase Auth (`@supabase/ssr`) |
| Graph layout | ELK.js (Truth Graph canvas) |
| Rich text | ProseMirror · CodeMirror · Shiki |
| Streaming / cache | Redis (resumable streams) · Vercel Blob |
| Styling | Tailwind CSS 4 · Radix UI · Framer Motion |
| Tooling | Biome / Ultracite · Playwright · pnpm |
| External integration | MCP (Model Context Protocol) — read tools + `submit_candidate` + controlled writes |
| Target deployment | Vercel |

---

## License

**deepzeno** is licensed under the **GNU Affero General Public License v3.0 or
later** (AGPL-3.0-or-later) — see [`LICENSE`](./LICENSE).

Under the AGPL, if you run a modified version of deepzeno as a network service,
you must make your modified source available to that service's users. This keeps
the project open while leaving room for a commercially operated hosted version.

Portions of the code derive from the [Vercel AI Chatbot](https://github.com/vercel/ai-chatbot)
template (© Vercel, Inc., Apache-2.0); that license is preserved in
[`LICENSE-APACHE-2.0`](./LICENSE-APACHE-2.0) and summarized in [`NOTICE`](./NOTICE).

The AGPL applies to the source code in this repository. Any hosted subscription
version is operated separately under its own commercial terms.

## Contributing

Contributions are welcome. By submitting a pull request you agree to the
[Contributor License Agreement](./CLA.md), which allows the maintainer to offer
the project under both the AGPL and separate commercial licenses.
