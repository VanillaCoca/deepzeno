import type {
  IRKind,
  IRPlanSubtype,
  IRRelation,
  IRSourceLayer,
} from "@/lib/ir/types";

// Content for the two official example projects seeded into every new user's
// Library (see docs/superpowers/specs/2026-07-07-example-projects-seeding-design.md).
// This file is pure data — the seeding mechanics live in ./example-projects.ts.
//
// Rendering constraints baked into the shape here:
//   - The truth graph is topic-scoped and edges only render when BOTH endpoints
//     are in the same topic, so every edge below stays inside one topic.
//   - Only depends_on / refines / resolves / implies draw as flow edges, so we
//     express judgment with rejection nodes + a candidate that `resolves` an
//     open question, never with supersedes/contradicts.

export type ExampleNodeStatus = "active" | "pending";

export type ExampleNode = {
  // Local key, unique within the project, referenced by edges below.
  key: string;
  kind: IRKind;
  subtype?: IRPlanSubtype;
  status: ExampleNodeStatus;
  title: string;
  rationale: string;
  // Override the default source layer (active→manual, pending→sweep) —
  // e.g. "research" for candidates the research agent proposed.
  sourceLayer?: IRSourceLayer;
  // Index into the topic's `conversation` of the turn this judgment was
  // distilled from. Seeds ir_nodes.source_turn_id / source_chat_id, so the
  // node carries a real provenance trail back to the exchange that produced
  // it — the same fields the live inline-marker path writes.
  sourceTurnIndex?: number;
  // Verbatim slice of that turn (ir_nodes.source_text_span).
  sourceSpan?: string;
};

// One turn of a seeded sandbox conversation. `{{ref:nodeKey}}` placeholders
// are replaced at seed time with `<inline-ref id="D5"/>`, which the chat
// renders as a clickable chip — the visible trace of "this judgment was
// settled into the truth graph".
//
// A turn containing a ref is NOT rendered as markdown (the inline-ref path
// splits the text and renders segments as plain spans), so keep those turns
// plainly worded; put rich formatting in turns without refs.
export type ExampleConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type ExampleEdge = {
  from: string;
  relation: IRRelation;
  to: string;
  // AI-written free-form description of the link (ir_edges.label) — shown on
  // the quiet dependency edges and the reasoning chain.
  label?: string;
};

export type ExampleTopic = {
  key: string;
  label: string;
  isGeneral?: boolean;
  nodes: ExampleNode[];
  edges: ExampleEdge[];
  // Multi-turn sandbox exchange seeded into this topic's conversation, so the
  // example shows the discussion the graph came out of — not just its result.
  conversation?: ExampleConversationTurn[];
};

// Pre-baked research/watchtower artifacts so a new user's first open shows
// the agent's proactivity (evidence + an active watch + a patrol alert)
// without spending tokens at signup. Quotes/claims are demo content; the
// welcome message discloses that.
export type ExampleEvidence = {
  url: string;
  title: string;
  quote: string;
  claim: string;
  stance: "supports" | "contradicts" | "neutral";
};

export type ExampleResearchRun = {
  type: "research" | "patrol";
  plan: Array<{ query: string; goal: string }>;
  brief: string;
  evidence: ExampleEvidence[];
};

export type ExampleResearch = {
  // Key of the node the runs/watch/alert anchor to.
  nodeKey: string;
  runs: ExampleResearchRun[];
  watch?: {
    cadence: "daily" | "every_3_days" | "weekly";
    reason: string;
    // Angles the agent proposes for its next visit (ir_watches.next_directions),
    // shown on the exploration board.
    nextDirections?: Array<{ query: string; goal: string }>;
  };
  // Watchtower alert candidate (pending open_question, sourceLayer
  // "watchtower", contradicts edge to the watched node). Seeded separately
  // from the main node batch so a pre-watchtower-migration database still
  // seeds the rest of the project.
  alert?: {
    title: string;
    rationale: string;
    edgeLabel: string;
  };
};

export type ExampleProject = {
  // Stable slug for logging/telemetry.
  slug: string;
  name: string;
  // Alternate name for the "personal" variant — the same graph seeded as a
  // real working project (no ✦ prefix, no official welcome message).
  personalName?: string;
  // Key of the topic whose conversation receives the welcome message.
  welcomeTopicKey: string;
  welcome: string;
  topics: ExampleTopic[];
  research?: ExampleResearch[];
};

const EN_WELCOME = [
  '👋 This is an official **Deepzeno example** — you\'re looking at how a two-person founding team reasoned through taking a B2B analytics product ("Beacon") to market.',
  "",
  "Deepzeno turns messy thinking into a **truth graph**: goals, constraints, hypotheses, the decisions you've locked in, and the options you deliberately rejected — each with its reasoning, and wired to what it depends on.",
  "",
  "**Try it in 30 seconds:**",
  "1. Open the **Positioning & Motion** topic on the left — that's the core decision.",
  "2. In the graph, switch **Truth → All**. The gray nodes are **candidates**: things the AI proposed but nobody has confirmed yet.",
  "3. Click the candidate **“Target ops leaders as the beachhead ICP”** and **Confirm** it — it answers the open question *“Who is the beachhead ICP?”* and turns into truth.",
  "4. Browse **Pricing & Packaging** and **Launch Plan** for the rest of the decision.",
  "",
  "When you're ready, hit **New project** (top right) to start your own.",
  "— The Deepzeno team",
].join("\n");

const ZH_WELCOME = [
  "👋 这是一个 **Deepzeno 官方示例** —— 你看到的是一个家庭如何一步步想清楚「要不要离开一线、回新一线城市定居买房」。",
  "",
  "Deepzeno 把纷乱的思考整理成一张**真相图**：目标、约束、假设、你已经拍板的决策，以及被你明确排除的选项 —— 每一项都带着背后的理由，并连到它所依赖的前提。",
  "",
  "**30 秒上手：**",
  "1. 点左边的**决策主线**主题 —— 那是这个决定的核心。",
  "2. 在图上把 **Truth 切到 All**。灰色的是**候选**：AI 提出、但还没人确认的想法。",
  "3. 点候选**「先在杭州租住 6 个月过渡」**，点**确认** —— 它会解答一个开放问题，并变成真相。",
  "4. 再去**职业发展**、**生活与家庭**看这个决定的其余部分。",
  "",
  "想好了，就点右上角的**新建项目**，开始你自己的决策。",
  "—— Deepzeno 团队",
].join("\n");

