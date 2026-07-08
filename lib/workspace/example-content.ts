import type { IRKind, IRPlanSubtype, IRRelation } from "@/lib/ir/types";

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
};

export type ExampleEdge = {
  from: string;
  relation: IRRelation;
  to: string;
};

export type ExampleTopic = {
  key: string;
  label: string;
  isGeneral?: boolean;
  nodes: ExampleNode[];
  edges: ExampleEdge[];
};

export type ExampleProject = {
  // Stable slug for logging/telemetry.
  slug: string;
  name: string;
  // Key of the topic whose conversation receives the welcome message.
  welcomeTopicKey: string;
  welcome: string;
  topics: ExampleTopic[];
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

export const EXAMPLE_PROJECTS: ExampleProject[] = [
  ENGLISH_EXAMPLE,
  CHINESE_EXAMPLE,
];
