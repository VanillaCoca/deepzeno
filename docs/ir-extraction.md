# ZENO V1 — IR Extraction Mechanism Spec

**Owners:**
- Sean (product / final review)
- Lixian (extraction prompts, model behavior tuning)
- Codex (application layer implementation)
- Local migration runner / Lixian (Supabase schema migrations)

**Status:** Draft v1.3
**Last updated:** 2026-05-02
**Replaces:** v1.2 (added: per-section audience tags; renamed user_clear_sandbox → user_starts_new_idea; renamed Clear button to 'Explore new idea' across docs; right-side 4-zone panel layout — see ir-ui-interaction.md v1.2)

**Audience tag legend** (used in section headers throughout):
- `[Owner: Codex]` — application layer code (TypeScript, API, frontend)
- `[Owner: Lixian — Prompt]` — LLM prompt design and tuning
- `[Owner: Supabase Runner]` — DB schema migration owner (Sean or Lixian)
- `[Owner: Sean — Decision]` — open question requiring Sean's call
- `[Audience: All]` — read by everyone; design context

---

## 0. Purpose [Audience: All]

本文档定义 ZENO V1 中 IR (Intermediate Representation) candidate 的提取机制——**何时、如何、以什么格式**从对话中产出 candidate node,并写入 `ir_nodes` 表。

UI 层(如何展示 candidate、如何 confirm)见 `ir-ui-interaction.md`。本文档只关心**数据契约**和**提取逻辑**。

任务分工:
- **Supabase migrations** (sections 3, 12.1, appendix A/B): 由 Sean 或 Lixian 在本地 supabase CLI 跑
- **Codex tasks** (sections 5-9, 11, 12.2-12.5): 应用层代码,Codex 实现
- **Lixian** (sections 4, 5.2, 6.3, 13): prompt 工程内容

---

## 1. Core Principles [Audience: All]

```
1. Truth 由用户 confirm 产生,不由 AI 单方面决定。
2. AI 只产出 candidate,永远不直接写入 active truth。
3. 提取的判断标准是「语义成型」,不是「频率」或「关键词匹配」。
4. 漏提取 (false negative) 优于错提取 (false positive) —— 第二 iron law: 宁漏勿错。
5. 每个 candidate 必须可追溯到 source chat turn(或用户 /save 动作)。
6. ir_nodes 是 immutable history (git-style) —— 修改通过 supersede,不通过 update。
7. 每次 agent handoff 前必须确保 truth 不落后于对话(见 section 9: Agent Handoff Coverage Check)。
```

---

## 2. Five-Mechanism Extraction Architecture [Audience: All]

ZENO V1 的供给端由五个机制组成,按"用户信号强度"递减排列:

### 机制 A: User /save (manual, highest signal)
- **触发**: 用户选中 chat 中的一段文本,执行 /save 命令
- **行为**: 直接写入 candidate(`source_layer='manual'`),跳过 AI 抽取器
- **kind**: 默认 `unclassified` 状态;后台异步 LLM 推断 kind suggestion(用户可修改或跳过)
- **置信度**: 视为最高(用户显式标注)
- 详见 section 7

### 机制 B: AI Inline Marker (real-time, model-driven)
- **触发**: AI 在生成对话回复时,识别到对话中刚产出了一个语义成型的 IR node
- **输出**: 在主回复 markdown 流中嵌入 `[[ir:...]]` 标记(详见 section 5)
- **召回策略**: 保守 (high precision, low recall) —— 仅 emit 非常明确的 candidate
- **不是 turn-level Salience Gate**: inline marker 嵌入在 AI 生成 prompt 中,不需要额外 LLM 调用,与 V1.5 可能的 Salience Gate 是两个机制
- 详见 section 5

### 机制 C: Sweep Extraction (event-driven, async)
- **触发器**(任一满足):
  1. 用户清空对话(主信号)
  2. 距上次 sweep 完成已 > 20 turns(safety net)
  3. 用户切换 topic / project
  4. 用户主动点击 "Review session"
  5. **MCP agent handoff(见 section 9)**
  6. 用户 idle > 1 hour(辅助,降级触发)
- **召回策略**: 较宽松,产出双层结果 —— 高置信度进 `pending`,中置信度进 `idea`
- 详见 section 6

### 机制 D: Reactivation Anchor (context modifier, not a trigger)
- 不是独立触发器,而是修饰其他机制的 sweep / inline 行为
- 用户从 Truth Tree 加载某 IR 历史进 Sandbox 时,session 设置 `reactivation_anchor = <IR_id>`
- 后续抽取的 candidate 默认带 relation hint:"可能与 anchor 相关"
- 详见 section 8

### 机制 E: Idea Funnel (output classification)
- 不是独立触发器,而是 sweep extractor 的输出形式之一
- Sweep 产出区分 `pending`(高置信)和 `idea`(中置信)
- Idea 是用户可见但非主操作区的"尚未成熟"想法
- UI 落点见 ir-ui-interaction.md v1.2 §5.2(右侧 Ideas zone,默认折叠)
- Idea 状态及转换详见 section 3.3

---

## 3. Database Schema (Supabase Migration) [Owner: Supabase Runner]

> **Owner**: Sean / Lixian via supabase CLI
> **File**: `supabase/migrations/20260502000001_ir_nodes_and_edges.sql`

### 3.1 `ir_nodes` Table

```sql
CREATE TABLE ir_nodes (
  id TEXT PRIMARY KEY,                    -- Human-readable: 'D5', 'Q3', 'T1'
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,

  kind TEXT NOT NULL CHECK (kind IN (
    'goal', 'constraint', 'plan',
    'hypothesis', 'principle', 'open_question', 'rejection',
    'unclassified'  -- only allowed when status='pending' AND source_layer='manual'
  )),

  -- Subtype is required when kind='plan', otherwise must be NULL
  subtype TEXT CHECK (
    (kind = 'plan' AND subtype IN ('decision', 'task', 'milestone'))
    OR (kind != 'plan' AND subtype IS NULL)
  ),

  status TEXT NOT NULL CHECK (status IN (
    'idea',         -- mid-confidence sweep result; visible in Idea sub-zone, not in main candidate flow
    'pending',      -- candidate, ready for user confirmation
    'active',       -- confirmed truth
    'superseded',   -- replaced by a newer node
    'dismissed'     -- user rejected this candidate
  )),

  title TEXT NOT NULL CHECK (length(title) <= 200),
  content TEXT,
  rationale TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'normal'
    CHECK (sensitivity IN ('normal', 'vault')),

  -- Source tracing (required)
  source_chat_id UUID REFERENCES chats(id),
  source_turn_id UUID REFERENCES chat_turns(id),
  source_text_span TEXT,  -- for /save: the exact selected text; null otherwise
  source_layer TEXT CHECK (source_layer IN ('inline', 'sweep', 'manual', 'mcp')),
  
  -- Reactivation context: which IR was the anchor when this was extracted
  reactivation_anchor_id TEXT REFERENCES ir_nodes(id),

  -- Sweep-specific: confidence used to route into idea vs pending
  extraction_confidence NUMERIC,  -- only set for source_layer='sweep'

  -- Lifecycle (immutable history; see section 10)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_to_pending_at TIMESTAMPTZ,  -- when idea was promoted to pending
  confirmed_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  superseded_by TEXT REFERENCES ir_nodes(id),

  created_by TEXT NOT NULL CHECK (created_by IN ('ai', 'user', 'mcp')),
  confirmed_by UUID REFERENCES users(id)
);

CREATE INDEX idx_ir_nodes_project_status ON ir_nodes(project_id, status);
CREATE INDEX idx_ir_nodes_topic ON ir_nodes(topic_id) WHERE topic_id IS NOT NULL;
CREATE INDEX idx_ir_nodes_pending ON ir_nodes(project_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX idx_ir_nodes_idea ON ir_nodes(project_id, created_at DESC)
  WHERE status = 'idea';
CREATE INDEX idx_ir_nodes_active ON ir_nodes(project_id, kind)
  WHERE status = 'active';
CREATE INDEX idx_ir_nodes_lifecycle ON ir_nodes(project_id, confirmed_at, superseded_at);
```