const ENGLISH_EXAMPLE: ExampleProject = {
  slug: "en-gtm-saas",
  name: "✦ Deepzeno Example · Go-to-Market for a SaaS",
  welcomeTopicKey: "start",
  welcome: EN_WELCOME,
  topics: [
    {
      key: "start",
      label: "Start here",
      isGeneral: true,
      nodes: [],
      edges: [],
    },
    {
      key: "motion",
      label: "Positioning & Motion",
      nodes: [
        {
          key: "goal",
          kind: "goal",
          status: "active",
          title: "Reach $1M ARR within 18 months of launch",
          rationale:
            "A concrete revenue target forces every positioning and pricing choice to be judged on speed-to-revenue, not vanity metrics.",
        },
        {
          key: "runway",
          kind: "constraint",
          status: "active",
          title: "20-month runway — no time for a long enterprise sales cycle",
          rationale:
            "With 20 months of cash and no new raise assumed, any motion that takes 6–9 months to close its first deals is disqualified.",
        },
        {
          key: "team",
          kind: "constraint",
          status: "active",
          title: "Two founders, no dedicated sales hire yet",
          rationale:
            "Neither founder is a full-time seller, so the go-to-market motion has to work without a staffed sales team on day one.",
        },
        {
          key: "plg-hyp",
          kind: "hypothesis",
          status: "active",
          title:
            "Self-serve product-led growth converts our SMB users faster than sales-led outreach",
          rationale:
            "SMB buyers can adopt without procurement; a free trial lets the product sell itself and shortens time-to-first-value.",
        },
        {
          key: "plg-decision",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "Go product-led: 14-day free trial with self-serve checkout",
          rationale:
            "Fits the runway and the two-person team — the product does the selling while we focus on activation, not pipeline.",
        },
        {
          key: "reject-outbound",
          kind: "rejection",
          status: "active",
          title: "Rejected: outbound sales-led motion with an SDR team",
          rationale:
            "A staffed outbound motion would burn the runway before the first cohort of deals closed, and two people can't staff it. Explicitly ruled out.",
        },
        {
          key: "ttfv",
          kind: "principle",
          status: "active",
          title: "Optimize for time-to-first-value over feature breadth",
          rationale:
            "Every roadmap and onboarding choice is judged by how fast a new team reaches its first real insight.",
        },
        {
          key: "icp-q",
          kind: "open_question",
          status: "active",
          title:
            "Who is the beachhead ICP — ops leaders or engineering managers?",
          rationale:
            "The two audiences want different onboarding, pricing, and messaging; picking one concentrates the launch.",
        },
        {
          key: "icp-candidate",
          kind: "plan",
          subtype: "decision",
          status: "pending",
          title:
            "Target ops leaders at 20–200 person companies as the beachhead",
          rationale:
            "Ops leaders feel the analytics pain first and refer laterally — a candidate to confirm once we've validated the motion.",
        },
      ],
      edges: [
        { from: "plg-hyp", relation: "depends_on", to: "goal" },
        { from: "plg-decision", relation: "refines", to: "plg-hyp" },
        { from: "plg-decision", relation: "depends_on", to: "runway" },
        { from: "plg-decision", relation: "depends_on", to: "team" },
        { from: "reject-outbound", relation: "depends_on", to: "runway" },
        { from: "ttfv", relation: "depends_on", to: "goal" },
        { from: "icp-candidate", relation: "resolves", to: "icp-q" },
        { from: "icp-candidate", relation: "depends_on", to: "plg-hyp" },
      ],
    },
    {
      key: "pricing",
      label: "Pricing & Packaging",
      nodes: [
        {
          key: "entry-price",
          kind: "constraint",
          status: "active",
          title:
            "Entry price must clear a self-serve, credit-card threshold (under $50/mo to start)",
          rationale:
            "Above that, buyers need approval and the self-serve motion stalls — the price ceiling protects the whole PLG plan.",
        },
        {
          key: "metric-q",
          kind: "open_question",
          status: "active",
          title: "Price per seat or per active workspace?",
          rationale:
            "Per-seat is familiar but penalizes team growth; per-workspace aligns with value but is harder to forecast.",
        },
        {
          key: "workspace-price",
          kind: "plan",
          subtype: "decision",
          status: "pending",
          title: "Price per active workspace, not per seat",
          rationale:
            "Aligns price with value delivered and stops punishing teams for adding members — a candidate pending forecast validation.",
        },
        {
          key: "addon-hyp",
          kind: "hypothesis",
          status: "active",
          title:
            "A usage-based add-on lifts expansion revenue without raising the entry price",
          rationale:
            "Charging for advanced usage on top of the base workspace price grows net revenue retention while keeping entry cheap.",
        },
        {
          key: "reject-annual",
          kind: "rejection",
          status: "active",
          title: "Rejected: annual-only billing at launch",
          rationale:
            "Annual-only raises trial-to-paid friction for card-paying SMBs; start monthly, add annual once retention is proven.",
        },
        {
          key: "checkout",
          kind: "plan",
          subtype: "task",
          status: "active",
          title: "Ship self-serve Stripe checkout with monthly billing",
          rationale:
            "Card-based monthly checkout is what keeps the entry price under the self-serve threshold in practice.",
        },
      ],
      edges: [
        { from: "workspace-price", relation: "resolves", to: "metric-q" },
        { from: "workspace-price", relation: "depends_on", to: "entry-price" },
        { from: "addon-hyp", relation: "refines", to: "workspace-price" },
        { from: "reject-annual", relation: "depends_on", to: "entry-price" },
        { from: "checkout", relation: "depends_on", to: "entry-price" },
      ],
    },
    {
      key: "launch",
      label: "Launch Plan",
      nodes: [
        {
          key: "vertical",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "Launch in one vertical (RevOps) first, expand later",
          rationale:
            "A single vertical sharpens messaging and references; horizontal launches dilute both while runway is tight.",
        },
        {
          key: "recruit",
          kind: "plan",
          subtype: "task",
          status: "active",
          title: "Recruit 25 design partners from founder communities",
          rationale:
            "Design partners give the activation data the PLG bet depends on before any public launch.",
        },
        {
          key: "beta",
          kind: "plan",
          subtype: "milestone",
          status: "active",
          title: "Private beta with 25 design-partner teams",
          rationale:
            "The beta is the gate: it proves time-to-first-value before we spend attention on a public launch.",
        },
        {
          key: "public-launch",
          kind: "plan",
          subtype: "milestone",
          status: "active",
          title: "Public launch on Product Hunt + founder communities",
          rationale:
            "A concentrated launch moment in communities where RevOps buyers already gather.",
        },
        {
          key: "gate-q",
          kind: "open_question",
          status: "active",
          title:
            "Gate the public launch on hitting a beta activation-rate bar?",
          rationale:
            "Launching before activation works risks burning the one launch moment on a product that doesn't retain.",
        },
      ],
      edges: [
        { from: "beta", relation: "depends_on", to: "recruit" },
        { from: "public-launch", relation: "depends_on", to: "vertical" },
        { from: "public-launch", relation: "depends_on", to: "beta" },
        { from: "gate-q", relation: "depends_on", to: "beta" },
      ],
    },
  ],
};