### 3.2 `ir_edges` Table (Relations)

```sql
CREATE TABLE ir_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  from_node TEXT NOT NULL REFERENCES ir_nodes(id),
  to_node TEXT NOT NULL REFERENCES ir_nodes(id),

  relation TEXT NOT NULL CHECK (relation IN (
    'supersedes',     -- A replaces B (mutates B.status)
    'resolves',       -- A answers B (typically a question)
    'depends_on',     -- A depends on B
    'implies',        -- A implies B
    'contradicts',    -- A conflicts with B (V1: detect-only, no auto-resolve)
    'refines'         -- A is a refinement of B
  )),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'dismissed')),

  -- Reactivation anchor relations are stored as 'pending' with 'hint' flag
  -- so user can confirm/override during candidate review
  is_anchor_hint BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,

  CONSTRAINT no_self_loop CHECK (from_node != to_node),
  UNIQUE (from_node, to_node, relation)
);

CREATE INDEX idx_ir_edges_from ON ir_edges(from_node);
CREATE INDEX idx_ir_edges_to ON ir_edges(to_node);
CREATE INDEX idx_ir_edges_active ON ir_edges(project_id) WHERE status = 'active';
```

### 3.3 Status Transition Rules (Enforced at DB Trigger + API Layer)

```
ir_nodes:
  idea        → pending      (user promotes, or sweep re-classifies on next pass)
  idea        → dismissed    (user dismisses idea)
  pending     → active       (user confirm)
  pending     → dismissed    (user ignore)
  active      → superseded   (a new candidate with relation=supersedes is confirmed)
  active      → active       FORBIDDEN — content edits must go through supersede
  *           → other        FORBIDDEN

  Special case: /save with kind='unclassified' may have its kind UPDATED
    while status='pending' (LLM kind suggestion or user pick).
    Once status moves to 'active', kind is locked.

ir_edges:
  pending     → active       (parent node confirmed, edge inherits)
  pending     → dismissed    (user removes relation during confirm, or anchor hint rejected)
  active      → *            FORBIDDEN
```

DB-level trigger enforces transitions; SQL in **Appendix A**.

**MCP write constraint**: external agents writing via `submit_candidate` MCP tool MUST set `status='pending'`. Application layer rejects any write where `status != 'pending'` from MCP source. This implements iron law #4 at the application boundary. MCP agents may NOT write `status='idea'` — idea is a system-internal classification.

### 3.4 ID Generation Rules

ID format: `{prefix}{number}`

| kind | subtype | prefix | example |
|------|---------|--------|---------|
| goal | — | G | G1, G2 |
| constraint | — | C | C1, C2 |
| plan | decision | D | D1, D2 |
| plan | task | T | T1, T2 |
| plan | milestone | M | M1, M2 |
| hypothesis | — | H | H1, H2 |
| principle | — | R | R1, R2 |
| open_question | — | Q | Q1, Q2 |
| rejection | — | X | X1, X2 |
| unclassified | — | U | U1, U2 (transient; reassigned on classification) |

**Why subtype on `plan`**: V1 锁的 7 kinds 不变,但 `plan` 在实际使用中三种语义混杂——决策 (decisions)、待办 (tasks)、里程碑 (milestones)。subtype 区分这三种以让 UI prefix 直观 (D/T/M)。

**Why `unclassified` is allowed**: only for `/save` channel where user demands zero-friction save. Once kind is determined (LLM suggestion accepted, or user manual pick), the row's `id` is **reissued** to match the proper prefix. See section 7.3 for ID transition rules.

**ID generation algorithm** (Codex implements in API layer):

```typescript
async function nextId(projectId: string, kind: string, subtype?: string): Promise<string> {
  const prefix = PREFIX_MAP[`${kind}:${subtype ?? '_'}`];  // 'D', 'T', 'Q', etc.
  
  const { rows } = await db.query(`
    SELECT COALESCE(MAX(CAST(substring(id from '\\d+$') AS INTEGER)), 0) + 1 AS next
    FROM ir_nodes
    WHERE project_id = $1 AND id LIKE $2
  `, [projectId, `${prefix}%`]);
  
  return `${prefix}${rows[0].next}`;
}
```

IDs are per-project, monotonic within each prefix group, and never reused (even after dismiss). Exception: when an `unclassified` (U-prefix) row is reclassified, the old U-id is logged in telemetry and a new id under the proper prefix is issued; the U-id is never reused for another row.

### 3.5 Session State (Application-Layer, Not Persisted in ir_nodes)

Reactivation anchor is **session-scoped state**, not stored in `ir_nodes`. Each chat session tracks:

```typescript
interface ChatSessionState {
  chat_id: string;
  reactivation_anchor: {
    ir_id: string;            // e.g. 'D17'
    set_at_turn: number;      // turn index when anchor was set
    strength: 'strong' | 'weak';  // computed from turn distance
  } | null;
  last_sweep_at_turn: number;   // for "20-turn safety sweep" trigger
}
```

Suggested storage: Redis or Supabase `chat_sessions` table with `state JSONB` column. Codex picks based on existing chat infra.

**Why not in ir_nodes**: anchor is a transient reading-context modifier that affects extraction prompts, not a property of any specific IR node. Multiple sessions can have different anchors on the same node.

---

## 4. IR Kind Definitions & Extraction Criteria [Owner: Lixian — Prompt] [Ref: Codex for enum check constraints]

每个 kind 包含三部分:**定义**、**正例**、**反例**。Lixian 的 prompt 直接基于此节内容编写。

### 4.1 `goal`
**定义**: 项目要达成的方向性目标,长期、抽象、跨多个 decision。
**正例**:
- "Zeno V1 要在 18 个月内验证到 L3"
- "让 solo founder 跨 model 保持 project truth"

**反例**:
- "希望产品做得好" (太模糊)
- "今天要把 bug 修了" (这是 task)

### 4.2 `constraint`
**定义**: 不可违反的边界条件。资源、时间、技术、原则、政策。
**正例**:
- "V1 不引入 Neo4j"
- "团队只有 3 人"
- "MCP 写入必须 candidate-only"

**反例**:
- "尽量不要引入 Neo4j" (偏好,非约束)
- "我比较喜欢 Postgres" (偏好)

### 4.3 `plan` (with subtype)

#### 4.3.1 `plan / decision`
**定义**: 在多个选项中收敛到的一个明确选择,影响后续工作。
**正例**:
- "V1 用 Vercel + Supabase 部署"
- "V1 不做 BYOK"

**反例**:
- "也许可以试 Vercel" (推测)
- "Vercel 是个选项" (列举,未决定)

#### 4.3.2 `plan / task`
**定义**: 具体的、可执行的工作项,通常关联到某个 decision。
**正例**:
- "实现 candidate confirm UI"
- "写 ir_nodes migration"

**反例**:
- "前端要好看" (非可执行)

#### 4.3.3 `plan / milestone`
**定义**: 标志性时间节点或交付物。
**正例**:
- "V1 launch 在 2026-10"
- "MCP server 端到端可用"

**反例**:
- "尽快上线" (无明确节点)

### 4.4 `hypothesis`
**定义**: 待验证的命题,形式为「如果 X 则 Y」或「我们假设 X」。
**正例**:
- "假设 solo founder 愿意为 cross-model continuity 付费"
- "如果 Re-entry Success Rate > 70%,substrate 可行"

**反例**:
- "我觉得他们会喜欢" (意见,非可验证命题)

### 4.5 `principle`
**定义**: 跨场景适用的设计/决策规则。通常是 iron law 类内容。
**正例**:
- "宁漏勿错"
- "Truth read-only, candidate-only write"

**反例**:
- "这次先这样做" (一次性决策,非原则)

### 4.6 `open_question`
**定义**: 明确被搁置、需要后续解决的问题。