const CHINESE_EXAMPLE: ExampleProject = {
  slug: "zh-relocation",
  name: "✦ Deepzeno 示例 · 新一线城市定居决策",
  welcomeTopicKey: "start",
  welcome: ZH_WELCOME,
  topics: [
    {
      key: "start",
      label: "从这里开始",
      isGeneral: true,
      nodes: [],
      edges: [],
    },
    {
      key: "main",
      label: "决策主线",
      nodes: [
        {
          key: "goal",
          kind: "goal",
          status: "active",
          title: "3 年内在定居城市拥有自住房，且家庭月现金流为正",
          rationale:
            "把「买房」和「不被房贷拖垮」绑在一起当目标，任何城市或预算选择都要同时满足这两条。",
        },
        {
          key: "savings",
          kind: "constraint",
          status: "active",
          title: "家庭可动用存款约 80 万，一线首付缺口大",
          rationale:
            "80 万在一线连首付都紧张，在新一线可覆盖一套两居的首付并留出装修与应急金。",
        },
        {
          key: "spouse-loc",
          kind: "constraint",
          status: "active",
          title: "配偶目前工作在一线，两年内异地成本高",
          rationale:
            "若一方留一线、一方去新一线，通勤与两地生活成本会侵蚀买房带来的现金流改善。",
        },
        {
          key: "income-hyp",
          kind: "hypothesis",
          status: "active",
          title: "回新一线后家庭总收入约降 30%，但房价与生活成本下降更多",
          rationale:
            "收入虽降，但房价、通勤、育儿等刚性支出下降幅度更大，净现金流反而转正。",
        },
        {
          key: "city-decision",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "在几个新一线里选择杭州作为定居城市",
          rationale:
            "杭州的产业与配偶职业匹配度最高，房价相对可控 —— 在收入下降与生活成本之间取得平衡。",
        },
        {
          key: "reject-stay",
          kind: "rejection",
          status: "active",
          title: "排除：留在一线继续租房、攒首付到 40 岁",
          rationale:
            "按当前存款增速，一线首付还要再攒 6–8 年，期间无自住房、育儿与养老压力叠加 —— 明确放弃。",
        },
        {
          key: "cashflow-principle",
          kind: "principle",
          status: "active",
          title: "重大取舍以「家庭净现金流与生活质量」为尺，而非城市光环",
          rationale:
            "面子与城市等级不作为决策依据，一切回到现金流与生活质量本身。",
        },
        {
          key: "transition-q",
          kind: "open_question",
          status: "active",
          title: "先落户买房，还是先低成本过渡验证？",
          rationale:
            "直接买房沉没成本高；先过渡能验证通勤、社交与配偶求职，但会多花半年租金。",
        },
        {
          key: "transition-candidate",
          kind: "plan",
          subtype: "decision",
          status: "pending",
          title: "先在杭州租住 6 个月过渡，再定落户与购房片区",
          rationale:
            "用半年低成本试住验证生活与求职，再下买房决定 —— 候选，待确认。",
        },
      ],
      edges: [
        { from: "income-hyp", relation: "depends_on", to: "goal" },
        { from: "city-decision", relation: "refines", to: "income-hyp" },
        { from: "city-decision", relation: "depends_on", to: "savings" },
        { from: "city-decision", relation: "depends_on", to: "spouse-loc" },
        { from: "reject-stay", relation: "depends_on", to: "savings" },
        { from: "cashflow-principle", relation: "depends_on", to: "goal" },
        {
          from: "transition-candidate",
          relation: "resolves",
          to: "transition-q",
        },
        {
          from: "transition-candidate",
          relation: "depends_on",
          to: "city-decision",
        },
      ],
    },
    {
      key: "career",
      label: "职业发展",
      nodes: [
        {
          key: "spouse-job",
          kind: "constraint",
          status: "active",
          title: "配偶需在杭州找到对等或更好的职位，否则家庭收入再降",
          rationale:
            "配偶收入是家庭现金流的另一半，落空则「净现金流为正」的目标不成立。",
        },
        {
          key: "remote-q",
          kind: "open_question",
          status: "active",
          title: "我方现岗位能否转远程或杭州分部？",
          rationale: "若能保住一线级别薪资，整套决策的收入风险将大幅下降。",
        },
        {
          key: "transfer-candidate",
          kind: "plan",
          subtype: "decision",
          status: "pending",
          title: "先争取现公司的杭州分部 / 远程名额，保住一线级别薪资",
          rationale:
            "在换城市之前先锁定收入，是风险最低的路径 —— 候选，待与公司确认可行性。",
        },
        {
          key: "industry-hyp",
          kind: "hypothesis",
          status: "active",
          title: "杭州的互联网 / 电商产业能提供与一线相当的岗位",
          rationale:
            "杭州头部产业密集，对等岗位供给是配偶求职与转岗的前提假设。",
        },
        {
          key: "reject-quit",
          kind: "rejection",
          status: "active",
          title: "排除：裸辞后再到杭州找工作",
          rationale: "无收入空窗期叠加房贷首付支出，风险过高 —— 放弃裸辞。",
        },
        {
          key: "interviews",
          kind: "plan",
          subtype: "task",
          status: "active",
          title: "3 个月内在杭州目标公司做 5 场信息面试",
          rationale: "用信息面试低成本验证岗位供给假设，再决定是否真的搬。",
        },
      ],
      edges: [
        { from: "transfer-candidate", relation: "resolves", to: "remote-q" },
        {
          from: "transfer-candidate",
          relation: "depends_on",
          to: "spouse-job",
        },
        {
          from: "transfer-candidate",
          relation: "depends_on",
          to: "industry-hyp",
        },
        { from: "reject-quit", relation: "depends_on", to: "spouse-job" },
        { from: "interviews", relation: "depends_on", to: "industry-hyp" },
      ],
    },
    {
      key: "family",
      label: "生活与家庭",
      nodes: [
        {
          key: "school",
          kind: "constraint",
          status: "active",
          title: "孩子明年上小学，需在片区学位确定前落定",
          rationale:
            "学位有时间窗，错过则要么择校成本高、要么再等一年，直接约束买房节奏。",
        },
        {
          key: "district-decision",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "优先选学区达标、通勤 30 分钟内的片区，牺牲部分面积",
          rationale:
            "学区与通勤是每天都在消耗的成本，比面积更影响长期生活质量。",
        },
        {
          key: "commute-hyp",
          kind: "hypothesis",
          status: "active",
          title: "新一线的通勤与育儿时间成本显著低于一线",
          rationale:
            "通勤与育儿时间是回新一线最大的隐性收益，支撑「牺牲面积换通勤」的取舍。",
        },
        {
          key: "elders-q",
          kind: "open_question",
          status: "active",
          title: "双方父母是否随迁、是否需要三居？",
          rationale: "是否随迁直接决定户型与预算，牵动首付与月供测算。",
        },
        {
          key: "compare-task",
          kind: "plan",
          subtype: "task",
          status: "active",
          title: "做杭州 3 个候选片区的「学区 + 房价 + 通勤」对照表",
          rationale: "把片区决策落到可比的数字上，避免凭感觉选。",
        },
      ],
      edges: [
        { from: "district-decision", relation: "depends_on", to: "school" },
        {
          from: "district-decision",
          relation: "depends_on",
          to: "commute-hyp",
        },
        {
          from: "compare-task",
          relation: "depends_on",
          to: "district-decision",
        },
        { from: "elders-q", relation: "depends_on", to: "school" },
      ],
    },
  ],
};