**触发信号** (高优先级):
- "之后再讨论" / "later"
- "这个我还没想清楚" / "TBD"
- "先放着"

**正例**:
- "MCP 工具的 rate limit 怎么定?"
- "Pricing tier 的具体数字?"

**反例**:
- "你觉得 X 怎么样?" (即兴提问,AI 当 turn 已回答)

### 4.7 `rejection`
**定义**: 明确否决了之前讨论过的选项或方向。
**正例**:
- "决定不做 BYOK"
- "放弃 React Flow,改用 split panel"

**反例**:
- "BYOK 可能不太好" (倾向,非决定)

### 4.8 Why 7 kinds, not 8

V1 锁定 7 kinds。曾讨论加 `risk` 作为第 8 kind,但拒绝。理由:
- `risk` 在实际语料中通常是 `hypothesis`(对未来不确定状态的命题)或 `constraint`(决策规则)的修辞包装
- 加 risk 会增加 kind 边界 ambiguity,降低抽取器精度(7-way → 8-way classification 准确率系统性下降)
- V1 没有真实数据证明 risk 是独立语义类别;若 V1 真实数据显示大量 risk 内容被错误归到 hypothesis,V1.5 再加

---

## 5. Mechanism B: AI Inline Marker Protocol [Owner: Codex + Lixian — Prompt]

### 5.1 Marker Syntax [Owner: Codex — Frontend parser]

AI 在生成回复时,于主回复 markdown 中嵌入以下标记:

#### 5.1.1 IR Node Marker

无 subtype 的 kind:
```
[[ir:{kind}|{title}|{rationale}]]
```

带 subtype 的 kind (仅 plan):
```
[[ir:plan:{subtype}|{title}|{rationale}]]
```

`{rationale}` 可选;省略时形如 `[[ir:constraint|V1 不引入 Neo4j]]`。

#### 5.1.2 Relation Marker

```
[[rel:{relation}|{target_id}]]
```

紧跟在 IR marker 之后出现的 rel marker 关联到该 IR marker。例如:

```markdown
明白,那 V1 锁定平台 keys。[[ir:plan:decision|V1 不做 BYOK|降低 auth 复杂度]][[rel:resolves|Q3]][[rel:supersedes|D2]] 这意味着...
```

#### 5.1.3 Escaping

Title 和 rationale 内禁用 `|` 和 `]]`。如需出现,使用反斜杠转义:`\|` 和 `\]\]`。前端解析器需处理转义。

#### 5.1.4 Format Validation

```
- kind ∈ { goal, constraint, plan, hypothesis, principle, open_question, rejection }
  (NOTE: 'unclassified' is NOT allowed in inline markers — only via /save)
- subtype required iff kind = plan; subtype ∈ { decision, task, milestone }
- relation ∈ { supersedes, resolves, depends_on, implies, contradicts, refines }
- target_id must match existing node id format (regex: /^[A-Z]\d+$/)
- title length ≤ 200 chars after unescaping
- rationale length ≤ 1000 chars after unescaping
```

任何字段不合法 → marker 解析失败,按 section 11.1 处理。

### 5.2 System Prompt Injection (Lixian Owns) [Owner: Lixian — Prompt]

每次 AI 调用时,system prompt 末尾追加 IR Extraction Protocol。骨架如下,**精确措辞由 Lixian 调优**:

```markdown
## IR Extraction Protocol

When the conversation has just produced a semantically crystallized IR node 
that should become part of project truth, embed a candidate marker in your response.

### Marker Syntax
[Reproduce section 5.1 here, in user's primary language]

### When to Emit a Marker
Emit ONLY when ALL are true:
1. EXPLICIT — not implied or speculated
2. CONVERGED — user has agreed/decided, not still exploring
3. SCOPED — has clear boundaries, not vague
4. CONFIDENT — you would defend this as part of project truth

If unsure, DO NOT emit. Sweep extraction will catch it later.

### Existing Truth Context
[Inject current active truth as <truth_context> block, ≤ 2000 tokens, 
filtered to current topic where applicable]

### Reactivation Anchor (if set)
[If session has reactivation_anchor, inject:]
The user has loaded {anchor_id} ({anchor_title}) into context. 
When emitting markers in this session, prefer relations to {anchor_id} 
where semantically appropriate. If a candidate refines, contradicts, 
or supersedes {anchor_id}, emit the relation marker.

When emitting markers, reference existing nodes via [[rel:...]] when relations are obvious.

### Examples
[2-3 few-shot examples — Lixian to author]
```

**Token budget**: protocol injection should stay under 1500 tokens. If `<truth_context>` exceeds budget, prioritize: pending candidates → recent active decisions → constraints → other.

### 5.3 Frontend Parsing Flow [Owner: Codex]

```typescript
// After AI response stream completes:

interface CandidateDraft {
  kind: string;
  subtype?: string;
  title: string;
  rationale?: string;
  relations: { relation: string; target_id: string }[];
  position_in_content: number;  // for placeholder replacement
}

function parseIRMarkers(content: string): {
  candidateDrafts: CandidateDraft[];
  parseErrors: { rawMarker: string; reason: string }[];
} {
  // 1. Match all [[ir:...]] markers in order, capturing positions
  // 2. For each, look ahead for trailing [[rel:...]] markers 
  //    (consecutive, no text between)
  // 3. Validate per section 5.1.4
  // 4. Return drafts + errors (do not call API yet)
}

async function persistInlineCandidates(
  drafts: CandidateDraft[],
  ctx: { project_id, topic_id, source_chat_id, source_turn_id, reactivation_anchor_id? }
): Promise<{ rawContent: string, finalContent: string }> {
  // For each draft:
  //   POST /api/ir/draft with source_layer='inline' and reactivation_anchor_id from session
  //   → returns { id, status: 'pending', ... }
  // Replace marker text in content with <inline-ref id="D5" status="pending"/>
  // Return final content for chat_turns storage
}

// Critical: parse only AFTER stream completes. Mid-stream content may contain
// partial markers like "[[ir:plan:dec" that would parse wrong.
```

### 5.4 Persistence Flow [Owner: Codex]

```
1. AI response stream completes
2. Parser extracts markers + validates (section 5.3)
3. For each valid marker:
   POST /api/ir/draft with source_layer='inline'
     → returns { id, status: 'pending', relations: [...with impact info...] }
4. Replace markers in content with <inline-ref> placeholder tokens
5. Store final content in chat_turns.content (raw markers gone, only inline-ref tokens)
6. Frontend renders inline-ref tokens as blue clickable spans 
   (UI behavior in ir-ui-interaction.md)
```

**Storage note**: `chat_turns.content` stores the **post-parse** version (with `<inline-ref>` tokens). The original AI output (with `[[ir:...]]` markers) is stored in `chat_turns.raw_content` for telemetry/debug only.

**Inline marker confidence**: inline markers always go to `status='pending'`, never `status='idea'`. The model emits them only when high-confidence (per protocol section 5.2). There is no confidence score on inline markers; they are treated as max confidence by definition.

---

## 6. Mechanism C: Sweep Extraction Protocol [Owner: Codex + Lixian — Prompt]

### 6.1 Triggers (Revised from v1.1) [Owner: Codex]

```typescript
const SWEEP_TRIGGERS = {
  // Primary signals (always trigger)
  user_starts_new_idea: true,      // user clicks "Explore new idea" button — main trigger
  turn_count_safety_net: 20,       // turns since last completed sweep
  topic_switch: true,
  project_switch: true,
  manual_review_button: true,
  
  // MCP-specific (see section 9)
  agent_handoff_pre_read: true,    // blocking sweep before first MCP truth read in session
  
  // Secondary signals (degraded — only trigger if no primary signal in window)
  idle_timeout_ms: 60 * 60 * 1000, // 1 hour idle, fallback only
}
```

**"Last completed sweep" reference**: `last_sweep_at_turn` is updated when a sweep job *completes* (not when it starts). All triggers measure from this reference point. Failed/aborted sweeps do not advance the counter.