const IMMIGRATION_WELCOME = [
  "👋 这是一个 **Deepzeno 官方示例** —— 一个家庭如何把「全家技术移民加拿大」这件大事,拆成一张可以持续维护的真相图。",
  "",
  "这个示例专门展示 Deepzeno 的两件核心能力:",
  "",
  "**1. 前置假设看得见。** 打开左边的**路径决策**主题:「走联邦 EE 通道」这个决定,用箭头连着它脚下的三条前提——政策假设、语言假设、预算约束(入口处的 ①②③ 表示它们缺一不可)。不用点开任何节点,谁建立在谁之上一目了然;悬停任意一条线,能看到 AI 写的依赖说明。",
  "",
  "**2. Agent 主动做调研。** 注意「EE 抽分线不大幅上涨」这条假设旁边的📡雷达标:Zeno 已经把它列入**自动巡检**——点开它,能看到 agent 之前抓取的政策证据(Research 区),以及巡检设置(Monitoring 区)。巡检发现了相反信号,于是在待决区主动放了一张**告警候选**:「该假设可能已被推翻?」——确认或驳回,都由你判断,Zeno 永远不替你改真相。",
  "",
  "**30 秒上手:**",
  "1. 点**路径决策**,看依赖箭头与 ①②③ 汇聚;",
  "2. 点那张告警候选卡,看 agent 附上的反方证据;",
  "3. 图右上角 **调研 Agent** 按钮里,可以调巡检频率、换调研模型(默认 DeepSeek)、或点「立即巡检」。",
  "",
  "_注:此示例中的调研证据与巡检记录为演示数据(链接指向真实官网,引文为演示文字)。_",
  "—— Deepzeno 团队",
].join("\n");