**Why turn count, not time, for safety net**: a user could be in deep multi-hour discussion mode where time-based triggers fire while the user is mid-thought (disruptive). Turn-based fires only after substantial new content exists.

**Concurrency**: only one sweep may run at a time per chat session. If a trigger fires during an in-flight sweep, the trigger is queued; on completion, queued triggers are coalesced into a single follow-up sweep if their unprocessed-turn ranges overlap.

**Non-blocking by default**: sweep runs async in background. UI should not block user typing. Exception: agent handoff (section 9) blocks the MCP read call only.

### 6.2 Sweep Process [Owner: Codex]

```
1. Determine unprocessed turn range:
   - Lower bound: last_sweep_at_turn + 1 (or session start if no prior sweep)
   - Upper bound: current latest turn
   - If range is empty, skip and notify trigger source

2. Chunk turns:
   - max 10 turns per chunk
   - max 4000 tokens per chunk (whichever hits first)
   - sliding window overlap: 1 turn (avoid boundary loss)

3. For each chunk, call extractor LLM with:
   - System: section 4 definitions + dual-output instructions
   - User: <conversation>{chunk}</conversation>
   - Context: current truth snapshot, reactivation_anchor if set
   - Output: JSON with two arrays — high-confidence + medium-confidence

4. Route results by confidence:
   - high_confidence  → POST /api/ir/draft with status='pending', source_layer='sweep'
   - medium_confidence → POST /api/ir/draft with status='idea', source_layer='sweep'
   - (low_confidence → discarded by extractor, never sent to API)

5. Update last_sweep_at_turn = upper_bound on success

6. Notify UI (frontend behavior in ir-ui-interaction.md)
```

### 6.3 Sweep Extractor Prompt (Lixian Owns) [Owner: Lixian — Prompt]

```markdown
You are reviewing a conversation segment for IR nodes that should become 
candidates for project truth. The user will review all output before any 
becomes active truth.

[Reproduce section 4 kind definitions]

For each potential IR you identify, classify it into one of two confidence tiers:

**high_confidence (→ pending candidate, prominent in user UI)**
The user has clearly committed to, accepted, rejected, prioritized, or 
stabilized this. You can defend this as project truth.

**medium_confidence (→ idea, secondary user UI)**
The conversation contains a potentially important direction, concern, weak 
preference, or unresolved possibility, but the user has NOT clearly 
committed. Worth surfacing but not requiring immediate action.

**discard (do not output)**
Brainstorming, temporary exploration, AI-only suggestions without user 
adoption, jokes, restatements, vague opinions without future decision force.

For each emitted item, you MUST also answer:
"If this item were missing from the project IR, what future decision, 
re-entry, or agent handoff would become worse?"

If you cannot answer this concretely, do not emit it.

[If reactivation_anchor is set:]
The user has loaded {anchor_id} ({anchor_title}) into the context.
For each item you emit, evaluate whether it relates to {anchor_id}.
Possible relations: refines, extends, contradicts, supersedes.
If unrelated, omit relation hint.

Output JSON:
{
  "high_confidence": [
    {
      "kind": "...",
      "subtype": "..." | null,
      "title": "...",
      "rationale": "..." | null,
      "source_turn_id": "uuid",
      "counterfactual": "...",  // required
      "relations": [
        { "relation": "supersedes", "to_node": "D2", "is_anchor_hint": false }
      ],
      "anchor_relation_hint": {  // only present if anchor set AND relation inferred
        "relation": "refines",
        "reason": "..."
      } | null
    }
  ],
  "medium_confidence": [
    // same shape as high_confidence
  ]
}

If nothing found, return { "high_confidence": [], "medium_confidence": [] }.
```

### 6.4 Why Sweep Has Two Output Tiers [Audience: All]

V1.1 had Layer 1 inline (precision-priority) + Layer 2 digest (recall-priority). v1.2 keeps both, but the digest (now called "sweep") splits its output into two tiers:

- High-confidence sweep results compete for the same UI prominence as inline candidates → both go to `pending`
- Medium-confidence results would overwhelm the candidate pool if all routed to `pending`. Routing them to `idea` keeps the main candidate flow clean while preserving Re-entry Success Rate signal ("漏 + 用户没意识到漏" defense).

User can promote idea → pending → active in two clicks. The friction is intentional: ideas should require explicit user attention before consuming review budget.

---

## 7. Mechanism A: User /save Channel [Owner: Codex + Lixian — Prompt for §7.4]

### 7.1 Trigger and Input [Owner: Codex]

User selects a span of text in chat (any role: user, AI, or system message) and invokes /save:

```typescript
interface SaveRequest {
  project_id: string;
  topic_id?: string;
  source_chat_id: string;
  source_turn_id: string;
  selected_text: string;          // exact span user selected
  selection_offset: number;       // char offset in turn for precise re-anchoring
  selection_length: number;
  user_kind_choice?: string;      // optional: user explicitly picked kind in UI
}
```

### 7.2 Flow [Owner: Codex]

```
1. User selects text and triggers /save (UI flow in ir-ui-interaction.md)
2. POST /api/ir/save 
   - If user_kind_choice provided:
     create ir_node with that kind, status='pending', source_layer='manual'
   - If user_kind_choice omitted:
     create ir_node with kind='unclassified', subtype=null, status='pending',
     source_layer='manual', id with U-prefix
3. If kind='unclassified':
   - Trigger async LLM kind suggestion job (see section 7.4)
   - When job completes, write suggestion to extraction_metadata
   - Frontend polls or subscribes; when suggestion arrives, prompt user:
     "Suggested kind: {kind}/{subtype}. Accept / Change / Skip"
   - If user accepts:
     - Server reissues node id with proper prefix (U7 → D12)
     - Old U7 logged in telemetry; never reused
4. User can confirm directly even while unclassified (rare, but allowed):
   - In that case, kind stays 'unclassified' on the active node
   - Practical impact: nodes with kind='unclassified' do not appear in any 
     "By Type" tree group; only visible in flat list / search
```

### 7.3 ID Reissue on Reclassification [Owner: Codex]

When `unclassified` (U-prefix) row is reclassified BEFORE confirmation:

```sql
BEGIN;
  -- Reserve new id under proper prefix
  -- (use nextId function from section 3.4)
  
  -- Update row id, kind, subtype atomically
  UPDATE ir_nodes 
    SET id = :new_id, kind = :kind, subtype = :subtype
    WHERE id = :old_u_id AND status = 'pending';
  
  -- Cascade update to ir_edges referencing old id
  UPDATE ir_edges SET from_node = :new_id WHERE from_node = :old_u_id;
  UPDATE ir_edges SET to_node = :new_id WHERE to_node = :old_u_id;
  
  -- Log telemetry
  INSERT INTO ir_extraction_events (event, metadata) 
    VALUES ('unclassified_reissued', '{"old_id":"...", "new_id":"...", "kind":"..."}');
COMMIT;
```

After confirmation, kind is locked. Reclassifying a confirmed `unclassified` node requires supersede flow.

### 7.4 LLM Kind Suggestion Prompt (Lixian Owns) [Owner: Lixian — Prompt]

Lightweight classifier, ≤ 500 tokens budget:

```markdown
Classify the following user-saved text into ONE of:
goal, constraint, plan/decision, plan/task, plan/milestone, 
hypothesis, principle, open_question, rejection.

Use kind definitions: [Reproduce section 4]

Text:
{selected_text}

Surrounding context (for disambiguation):
{2 turns before + 2 turns after, if available}

Output JSON only:
{
  "kind": "...",
  "subtype": "..." | null,
  "confidence": 0.0-1.0,
  "reasoning": "one sentence"
}

If confidence < 0.5, output:
{ "kind": null, "reasoning": "ambiguous between X and Y" }
```

If suggestion comes back with `kind: null`, frontend shows neutral "Pick a kind" UI without bias.

### 7.5 /save Confidence [Audience: All]

`/save` always creates `status='pending'` (never `idea`), regardless of kind classification confidence. The user's act of saving is the high-confidence signal — kind ambiguity does not downgrade it to idea.

---

## 8. Mechanism D: Reactivation Anchor [Owner: Codex + Lixian — Prompt for §8.2-8.3]

### 8.1 Setting and Clearing [Owner: Codex]

**Set**:
- User loads an IR's history into Sandbox via "Bring to sandbox" action on detail pane
- Server records: `chat_session.reactivation_anchor = { ir_id, set_at_turn: current_turn, strength: 'strong' }`

**Clear**:
- User clears Sandbox → anchor cleared
- User loads a different IR → anchor replaced (single-anchor V1)
- User explicitly cancels (UI affordance) → anchor cleared

**Strength decay**:
- `strength = 'strong'` while `(current_turn - set_at_turn) ≤ 20`
- `strength = 'weak'` when `(current_turn - set_at_turn) > 20`
- Weak anchors are still injected into prompts but with softer wording (see 8.3)
- No automatic full expiry in V1 (anchor persists until explicit clear / replace)

### 8.2 Effect on Inline Marker (Mechanism B) [Owner: Lixian — Prompt]

When AI generates a turn with anchor set, the IR Extraction Protocol injection includes:

```
The user has loaded {anchor_id} ({anchor_title}) into the active context.
This means future markers should preferentially establish relations to {anchor_id} 
when semantically appropriate.

If you emit a marker that:
  - refines or narrows {anchor_id} → emit [[rel:refines|{anchor_id}]]
  - replaces {anchor_id} → emit [[rel:supersedes|{anchor_id}]]
  - contradicts {anchor_id} → emit [[rel:contradicts|{anchor_id}]]
  - depends on {anchor_id} → emit [[rel:depends_on|{anchor_id}]]
  - is unrelated → DO NOT emit a relation just because anchor is set

Strength: {strong|weak}
[If weak:] The anchor is older; only emit relation if highly confident.
```

### 8.3 Effect on Sweep (Mechanism C) [Owner: Lixian — Prompt + Codex]

Sweep prompt receives anchor as additional context (see section 6.3 prompt template). Sweep extractor outputs `anchor_relation_hint` field on each candidate, which becomes a `pending` ir_edge with `is_anchor_hint=true`.

User reviews hints during candidate confirmation:
- Confirm candidate without changes → anchor hint becomes active edge
- Confirm with relation override → anchor hint discarded, user's choice prevails
- Dismiss candidate → anchor hint discarded with parent

### 8.4 Multi-anchor (Out of Scope) [Audience: All]

V1 supports single anchor only. Loading new IR replaces previous anchor. Multi-anchor (concurrent context from N IRs) is V2.

For "I want to discuss D17 and D42 together" use case in V1: user can `@D17 @D42` reference IDs in chat, which injects both into the immediate turn's context (one-shot, not session-wide). The AI handles relations to both via inline markers as usual; sweep treats only the session-wide single anchor.

---

## 9. Agent Handoff Coverage Check (MCP Boundary) [Owner: Codex]

This section addresses the failure mode "user invokes coding agent via MCP while Sandbox has unprocessed turns; agent reads stale truth and acts on incomplete judgment."

### 9.1 Trigger

When an MCP client (Claude Code, Cursor, Codex, etc.) calls any **read** tool against Zeno's MCP server, on the **first call within an MCP session**, the server checks coverage before returning truth.

MCP session boundary: same `mcp_session_token` across calls. New token = new session = re-trigger check.

### 9.2 Coverage Check Logic

```typescript
async function mcpCoverageCheck(
  project_id: string, 
  active_chat_session_id: string | null  // most recent user chat session in this project
): Promise<{ stale_turns: number; sweep_triggered: boolean }> {
  if (!active_chat_session_id) {
    return { stale_turns: 0, sweep_triggered: false };
  }
  
  const session = await getChatSessionState(active_chat_session_id);
  const latestTurn = await getLatestTurnIndex(active_chat_session_id);
  const stale_turns = latestTurn - session.last_sweep_at_turn;
  
  const STALE_THRESHOLD = 5;  // V1 default; tunable
  
  if (stale_turns > STALE_THRESHOLD) {
    await runBlockingSweep(active_chat_session_id);  // synchronous
    return { stale_turns, sweep_triggered: true };
  }
  
  return { stale_turns, sweep_triggered: false };
}
```

### 9.3 Behavior

- **stale_turns ≤ 5**: return truth immediately, no sweep, no delay (~50ms)
- **stale_turns > 5**: trigger blocking sweep, wait for completion (target: < 3s; hard timeout: 10s), then return truth including newly-created `pending` candidates

The MCP read tool's response ALWAYS includes a `coverage` field:

```json
{
  "truth": [...],            // active nodes
  "coverage": {
    "stale_turns": 12,
    "sweep_triggered": true,
    "sweep_completed_at": "2026-05-02T14:30:00Z",
    "new_pending_count": 3,
    "advisory": "3 new candidates were extracted from your recent conversation. They are pending your review in Zeno before they become truth."
  }
}
```

The advisory text is for the agent's own use (it can include in its response to the user, e.g., "Note: I see 3 new pending decisions in Zeno. You may want to review them before proceeding").

### 9.4 Why Block Only on First Call

The cost (1-3s delay) is paid once per MCP session, not per call. After the first call, subsequent calls in the same session return truth without check. This balances:
- **Trust**: agent never reads stale truth on session start
- **Performance**: long agent sessions don't suffer per-call overhead

If user keeps adding turns to Sandbox during a long MCP session, those turns will be picked up at next session start (or at next user-triggered sweep, e.g. clear/safety-net).

### 9.5 Never Auto-Confirm

Coverage check sweep produces `pending` (or `idea`) candidates. **It never auto-confirms any candidate.** The agent reads only `status='active'` truth, plus the `coverage` advisory describing what's pending. This preserves iron law #4.

### 9.6 Sweep Failure Handling

If blocking sweep fails (LLM error, timeout):
- Return truth with `coverage.sweep_triggered=true, coverage.sweep_failed=true`
- Include `coverage.advisory: "Sweep failed; returning best-effort truth. {N} unprocessed turns may contain new judgments."`
- Agent decides whether to proceed or ask user

This is intentional: blocking forever > stale truth, but failing gracefully > blocking forever.

---

## 10. Supersedes Detection [Owner: Codex]

`supersedes` 是改变现有 truth 状态的关系,必须特殊处理。

### 10.1 Detection Sources

```
A. AI explicitly emits [[rel:supersedes|D3]] in inline marker
   → trust, attach as pending edge

B. Sweep extractor detects "this contradicts/replaces existing D3"  
   → attach as pending edge (sweep prompt explicitly asks for this)

C. Reactivation anchor relation hint with relation='supersedes'
   → attach as pending edge with is_anchor_hint=true

D. User /save with explicit user-set supersedes target (rare; UI flow)
   → attach as pending edge

E. Heuristic check on every new pending candidate (V1.5, NOT V1):
   - Embedding similarity > 0.85 with existing active node of same kind+subtype
   - If found, flag as suspected_supersede in API response
```

V1 implements A, B, C, D. E requires embedding pipeline; defer to V1.5.

### 10.2 Confirmation Transaction

When user confirms a candidate D5 with `supersedes D2` relation:

```sql
BEGIN;
  -- Promote new node
  UPDATE ir_nodes 
    SET status='active', confirmed_at=now(), confirmed_by=:user_id
    WHERE id='D5' AND status IN ('pending', 'idea')
    RETURNING id;
  -- If no row affected → 409 Conflict, ROLLBACK

  -- Mark old node superseded
  UPDATE ir_nodes 
    SET status='superseded', superseded_at=now(), superseded_by='D5'
    WHERE id='D2' AND status='active'
    RETURNING id;
  -- If no row affected → D2 is no longer active; see section 11.6

  -- Promote relation edges
  UPDATE ir_edges 
    SET status='active', confirmed_at=now()
    WHERE from_node='D5' AND status='pending';
COMMIT;
```

If D2 is no longer active (already superseded by another concurrent confirm), see section 11.6.