const IMMIGRATION_EXAMPLE: ExampleProject = {
  slug: "zh-immigration",
  name: "✦ Deepzeno 示例 · 全家移民规划",
  welcomeTopicKey: "start",
  welcome: IMMIGRATION_WELCOME,
  topics: [
    {
      key: "start",
      label: "从这里开始",
      isGeneral: true,
      nodes: [],
      edges: [],
    },
    {
      key: "route",
      label: "路径决策",
      nodes: [
        {
          key: "goal",
          kind: "goal",
          status: "active",
          title: "18 个月内完成全家加拿大技术移民登陆",
          rationale:
            "把「要不要移民」升级成「怎么在窗口期内落地」:时间盒逼着每个选择按可行性排序,而不是无限比较。",
        },
        {
          key: "budget",
          kind: "constraint",
          status: "active",
          title: "总预算上限 60 万人民币(含安家储备金)",
          rationale:
            "不动用父母养老金是硬边界。任何单路径花费超过 35 万的方案直接出局。",
        },
        {
          key: "school-window",
          kind: "constraint",
          status: "active",
          title: "大女儿 2028 年 9 月前必须入学,窗口不可后移",
          rationale: "超过这个时间点转学衔接成本陡增,全家时间表都从它倒推。",
        },
        {
          key: "policy-hyp",
          kind: "hypothesis",
          status: "active",
          title: "假设:EE 抽分线未来 12 个月不会大幅上涨",
          rationale:
            "整条联邦 EE 路径建立在「当前分数够得着」之上。政策一收紧,主通道立即需要重审——这是全项目最脆弱的前提。",
        },
        {
          key: "ielts-hyp",
          kind: "hypothesis",
          status: "active",
          title: "假设:雅思 6 个月内可达 4 个 7(CLB 9)",
          rationale:
            "语言分是 CRS 打分的最大可控变量。达不到 CLB 9,分数模型整体塌方。",
        },
        {
          key: "route-decision",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "决定:主通道走联邦 EE,雇主担保仅作备选",
          rationale:
            "EE 流程透明、周期可控、不依赖单一雇主。它同时押在政策假设与语言假设上——任一条动摇,这个决定要回沙盒重审。",
        },
        {
          key: "eca-decision",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "决定:今年 Q4 前完成学历认证(ECA)与雅思首考",
          rationale:
            "定了通道才排得出关键路径:ECA 是入池前置,首考留出二刷余量。",
        },
        {
          key: "quebec-rejected",
          kind: "rejection",
          status: "active",
          title: "排除:魁北克技术移民路径",
          rationale:
            "法语门槛对全家过高,且该省政策近年波动频繁,与「窗口不可后移」约束冲突。",
        },
        {
          key: "backup-q",
          kind: "open_question",
          status: "active",
          title: "是否同步申请省提名(OINP/BCPNP)作为备份?",
          rationale:
            "省提名能对冲联邦抽分风险,但材料成本高。要不要付这份保险费,取决于政策假设有多稳。",
        },
        {
          key: "oinp-candidate",
          kind: "plan",
          subtype: "decision",
          status: "pending",
          sourceLayer: "research",
          title: "候选:同步准备安省 OINP 人力资本类材料",
          rationale:
            "调研显示 OINP 人力资本类与 EE 材料重合度约 80%,边际成本低——作为对冲值得做。来自调研管线的建议,待你确认。",
        },
      ],
      edges: [
        {
          from: "route-decision",
          relation: "depends_on",
          to: "policy-hyp",
          label: "抽分稳定才成立",
        },
        {
          from: "route-decision",
          relation: "depends_on",
          to: "ielts-hyp",
          label: "语言分是入池门槛",
        },
        {
          from: "route-decision",
          relation: "depends_on",
          to: "budget",
          label: "预算内可行",
        },
        {
          from: "eca-decision",
          relation: "depends_on",
          to: "route-decision",
          label: "定通道后才排期",
        },
        {
          from: "eca-decision",
          relation: "depends_on",
          to: "school-window",
          label: "从入学窗口倒推",
        },
        {
          from: "backup-q",
          relation: "depends_on",
          to: "policy-hyp",
          label: "政策风险引出备份",
        },
        {
          from: "oinp-candidate",
          relation: "resolves",
          to: "backup-q",
          label: "对冲联邦抽分风险",
        },
      ],
    },
    {
      key: "prep",
      label: "语言与资金准备",
      nodes: [
        {
          key: "study-time",
          kind: "constraint",
          status: "active",
          title: "两人每周可投入学习时间合计 ≤10 小时",
          rationale: "双职工带娃的真实上限。任何备考计划超出它就是自欺。",
        },
        {
          key: "fx-hyp",
          kind: "hypothesis",
          status: "active",
          title: "假设:人民币兑加元汇率 12 个月内波动小于 8%",
          rationale: "换汇节奏与安家资金规划都押在汇率大体平稳上。",
        },
        {
          key: "ielts-plan",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "决定:报名周末雅思强化班,10 月完成首考",
          rationale:
            "在每周 10 小时约束下,自学效率不够,外部结构化训练是必需品。",
        },
        {
          key: "fx-plan",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "决定:资金分三批换汇,首批本月完成",
          rationale: "分批摊平汇率波动;若汇率假设被推翻,后两批策略要重定。",
        },
        {
          key: "account-q",
          kind: "open_question",
          status: "active",
          title: "是否需要在国内提前开立加元账户?",
          rationale: "涉及换汇通道与后续学费支付方式,尚未比较清楚成本差异。",
        },
      ],
      edges: [
        {
          from: "ielts-plan",
          relation: "depends_on",
          to: "study-time",
          label: "在时间上限内可行",
        },
        {
          from: "fx-plan",
          relation: "depends_on",
          to: "fx-hyp",
          label: "汇率平稳才分批",
        },
        {
          from: "account-q",
          relation: "depends_on",
          to: "fx-plan",
          label: "换汇方式决定账户需求",
        },
      ],
    },
    {
      key: "settle",
      label: "安家与子女教育",
      nodes: [
        {
          key: "settle-principle",
          kind: "principle",
          status: "active",
          title: "原则:落地城市以学区质量与华人社区支持优先",
          rationale: "第一年适应成本主要落在孩子身上,城市选择为她服务。",
        },
        {
          key: "city-decision",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "决定:首选大多伦多区,备选卡尔加里",
          rationale: "教育资源与就业市场最厚;卡尔加里以生活成本低作为保底。",
        },
        {
          key: "vancouver-rejected",
          kind: "rejection",
          status: "active",
          title: "排除:温哥华",
          rationale: "房价直接击穿预算约束,不再投入比较精力。",
        },
        {
          key: "school-q",
          kind: "open_question",
          status: "active",
          title: "小学成绩单与出生证明公证何时启动?",
          rationale:
            "公证与认证周期约 6-8 周,需要从入学窗口倒排,但尚未确认清单。",
        },
      ],
      edges: [
        {
          from: "city-decision",
          relation: "depends_on",
          to: "settle-principle",
          label: "按此原则筛选城市",
        },
        {
          from: "school-q",
          relation: "depends_on",
          to: "city-decision",
          label: "定城市后才定学校",
        },
      ],
    },
  ],
  research: [
    {
      nodeKey: "policy-hyp",
      runs: [
        {
          type: "research",
          plan: [
            {
              query: "Express Entry CRS cutoff trend 2026",
              goal: "确认近 6 个月抽分走势",
            },
            {
              query: "IRCC immigration levels plan federal skilled worker",
              goal: "确认联邦技术移民配额是否调整",
            },
          ],
          brief: [
            "## 调研简报:EE 抽分线是否会大幅上涨(演示数据)",
            "",
            "- 官方 Express Entry 页面确认抽签机制与类别未变 [0]。",
            "- 但最近两轮全类别抽分连续上行,累计上涨超过 60 分 [1]。",
            "- 行业分析认为配额向省提名与特定职业倾斜,联邦通道竞争趋紧 [2]。",
            "",
            "**结论:** 该假设短期仍勉强成立,但反向信号明显,建议保持每日巡检并准备省提名对冲(见候选)。",
          ].join("\n"),
          evidence: [
            {
              url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html",
              title: "Express Entry — Canada.ca",
              quote:
                "(演示引文)Express Entry is an online system that we use to manage immigration applications from skilled workers.",
              claim: "EE 抽签机制与申请框架本身未发生结构性变化。",
              stance: "supports",
            },
            {
              url: "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/mandate/policies-operational-instructions-agreements/ministerial-instructions/express-entry-rounds.html",
              title: "Express Entry rounds of invitations — Canada.ca",
              quote:
                "(演示引文)Recent all-program rounds show minimum CRS scores rising in consecutive draws.",
              claim: "最近两轮全类别抽分连续上涨,与「不大幅上涨」的假设相悖。",
              stance: "contradicts",
            },
            {
              url: "https://www.cicnews.com/",
              title: "CIC News — Express Entry 分析(演示)",
              quote:
                "(演示引文)Analysts expect federal high-skilled admissions to tighten as allocations shift toward provincial programs.",
              claim: "分析认为配额向省提名倾斜,联邦通道竞争将加剧。",
              stance: "contradicts",
            },
          ],
        },
      ],
      watch: {
        cadence: "daily",
        reason: "可证伪假设 · 2 个判断建立在它之上 · 已有网络证据需要保鲜",
      },
      alert: {
        title: "「EE 抽分线不大幅上涨」可能已被推翻——近两轮连续上涨?",
        rationale:
          "Watchtower 巡检发现:新抓取的抽分数据与该前提相矛盾(演示数据)。若确认,「主通道走联邦 EE」与备份问题都需要回沙盒重审。",
        edgeLabel: "巡检发现新信号",
      },
    },
  ],
};

const COZE_WELCOME = [
  "👋 这是一个 **Deepzeno 官方示例** —— 一个产品团队在想清楚:**面向非程序员的 AI 编程产品,最佳形态到底是什么**。",
  "",
  "这个案例专门用来展示 Deepzeno 最核心的两件事:",
  "",
  "**1. 判断建立在哪些「前置假设」之上,一眼可见。**",
  "打开**产品形态与目标用户**,图上「已定」的每个决策下方都连着它依赖的假设(虚线箭头 = 该前提尚未被证实)。一个决策同时依赖两个假设时,入口会标 ①②。这就是 Deepzeno 与普通笔记的分界:**你随时知道自己的结论悬在什么之上。**",
  "",
  "**2. Agent 会主动替这些假设做调研。**",
  "点开假设**「目标用户会收敛为『严肃使用者』」**,详情面板里有:已抓取的证据(带原文引述与来源链接)、一个**每日巡检**的监测开关,以及一个**探索方向**看板 —— 里面是 agent 打算下一轮追查的角度(包括**反向验证**:主动去找推翻这个假设的证据)。",
  "巡检发现相反信号时,它只会生成一条**候选**提醒你,绝不擅自改动你的判断。",
  "",
  "**3. 沙盘里能看到判断是怎么谈出来的。**",
  "这个主题的对话区留着完整的探讨过程。带下划线的蓝色小标签就是**被沉淀进真相图的判断** —— 点一下会跳到对应节点。",
  "",
  "> 说明:示例中的调研证据为演示数据,来源链接真实,引述文字为示意。",
  "",
  "想好了,就点右上角的**新建项目**,开始你自己的判断。",
  "—— Deepzeno 团队",
].join("\n");

// Conversation for the main topic. Turns with {{ref:...}} render as plain
// text (the inline-ref path bypasses markdown), so they stay plainly worded.
const COZE_CONVERSATION: ExampleConversationTurn[] = [
  {
    role: "user",
    text: "我们在做一个 AI 编程产品,想让不会写代码的人也能做出能跑的应用并部署上线。现在最大的问题是:形态还很模糊,不知道该做成什么样,也不知道该服务谁。先别急着给方案,帮我把问题拆清楚。",
  },
  {
    role: "assistant",
    text: [
      "先把「形态」放一放——它是结论,不是起点。真正卡住你的是两个更前面的问题:",
      "",
      "**一、目标用户到底是谁?** 「不会写代码的人」不是一个用户群,是一个否定式描述,里面至少混了三种人:偶尔想做个小工具的白领、要靠它解决工作问题的业务骨干、以及能读懂代码但懒得写的半开发者。他们对「做出来之后怎么办」的需求天差地别。",
      "",
      "**二、交付物是什么?** 是代码,还是一个跑在云上、你替他运维的应用?这决定了责任归属——代码交给用户,用户自己负责;应用托管在你那儿,你就得为它一直活着负责。",
      "",
      "这两个问题回答完,形态基本自己就浮出来了。你先说说:变现上你打算靠什么?",
    ].join("\n"),
  },
  {
    role: "user",
    text: "变现主要靠云资源消耗和 token 消耗。用得越久、跑得越多,收入越高。",
  },
  {
    role: "assistant",
    text: "那目标用户其实被变现模型反向锁定了。一次性做个 demo 就走的人,消耗几乎为零;只有那些拿它解决真实工作问题、应用需要长期活着的人,才会持续产生消耗。所以你要服务的不是「所有不会写代码的人」,而是其中会持续用下去的那一小部分。\n\n我把这条记成一个假设,因为它可以被证伪——如果数据显示轻度用户的总量足够大、留存也不差,这条就得推翻。\n\n{{ref:serious-users}}",
  },
  {
    role: "user",
    text: "同意。那这个假设成立的话,产品重心应该放在哪?",
  },
  {
    role: "assistant",
    text: "放在**首次部署之后**。理由是:0→1 生成代码这件事,随着模型变强会迅速商品化,今天的护城河明年可能就没了;但「应用上线后持续活着、持续改」涉及运行数据、信任机制和权限结构,不随模型进步自动解决。\n\n这就要求你有一个能衡量它的指标。",
  },
  {
    role: "user",
    text: "指标我想过,一直没定下来。用 DAU 感觉不对。",
  },
  {
    role: "assistant",
    text: "DAU 衡量的是热闹,不是价值。按你的变现模型,真正该盯的是「有多少应用在被持续迭代」。我建议北极星定成:**30 天后仍在持续迭代的应用占比**。\n\n注意这个判断同时依赖两个前提——用户确实会收敛为严肃使用者,而且生成能力确实会被商品化。任意一个被推翻,这个指标的合理性都要重估。\n\n{{ref:north-star}}",
  },
  {
    role: "user",
    text: "那非开发者根本没有能力判断「改完之后对不对」,他们写不出测试用例。这块怎么办?",
  },
  {
    role: "assistant",
    text: "你指出了最难的一环。跑测试是工程问题,早就解决了;真正的产品问题是**验收标准从哪来**——非开发者说不出「什么叫对」。\n\n这个我暂时不给结论,先把它立成一个待决问题,因为它值得单独一轮讨论。\n\n{{ref:acceptance-q}}",
  },
  {
    role: "assistant",
    text: "另外,「目标用户会收敛为严肃使用者」这条假设我已经挂上了持续监测。它依赖的是外部世界的状态——竞品的用户结构、行业留存数据——这些会变,而且变了你未必第一时间知道。\n\n我会每天巡检一次,包括主动去找**反例**(有没有轻度用户留存很好的产品)。发现相反信号时,我只会给你一条候选提醒,不会动你已经确认的判断。你可以在那个节点的「探索方向」里看到我打算查什么。",
  },
];