---

## 11. API Contract (Codex Implements) [Owner: Codex]

> All endpoints require auth. All return `application/json`.

### 11.1 `POST /api/ir/draft`

Create candidate with `status='pending'` or `status='idea'`. Used by inline marker, sweep, MCP.

**Request:**
```json
{
  "kind": "plan",
  "subtype": "decision",
  "title": "V1 uses Vercel + Supabase",
  "rationale": "Zero DevOps overhead",
  "project_id": "uuid",
  "topic_id": "uuid",
  "source_chat_id": "uuid",
  "source_turn_id": "uuid",
  "source_layer": "inline",
  "created_by": "ai",
  "initial_status": "pending",
  "extraction_confidence": null,
  "reactivation_anchor_id": "D17",
  "relations": [
    { "relation": "supersedes", "to_node": "D3", "is_anchor_hint": false },
    { "relation": "depends_on", "to_node": "C2", "is_anchor_hint": false },
    { "relation": "refines", "to_node": "D17", "is_anchor_hint": true }
  ]
}
```

`initial_status` ∈ `{'pending', 'idea'}`. Sweep with medium confidence sets `'idea'`; all other layers set `'pending'`.

**Response 201:** as v1.1, plus `status` field reflecting `initial_status`.

**Errors:**
- `400` — invalid kind/subtype combination
- `400` — relation target_id does not exist in this project
- `400` — `initial_status='idea'` but `source_layer != 'sweep'` (only sweep can create idea)
- `409` — duplicate (same kind+subtype+normalized title within last 1 hour); response `merged_with`

### 11.2 `POST /api/ir/save`

User /save channel. Creates pending candidate, possibly with `kind='unclassified'`.

**Request:**
```json
{
  "project_id": "uuid",
  "topic_id": "uuid",
  "source_chat_id": "uuid",
  "source_turn_id": "uuid",
  "source_text_span": "selected text content",
  "user_kind_choice": null
}
```

`user_kind_choice`: omit/null = unclassified + trigger LLM suggestion. Set = use directly.

**Response 201:**
```json
{
  "id": "U7",
  "status": "pending",
  "kind": "unclassified",
  "subtype": null,
  "kind_suggestion_pending": true,
  "title": "selected text content (truncated to 200)",
  "created_at": "..."
}
```

When kind suggestion completes, it appears via Realtime on the row. Frontend subscribes via SWR / Supabase Realtime.

### 11.3 `POST /api/ir/{id}/reclassify`

Apply a kind suggestion (or user manual pick) to an `unclassified` pending node. Atomic: id reissue + kind/subtype update + edge cascade.

**Request:**
```json
{
  "kind": "plan",
  "subtype": "decision"
}
```

**Response 200:**
```json
{
  "old_id": "U7",
  "new_id": "D12",
  "status": "pending"
}
```

**Errors:**
- `400` — current kind is not `unclassified`
- `409` — node already confirmed (cannot reclassify after confirm; use supersede)

### 11.4 `POST /api/ir/{id}/promote`

Promote an `idea` to `pending`. Frontend calls this when user clicks "Promote to candidate".

**Request:** empty body
**Response 200:** `{ "id": "...", "status": "pending", "promoted_to_pending_at": "..." }`

**Errors:**
- `400` — node is not in `idea` status

### 11.5 `POST /api/ir/{id}/confirm`

Promote pending (or idea) candidate to active. Same as v1.1 with one addition: accepts confirm directly from `idea` status (skip-promote shortcut). UI may use this for power users.

**Request:** as v1.1
**Response 200:** as v1.1

### 11.6 `POST /api/ir/{id}/dismiss`

Reject pending or idea candidate. Same as v1.1.

### 11.7 `POST /api/ir/{id}/supersede`

User-initiated supersede. Same as v1.1.

### 11.8 `GET /api/ir/{id}`

Get full node detail. Same as v1.1, with added field `reactivation_anchor_id` if present.

### 11.9 `GET /api/ir`

List nodes with filters. Same as v1.1, with two changes:
- `status` filter accepts `idea` value
- **Default behavior unchanged**: if no `status` param given, returns `status=active` only. (Idea/pending must be explicitly requested.)

### 11.10 MCP Read Tools (Out of Scope for This Doc)