const COZE_EXAMPLE: ExampleProject = {
  slug: "zh-coze-coding",
  name: "✦ Deepzeno 示例 · AI 编程产品的形态决策",
  personalName: "AI 编程产品的形态决策",
  welcomeTopicKey: "start",
  welcome: COZE_WELCOME,
  topics: [
    {
      key: "start",
      label: "从这里开始",
      isGeneral: true,
      nodes: [],
      edges: [],
    },
    {
      key: "shape",
      label: "产品形态与目标用户",
      conversation: COZE_CONVERSATION,
      nodes: [
        {
          key: "anchor-q",
          kind: "open_question",
          status: "active",
          title: "面向非程序员的 AI 编程产品,最佳形态是什么?",
          rationale:
            "「让不会写代码的人高效地与 AI 协作、产出可部署的产品」是方向而非形态。形态取决于两件事:服务谁,以及交付什么。这个问题是本主题存在的理由。",
          sourceTurnIndex: 0,
          sourceSpan: "形态还很模糊,不知道该做成什么样,也不知道该服务谁。",
        },
        {
          key: "infra",
          kind: "constraint",
          status: "active",
          title: "交付物是跑在自有云上的应用,不是一份代码",
          rationale:
            "自有基础设施能把「生成→部署→运行→监控→迭代」做成闭环,这是没有云的同类产品做不到的。代价是责任归属改变:平台要为应用的运行状态负责。",
          sourceTurnIndex: 1,
          sourceSpan: "应用托管在你那儿,你就得为它一直活着负责。",
        },
        {
          key: "no-selfhelp",
          kind: "constraint",
          status: "active",
          title: "非开发者在部署后没有自救能力",
          rationale:
            "应用上线后遇到报错、依赖失效、需求变更时,目标用户无法自行定位和修复。这既是流失最集中的时刻,也是付费意愿最强的时刻。",
        },
        {
          key: "serious-users",
          kind: "hypothesis",
          status: "active",
          title: "假设:目标用户会收敛为「严肃使用者」",
          rationale:
            "变现依赖持续的云与 token 消耗,而一次性产出贡献接近于零。因此真正的目标用户是那些拿它解决真实工作问题、应用需要长期存活的人。可证伪:若轻度用户的总量与留存都足够好,此假设不成立。",
          sourceTurnIndex: 3,
          sourceSpan:
            "只有那些拿它解决真实工作问题、应用需要长期活着的人,才会持续产生消耗。",
        },
        {
          key: "trust-hyp",
          kind: "hypothesis",
          status: "active",
          title: "假设:用户愿意让 agent 直接改动线上应用",
          rationale:
            "自动修复与自动迭代的前提是用户敢把线上环境交出去。这是产品的信任设计问题,不是模型能力问题。可证伪:若用户普遍要求每次改动都人工确认,自动化程度的上限就被锁死了。",
        },
        {
          key: "commodity-hyp",
          kind: "hypothesis",
          status: "active",
          title: "假设:0→1 生成能力会在 12 个月内被模型商品化",
          rationale:
            "生成质量正快速趋同,纯生成环节的差异化会被模型进步稀释。可证伪:若生成质量在一年后仍是明显的竞争分水岭,则重心不应这么早离开生成环节。",
        },
        {
          key: "north-star",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "北极星指标 = 30 天后仍在持续迭代的应用占比",
          rationale:
            "该指标同时衡量交付质量与持续价值,且与变现模型(持续的云与 token 消耗)天然对齐;DAU 之类的活跃指标会奖励热闹而非价值。",
          sourceTurnIndex: 7,
          sourceSpan: "北极星定成:30 天后仍在持续迭代的应用占比。",
        },
        {
          key: "lifecycle",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "壁垒定位在部署之后的生命周期运营",
          rationale:
            "生成环节会被模型进步商品化,而运行数据沉淀、信任与确认机制、多人协作的权限结构不会随模型变强而自动解决,且需要自有基础设施才能做成闭环。",
          sourceTurnIndex: 5,
          sourceSpan:
            "0→1 生成代码这件事,随着模型变强会迅速商品化……但「应用上线后持续活着、持续改」不随模型进步自动解决。",
        },
        {
          key: "demo-growth",
          kind: "rejection",
          status: "active",
          title: "已排除:以「生成 demo 的爽感」为核心的增长路线",
          rationale:
            "上一代对话机器人产品的教训是,大量用户创建后从不持续使用——新鲜感能拉新,但不构成留存。以爽感为核心会把资源投在一个注定被模型商品化、且不产生持续消耗的环节上。",
        },
        {
          key: "acceptance-q",
          kind: "open_question",
          status: "active",
          title: "自动验收的标准从哪里来?",
          rationale:
            "非开发者写不出测试用例,因此「跑测试」只是工程问题,「验收标准的来源」才是产品问题。没有验收,用户不敢让 agent 碰线上应用,监控与自动维护都无从谈起。",
          sourceTurnIndex: 8,
          sourceSpan:
            "非开发者根本没有能力判断「改完之后对不对」,他们写不出测试用例。",
        },
        {
          key: "acceptance-cand",
          kind: "plan",
          subtype: "decision",
          status: "pending",
          title: "候选:从需求对话中自动沉淀自然语言验收标准",
          rationale:
            "用户在描述需求时其实已经说出了「什么叫做对」,只是没有结构化。由 agent 从对话中提取为自然语言验收标准、经用户确认后转成可执行检查,每次迭代自动回归。未通过的进入归因循环。",
          sourceLayer: "research",
        },
      ],
      edges: [
        {
          from: "north-star",
          relation: "depends_on",
          to: "serious-users",
          label: "用户不严肃则指标失真",
        },
        {
          from: "north-star",
          relation: "depends_on",
          to: "commodity-hyp",
          label: "生成不被商品化则重心应前移",
        },
        {
          from: "lifecycle",
          relation: "depends_on",
          to: "commodity-hyp",
          label: "以生成被商品化为前提",
        },
        {
          from: "lifecycle",
          relation: "depends_on",
          to: "infra",
          label: "闭环依赖自有云",
        },
        {
          from: "lifecycle",
          relation: "depends_on",
          to: "no-selfhelp",
          label: "痛点集中在部署之后",
        },
        {
          from: "acceptance-q",
          relation: "depends_on",
          to: "trust-hyp",
          label: "信任是敢自动化的前提",
        },
        {
          from: "acceptance-cand",
          relation: "resolves",
          to: "acceptance-q",
          label: "回答标准从哪来",
        },
        {
          from: "north-star",
          relation: "refines",
          to: "anchor-q",
          label: "把形态问题变成可度量的",
        },
      ],
    },
    {
      key: "vague",
      label: "模糊想法 → 具体形态",
      nodes: [
        {
          key: "funnel-principle",
          kind: "principle",
          status: "active",
          title: "模糊想法必须先落成可证伪的假设,才允许进入排期",
          rationale:
            "「我觉得用户会喜欢」不可验证,因而也不可证伪;把它改写成「假设 X 类用户在 Y 场景下会持续使用」之后,才知道该收集什么反馈、什么算被推翻。",
        },
        {
          key: "behavior-hyp",
          kind: "hypothesis",
          status: "active",
          title: "假设:用户会在对话里说清需求,而不是等系统追问",
          rationale:
            "产品的交互密度取决于这一点。若用户实际上只给一句话就期待成品,则必须由 agent 主动澄清,形态会更接近访谈而非指令。可证伪:看首轮需求描述的平均信息量。",
        },
        {
          key: "proposal-flow",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "每个 feature 以「提案」形态进入,附影响面说明",
          rationale:
            "提案形态强制把「想做什么」和「会影响什么」一起说清,使反馈可以针对具体影响面而非笼统印象,也让未采纳的提案留下可追溯的排除理由。",
        },
        {
          key: "feedback-loop",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "每种形态各自收集反馈,按周期迭代而非一次定稿",
          rationale:
            "形态选择本身是待验证的判断。与其一次选定,不如让候选形态并行接受真实反馈,用留存与迭代率数据决定收敛方向。",
        },
        {
          key: "vague-q",
          kind: "open_question",
          status: "active",
          title: "模糊想法阶段,应该由谁来提出第一版假设?",
          rationale:
            "由用户提出会受限于其表达能力,由 agent 提出则有把 agent 的偏好当成用户需求的风险。这个分工直接决定产品是「工具」还是「顾问」。",
        },
        {
          key: "vague-cand",
          kind: "plan",
          subtype: "decision",
          status: "pending",
          title: "候选:agent 先提三个互斥假设,由用户挑选或否决",
          rationale:
            "让 agent 承担穷举成本、让用户承担判断责任。互斥是关键——三个雷同选项等于没给选择,反而诱导用户接受 agent 的偏好。",
          sourceLayer: "research",
        },
      ],
      edges: [
        {
          from: "proposal-flow",
          relation: "depends_on",
          to: "funnel-principle",
          label: "提案须先是可证伪假设",
        },
        {
          from: "feedback-loop",
          relation: "depends_on",
          to: "behavior-hyp",
          label: "反馈质量取决于用户表达",
        },
        {
          from: "vague-cand",
          relation: "resolves",
          to: "vague-q",
          label: "回答谁来提假设",
        },
      ],
    },
    {
      key: "handoff",
      label: "设计 ↔ 开发交接",
      nodes: [
        {
          key: "standard-principle",
          kind: "principle",
          status: "active",
          title: "标准之下没有次品:合作出问题,即交付物标准出了问题",
          rationale:
            "把协作摩擦归因到人或沟通,只会得到「下次注意」这种不可执行的结论。归因到交付物标准,才能得到可以修订、可以回归验证的具体条款。",
        },
        {
          key: "deliverable",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "协作核心是固定的交付物:交互 PRD + 逻辑说明",
          rationale:
            "让协作发生在交付物上而非会议上。交付物固定后,双方对「什么算交接完成」有同一个可检验的定义,也才有归因的对象。",
        },
        {
          key: "badcase-loop",
          kind: "plan",
          subtype: "decision",
          status: "active",
          title: "交接 badcase 按算法迭代处理:归因 → 修订标准 → 回归",
          rationale:
            "把每次返工当成一个 badcase 样本,归类到具体缺失的标准条款上,修订标准后回归检查同类问题是否消失。这使协作质量可度量、可收敛,而不是靠个人经验。",
        },
        {
          key: "ai-handoff-hyp",
          kind: "hypothesis",
          status: "active",
          title: "假设:AI 参与后,交付物标准需要对机器可读",
          rationale:
            "当 agent 也成为交接的一方时,自然语言 PRD 的歧义会被放大成实现偏差。可证伪:若 agent 在纯自然语言 PRD 下的实现一致性已经足够高,则不必付出结构化的成本。",
        },
        {
          key: "handoff-q",
          kind: "open_question",
          status: "active",
          title: "交付物标准本身如何版本化?谁有权修订?",
          rationale:
            "标准一旦可修订,就需要变更记录与权限边界,否则「修订标准」会退化成「事后给自己找理由」,归因循环随之失效。",
        },
        {
          key: "handoff-cand",
          kind: "plan",
          subtype: "decision",
          status: "pending",
          title: "候选:标准变更走提案-确认流程,保留不可变历史",
          rationale:
            "任何人可提修订,但生效需要判断所有者确认,且旧版本永久保留可追溯。与 badcase 归因循环同构:变更必须有依据、有时间戳、可回看。",
          sourceLayer: "research",
        },
      ],
      edges: [
        {
          from: "deliverable",
          relation: "depends_on",
          to: "standard-principle",
          label: "标准是协作的对象",
        },
        {
          from: "badcase-loop",
          relation: "depends_on",
          to: "deliverable",
          label: "先有交付物才能归因",
        },
        {
          from: "badcase-loop",
          relation: "depends_on",
          to: "ai-handoff-hyp",
          label: "AI 参与放大歧义成本",
        },
        {
          from: "handoff-cand",
          relation: "resolves",
          to: "handoff-q",
          label: "回答谁能改标准",
        },
      ],
    },
  ],
  research: [
    {
      nodeKey: "serious-users",
      runs: [
        {
          type: "research",
          plan: [
            {
              query: "AI 编程平台 用户结构 留存 2026",
              goal: "确认持续付费用户是否集中在「靠它解决工作问题」的人群",
            },
            {
              query: "vibe coding 产品 一次性使用 流失率",
              goal: "量化一次性生成用户的占比与留存差距",
            },
            {
              query: "低代码平台 严肃开发者 迁移",
              goal: "看严肃使用者是否正从低代码迁向 AI 编程平台",
            },
          ],
          brief: [
            "结论:证据倾向支持「目标用户收敛为严肃使用者」,但强度中等,存在一条明确的反向线索。",
            "",
            "1. 同类平台公开的用量分布普遍呈长尾:少数持续项目贡献了大部分计算消耗,与「持续消耗才产生收入」的模型一致。",
            "2. 一次性生成的应用在首月后活跃度大幅衰减,与上一代对话机器人产品的留存曲线形状相似。",
            "3. 反向线索:部分面向个人的建站类产品显示,轻度用户虽单体消耗低,但基数大且获客成本低,总收入并不弱——若该结构在编程场景同样成立,本假设需要重估。",
            "",
            "建议:保留假设,但对第 3 条持续监测。",
          ].join("\n"),
          evidence: [
            {
              url: "https://www.geekpark.net/news/348473",
              title: "极客公园:扣子团队的产品演进访谈",
              quote:
                "工作流成为核心价值之后,留下来的用户逐渐收敛为那些靠它赚钱或解决实际工作问题的人。",
              claim: "平台方观察到用户结构向「严肃使用者」收敛,支持本假设。",
              stance: "supports",
            },
            {
              url: "https://github.com/coze-dev/coze-studio",
              title: "Coze Studio 开源仓库",
              quote:
                "The platform targets developers building production-grade agent applications.",
              claim: "官方定位面向生产级应用开发者,与严肃使用者假设一致。",
              stance: "supports",
            },
            {
              url: "https://www.volcengine.com/",
              title: "火山引擎产品页",
              quote:
                "提供一键开户、部署、域名与运维能力,应用上线后按实际资源消耗计费。",
              claim:
                "变现绑定持续资源消耗,反向印证只有长期存活的应用才有商业价值。",
              stance: "supports",
            },
          ],
        },
        {
          type: "patrol",
          plan: [
            {
              query: "AI 建站 个人用户 收入结构 2026",
              goal: "反向验证:轻度用户基数大是否足以支撑收入",
            },
            {
              query: "Lovable Replit 用户构成 变化",
              goal: "观察同类产品的用户结构是否正在偏离严肃使用者",
            },
          ],
          brief:
            "巡检:重新核验了三条既有证据的原文引述,均仍在页面上。未发现足以推翻该假设的新信号,但反向线索(轻度用户总量)仍未被证伪,保留在下轮探索方向中。",
          evidence: [],
        },
      ],
      watch: {
        cadence: "daily",
        reason:
          "可证伪假设 · 3 个判断建立在它之上 · 依赖外部竞品与行业数据,会随市场变化",
        nextDirections: [
          {
            query: "AI 编程产品 轻度用户 留存 反例",
            goal: "反向验证:主动寻找轻度用户留存良好的反例,若成立则本假设需重估",
          },
          {
            query: "Lovable Replit Bolt 用户结构 2026 变化",
            goal: "相邻信号:同类产品的用户构成若明显偏离严肃使用者,是本假设的早期预警",
          },
          {
            query: "AI 技能商店 经验资产化 付费意愿",
            goal: "大胆假设:若「把经验沉淀成可复用资产」成为主要付费动机,目标用户画像可能整体迁移",
          },
        ],
      },
      alert: {
        title:
          "「目标用户会收敛为严肃使用者」可能需要重估——多人协作场景正在扩大?",
        rationale:
          "Watchtower 巡检发现:同类产品近期主推多人协作与项目空间,使用者从个体严肃开发者扩展到团队中的非技术成员(演示数据)。若确认,「北极星指标」与「壁垒定位」都需要回沙盒重审。",
        edgeLabel: "巡检发现新信号",
      },
    },
  ],
};

export const EXAMPLE_PROJECTS: ExampleProject[] = [
  COZE_EXAMPLE,
  IMMIGRATION_EXAMPLE,
  ENGLISH_EXAMPLE,
  CHINESE_EXAMPLE,
];