MCP tool surface is defined separately. This doc covers only the coverage check behavior in section 9. MCP read tools internally call the same query layer as `GET /api/ir` with hard-coded `status='active'` filter (iron law #1).

### 11.11 `POST /api/sweep/manual`

Trigger a sweep on demand. Used by "Review session" button and MCP coverage check.

**Request:**
```json
{
  "project_id": "uuid",
  "chat_session_id": "uuid",
  "blocking": false  // true for MCP coverage check
}
```

**Response 200 (non-blocking):**
```json
{ "sweep_id": "uuid", "status": "queued" }
```

**Response 200 (blocking):**
```json
{
  "sweep_id": "uuid",
  "status": "completed",
  "candidates_created": 3,
  "ideas_created": 1,
  "duration_ms": 2400
}
```

**Errors:**
- `409` — sweep already in progress for this session (returns existing sweep_id)
- `408` — blocking sweep exceeded 10s timeout

---

## 12. Edge Cases & Error Handling [Owner: Codex]

### 12.1 Marker Parse Failure

Same as v1.1. (No changes.)

### 12.2 Duplicate Pending Candidates

Same as v1.1. Cross-mechanism dedup: same project + same kind+subtype + title sim > 0.9 within 1 hour, regardless of source_layer.

### 12.3 Stream Interruption

Same as v1.1.

### 12.4 User Edits Past AI Response

V1: not supported. (Same as v1.1.)

### 12.5 Concurrent Confirm

Same as v1.1.

### 12.6 Supersede Target Already Superseded

Same as v1.1.

### 12.7 Anchor on Deleted/Dismissed IR

If `reactivation_anchor_id` points to a node that becomes `dismissed` (rare; only happens if user confirmed an `idea` then dismissed?) or fully deleted:
- On next prompt build, anchor is silently dropped from injection
- Session state cleared on next session refresh
- User-visible UI in ir-ui-interaction.md shows "Anchor cleared (target removed)"

### 12.8 /save on Empty Selection

Reject at API: `400 — selection_length must be > 0`.

### 12.9 Sweep While Anchor is Active

Sweep extractor sees anchor in prompt and may emit `anchor_relation_hint` on candidates. If the anchor's IR is itself superseded mid-sweep (rare race), the resulting hint edges resolve normally during user confirmation; if user accepts the hint, the edge points to a superseded node and is preserved (history is immutable).

---

## 13. Versioning Model: Git-Style Immutable History [Audience: All]

### 13.1 No `product_version` Field

Same as v1.1 section 10. (No changes.)

### 13.2 Time-Travel Query Pattern

Same as v1.1. Idea status nodes are filtered out of all time-travel queries by default (they were never truth).

### 13.3 V1.5 Forward-Compat: `ir_releases` Table

Same as v1.1.

### 13.4 V1 Implementation Constraints

Same as v1.1, plus:
- **DO** ensure `idea` status nodes are excluded from `GET /api/ir` default response and from MCP read tools
- **DO** preserve `promoted_to_pending_at` timestamp for auditing the idea → pending → active path

---

## 14. Telemetry & Observability [Owner: Codex]

Extended from v1.1 with new event types:

```typescript
type IRExtractionEvent = {
  event: 
    | 'marker_emitted'           // AI output an inline marker
    | 'marker_parsed'
    | 'marker_parse_failed'
    | 'candidate_created'        // any source: inline, sweep, save, mcp
    | 'idea_created'             // sweep medium-confidence output
    | 'idea_promoted'            // user clicked promote
    | 'candidate_confirmed'
    | 'candidate_dismissed'
    | 'sweep_triggered'
    | 'sweep_completed'
    | 'sweep_failed'
    | 'save_invoked'             // user /save action
    | 'unclassified_reissued'    // U-id replaced with proper prefix
    | 'anchor_set'
    | 'anchor_cleared'
    | 'anchor_hint_accepted'     // user kept anchor relation hint on confirm
    | 'anchor_hint_overridden'   // user changed/removed anchor hint
    | 'mcp_coverage_check'
    | 'mcp_coverage_sweep_blocked'
    | 'supersede_invalidated',
  
  layer: 'inline' | 'sweep' | 'manual' | 'mcp' | 'system',
  project_id: string,
  candidate_id?: string,
  kind?: string,
  subtype?: string,
  
  conversation_length_turns?: number,
  token_count?: number,
  latency_ms?: number,
  raw_marker?: string,
  metadata?: object,            // freeform per-event payload
  
  timestamp: string,
}
```

**Key V1 metrics (Sean / Lixian track from week 1):**

Primary indicators:
- **Re-entry Success Rate (north star)**: tracked outside this doc; measured via user surveys + behavior
- **Trust Violation Rate (red line)**: confirmed nodes later superseded within 24h / total confirmed; target < 5%

Secondary indicators (per mechanism):
- **Inline precision**: confirmed_inline / (confirmed_inline + dismissed_inline); target ≥ 80%
- **Sweep recall (proxy)**: 1 - (sweep_catches_after_clear / total_confirms_in_session); target unknown, baseline only
- **Idea promotion rate**: idea_promoted / idea_created; observe — if very low, ideas are noise; if very high, threshold too conservative
- **/save adoption**: save_invoked / total_user_messages; observe to decide V1.x prioritization
- **MCP coverage check rate**: mcp_coverage_sweep_blocked / mcp_coverage_check; observe — high rate means users handing off without clearing
- **Anchor hint accuracy**: anchor_hint_accepted / (accepted + overridden); target ≥ 60%
- **Marker parse failure rate**: < 2%
- **Supersede invalidation rate**: track for surprise

Telemetry sink: Supabase table `ir_extraction_events` (schema in **Appendix B**).

---

## 15. Implementation Checklist [Audience: All — task split inside]

### 15.1 Supabase Migrations [Owner: Supabase Runner]

> Run via `supabase db push` from local dev. Order matters.

- [ ] `20260502000001_ir_nodes_and_edges.sql` — tables + indexes (section 3.1, 3.2)
- [ ] `20260502000002_ir_status_triggers.sql` — status transition triggers (Appendix A)
- [ ] `20260502000003_ir_telemetry.sql` — telemetry events table (Appendix B)
- [ ] `20260502000004_ir_session_state.sql` — chat session state (anchor + last_sweep_at_turn) — see section 3.5
- [ ] `20260502000005_ir_rls.sql` — row-level security policies (section 15.7)

### 15.2 Codex Tasks — Phase 1: Core API Layer (Sprint 1) [Owner: Codex]

- [ ] `POST /api/ir/draft` (section 11.1) — supports `initial_status` field
- [ ] `POST /api/ir/save` (section 11.2)
- [ ] `POST /api/ir/{id}/reclassify` (section 11.3) — atomic id reissue
- [ ] `POST /api/ir/{id}/promote` (section 11.4)
- [ ] `POST /api/ir/{id}/confirm` (section 11.5) — accepts pending OR idea
- [ ] `POST /api/ir/{id}/dismiss` (section 11.6)
- [ ] `POST /api/ir/{id}/supersede` (section 11.7)
- [ ] `GET /api/ir/{id}` (section 11.8)
- [ ] `GET /api/ir` (section 11.9) — supports `status=idea` filter
- [ ] `POST /api/sweep/manual` (section 11.11) — supports blocking mode
- [ ] ID generation logic per kind+subtype (section 3.4)
- [ ] U-prefix unclassified handling
- [ ] Concurrent confirm 409 handling (section 12.5)
- [ ] MCP write constraint: reject `status != 'pending'` from MCP source
- [ ] Unit tests for each status transition rule

### 15.3 Codex Tasks — Phase 2: Mechanism B (Inline Marker) (Sprint 2) [Owner: Codex]

- [ ] Marker parser with escape handling (section 5.1.3, 5.3)
- [ ] Stream completion hook → trigger parser (section 5.4)
- [ ] System prompt injection mechanism (section 5.2)
- [ ] Truth context retrieval & token-budget filtering (section 5.2)
- [ ] Reactivation anchor injection in prompt (section 5.2)
- [ ] `<inline-ref>` placeholder token in `chat_turns.content` storage
- [ ] Add `chat_turns.raw_content` column for original AI output
- [ ] Telemetry: `marker_emitted`, `marker_parsed`, `marker_parse_failed`

### 15.4 Codex Tasks — Phase 3: Mechanism C (Sweep) (Sprint 2) [Owner: Codex]

- [ ] Turn counter per chat session: `last_sweep_at_turn`
- [ ] Sweep trigger: 'Explore new idea' button (primary)
- [ ] Sweep trigger: 20-turn safety net
- [ ] Sweep trigger: topic/project switch
- [ ] Sweep trigger: manual review button
- [ ] Sweep trigger: 1h idle (degraded)
- [ ] Sweep worker: chunking, prompt assembly, two-tier output routing (section 6.2)
- [ ] Sweep concurrency control (one per session, queue + coalesce)
- [ ] Telemetry: `sweep_triggered`, `sweep_completed`, `sweep_failed`, `idea_created`

### 15.5 Codex Tasks — Phase 4: Mechanism A (/save) (Sprint 2) [Owner: Codex + Lixian for kind-suggestion prompt]

- [ ] /save API endpoint (already in 15.2; this is end-to-end)
- [ ] Async LLM kind suggestion worker
- [ ] Realtime push of suggestion to frontend
- [ ] Reclassify endpoint integration with id reissue cascade
- [ ] Telemetry: `save_invoked`, `unclassified_reissued`

### 15.6 Codex Tasks — Phase 5: Mechanism D (Anchor) + Section 9 (MCP Coverage) (Sprint 3) [Owner: Codex]

- [ ] Chat session state schema + accessor (section 3.5)
- [ ] Anchor set/clear API + hooks
- [ ] Anchor injection in inline prompt + sweep prompt
- [ ] Anchor strength decay logic
- [ ] MCP coverage check middleware on first read per session
- [ ] Blocking sweep with 10s timeout
- [ ] `coverage` field in MCP read tool responses
- [ ] Telemetry: `anchor_set/cleared/hint_accepted/hint_overridden`, `mcp_coverage_check`, `mcp_coverage_sweep_blocked`

### 15.7 Codex Tasks — Phase 6: Hardening (Sprint 4) [Owner: Codex]

- [ ] Duplicate detection across all source layers (section 12.2)
- [ ] Stream interruption handling (section 12.3)
- [ ] Supersede invalidation flow (section 12.6)
- [ ] Anchor on deleted IR cleanup (section 12.7)
- [ ] Sweep while anchor active race handling (section 12.9)
- [ ] Telemetry dashboard (Supabase view + simple metrics page)

### 15.8 RLS Policies (Supabase) [Owner: Supabase Runner]

```sql
ALTER TABLE ir_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ir_edges ENABLE ROW LEVEL SECURITY;

-- Read: only nodes in projects user owns
CREATE POLICY ir_nodes_select ON ir_nodes
  FOR SELECT USING (
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
  );

CREATE POLICY ir_nodes_insert ON ir_nodes
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
  );

-- Updates ONLY via service role (API layer enforces transitions)
-- User role cannot UPDATE directly — this prevents bypassing iron law #4

CREATE POLICY ir_edges_select ON ir_edges
  FOR SELECT USING (
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
  );

CREATE POLICY ir_edges_insert ON ir_edges
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
  );
```

### 15.9 Out of Scope for V1 [Audience: All]

- Embedding-based supersede heuristic (section 10.1.E) → V1.5
- Salience Gate (turn-level second-pass extraction) → V1.5, conditional on V1 data
- Multi-anchor support → V2
- Auto-rerun sweep on edited responses → V1.5+
- Direct edit of active nodes → never (iron law #4)
- Multi-user concurrent editing locks → V2-B (team product)
- `vault` sensitivity UI → V1.5 (column exists but no UI in V1)
- `ir_releases` table and version UI → V1.5
- Coverage Bar persistent UI → not doing (Sean decision: pool count + safety sweep covers it)
- 8th kind `risk` → not doing (see section 4.8)

---

## 16. Open Questions for Lixian [Owner: Lixian — Prompt]

以下问题需要 Lixian 在 prompt 实现阶段决定:

1. **Single-pass multi-kind vs multi-pass single-kind extraction in sweep**: V1 起步用 single-pass multi-kind(便宜、快、整体性好);ablation 后再考虑容易混淆的 kind 做 targeted second pass。需要在真实数据上验证 7-way 单次抽取的精度。

2. **Bilingual (中英混杂) sweep stability**: Sean 的 session 是双语切换的。现有 IR 抽取的论文/产品基本都是单语训练。需要早期采集 10-20 段真实对话作为 ablation 数据集。

3. **Idea/pending confidence boundary**: prompt 给定性描述(参见 section 6.3),不写数字阈值。Lixian 在真实数据上观察分布后,如果发现 idea 区严重偏多或偏少,调整 prompt 的描述措辞。

4. **Anchor hint emission rate**: 当 anchor set 时,sweep 会过度生成 anchor relation hints 吗?需要观察 anchor_hint_overridden 比例,若 > 40% 说明 prompt 太激进。

5. **/save kind suggestion accuracy**: lightweight classifier 在中英混杂、短文本上的精度。如果低于 60%,考虑给用户更激进的 "skip/pick" UI 引导。

6. **Counterfactual field strictness**: section 6.3 prompt 强制 candidate 输出 `counterfactual` 字段。Lixian 需在 prompt tuning 时确认模型不会"敷衍"这个字段(写空话);可能需要 few-shot 示范。

---

## Appendix A: Status Transition Trigger SQL [Owner: Supabase Runner]

> File: `supabase/migrations/20260502000002_ir_status_triggers.sql`

```sql
CREATE OR REPLACE FUNCTION enforce_ir_node_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow specific transitions
  IF OLD.status = 'idea' AND NEW.status IN ('pending', 'dismissed') THEN
    IF NEW.status = 'pending' AND NEW.promoted_to_pending_at IS NULL THEN
      NEW.promoted_to_pending_at := now();
    END IF;
    RETURN NEW;
  END IF;
  
  IF OLD.status = 'pending' AND NEW.status IN ('active', 'dismissed') THEN
    RETURN NEW;
  END IF;
  
  -- Allow direct idea → active (skip-promote shortcut)
  IF OLD.status = 'idea' AND NEW.status = 'active' THEN
    IF NEW.promoted_to_pending_at IS NULL THEN
      NEW.promoted_to_pending_at := now();
    END IF;
    IF NEW.confirmed_at IS NULL THEN
      NEW.confirmed_at := now();
    END IF;
    RETURN NEW;
  END IF;
  
  IF OLD.status = 'active' AND NEW.status = 'superseded' THEN
    IF NEW.superseded_by IS NULL THEN
      RAISE EXCEPTION 'superseded status requires superseded_by';
    END IF;
    IF NEW.superseded_at IS NULL THEN
      NEW.superseded_at := now();
    END IF;
    RETURN NEW;
  END IF;
  
  -- Block all other status transitions
  IF OLD.status != NEW.status THEN
    RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status;
  END IF;
  
  -- Block content edits on active nodes
  IF OLD.status = 'active' AND (
    OLD.title != NEW.title 
    OR COALESCE(OLD.content, '') != COALESCE(NEW.content, '')
    OR COALESCE(OLD.rationale, '') != COALESCE(NEW.rationale, '')
    OR OLD.kind != NEW.kind
    OR COALESCE(OLD.subtype, '') != COALESCE(NEW.subtype, '')
  ) THEN
    RAISE EXCEPTION 'Cannot edit active node content; use supersede instead';
  END IF;
  
  -- Block kind changes on confirmed nodes (kind locked at confirm)
  IF OLD.status = 'active' AND OLD.kind = 'unclassified' AND NEW.kind != 'unclassified' THEN
    RAISE EXCEPTION 'Cannot reclassify confirmed unclassified node; use supersede';
  END IF;
  
  -- Allow kind reclassification on pending unclassified nodes
  IF OLD.status = 'pending' AND OLD.kind = 'unclassified' AND NEW.kind != 'unclassified' THEN
    -- ID reissue handled separately in API layer; this trigger only validates
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ir_node_status_transition
  BEFORE UPDATE ON ir_nodes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ir_node_status_transition();

-- ir_edges trigger (unchanged from v1.1)
CREATE OR REPLACE FUNCTION enforce_ir_edge_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('active', 'dismissed') THEN
    IF NEW.status = 'active' AND NEW.confirmed_at IS NULL THEN
      NEW.confirmed_at := now();
    END IF;
    RETURN NEW;
  END IF;
  
  IF OLD.status != NEW.status THEN
    RAISE EXCEPTION 'Invalid edge status transition: % → %', OLD.status, NEW.status;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ir_edge_status_transition
  BEFORE UPDATE ON ir_edges
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ir_edge_status_transition();
```

## Appendix B: Telemetry Table [Owner: Supabase Runner]

> File: `supabase/migrations/20260502000003_ir_telemetry.sql`

```sql
CREATE TABLE ir_extraction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  layer TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  candidate_id TEXT REFERENCES ir_nodes(id) ON DELETE SET NULL,
  kind TEXT,
  subtype TEXT,
  
  conversation_length_turns INTEGER,
  token_count INTEGER,
  latency_ms INTEGER,
  raw_marker TEXT,
  
  metadata JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_telemetry_event_time 
  ON ir_extraction_events(event, created_at DESC);
CREATE INDEX idx_telemetry_project 
  ON ir_extraction_events(project_id, created_at DESC);

-- No RLS on telemetry — service role writes only, owner reads via API
```

## Appendix C: Decision Log [Audience: All]

| Decision | V1 choice | Why |
|----------|-----------|-----|
| Single table vs split candidate/truth | Single `ir_nodes` + `status` field | No data migration on confirm; preserves audit trail |
| Number of IR kinds | 7 (no `risk`) | risk reduces to hypothesis or constraint in real corpora; adding 8th kind hurts classifier precision; revisit V1.5 if data shows otherwise |
| Marker syntax | `[[ir:kind:subtype\|title\|rationale]]` | Double brackets uncommon in markdown; pipe is simple delimiter |
| Sweep primary trigger | User clicks 'Explore new idea' | Strongest user signal ("this discussion is done") |
| Sweep safety net | 20 turns since last sweep | Defends against "user聊 40 轮没清空" failure mode |
| Status funnel | idea → pending → active | Two-tier sweep output; idea is mid-confidence holding zone |
| /save kind handling | Default unclassified + LLM suggestion | Zero-friction save; user can refine kind later |
| Reactivation anchor | Single anchor, decay at 20 turns | Reduces relation extraction from open problem to classification |
| MCP coverage check | Block on first read of session, > 5 stale turns | Trust > performance at handoff moment; cost paid once per session |
| Plan subtype | Add `subtype` column for kind=plan only | Keeps 7 kinds locked while supporting D/T/M UI prefixes |
| Versioning | Git-style immutable history; no version field | Schema already supports time-travel via timestamps |
| Edit active nodes | Forbidden, use supersede | Iron law #4 enforcement at DB layer |
| Embedding supersede detection | V1.5 | Requires embedding pipeline not in V1 |
| Salience Gate (turn-level) | Not in V1 | Inline marker covers high-precision real-time path; sweep + safety net covers recall path; Salience Gate adds independent LLM cost without proven value |
| Coverage Bar UI | Not in V1 | Pool count badge + 20-turn safety sweep cover the same need at lower complexity |
| North star indicator | Re-entry Success Rate | Direct user value proxy; Trust Violation Rate is red-line constraint, not replacement |

---

**End of Spec**
