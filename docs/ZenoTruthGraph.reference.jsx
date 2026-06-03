/* =============================================================================
   Zeno Truth Graph — 参照组件 (Reference Component, v1)
   =============================================================================
   这是给 Codex 的「长什么样」参照,配合 zeno-truth-graph-rules.md (为什么) 和
   zeno-truth-graph-tokens.css (精确值) 使用。

   ⚠️ 这是 REFERENCE,不是可直接上生产的代码。它的目的是让 Codex 准确看到:
      - 同屏并置布局 (左全貌固定 / 右单链随选)
      - 四形状、绿红灰+琥珀、正交路由、端点锚定、汇聚编号
      - 三级透明度聚焦 (过渡而非重绘)
      - 所有视觉值如何引用 token (零字面值)

   ⚠️ 生产环境必须替换的部分,已用 [PROD] 注释逐处标明。最关键三处:
      1. [PROD-LAYOUT] 全貌/单链的节点坐标这里是手算的;生产用 ELK.js (经 Craft
         beautiful-mermaid 的同步 FakeWorker) 跑确定性正交布局,不要手算。
      2. [PROD-DATA] 数据这里写死;生产从 ir_nodes 查询,按 props 传入。
      3. [PROD-CHARTTYPE] 这里只实现了「流程链」一种;生产需按内容形态选图
         (流程/状态/时序,见规则文档 §3.2),本组件是 flowchart 形态的参照。
   ============================================================================= */

import { useState, useMemo } from "react";

/* -----------------------------------------------------------------------------
   类型 (生产可放进单独 types 文件)
----------------------------------------------------------------------------- */
// kind: 'decision' | 'fact' | 'open' | 'candidate'  (superseded 全貌默认藏,见 §8)
// status 的绿红语义靠 kind + 一个 confirmed/rejected 标志承载;此处简化为 kind 驱动。
//
// Node: { id, kind, title, topicId, detail }
// Dep:  [childId, parentId]   child 依赖 parent
// Topic:{ id, title }
// Assumption (global/local) 不进 graph 当节点 —— 见规则文档 §6,本参照未含,
//   生产中 global 放 Topic 折叠条、local 放 detail,跨多节点的才用虚线标签。

/* -----------------------------------------------------------------------------
   [PROD-DATA] 写死的样例数据 —— 生产替换为 props: { topics, nodes, deps }
----------------------------------------------------------------------------- */
const SAMPLE = {
  topics: [
    { id: "T1", title: "技术栈" },
    { id: "T2", title: "账号权限" },
    { id: "T3", title: "收费" },
    { id: "T4", title: "数据结构" },
    { id: "T5", title: "上线推广" },
  ],
  nodes: [
    { id: "F1", kind: "fact",      title: "没运维精力",       topicId: "T1", detail: "一个人开发,没专职运维。约束。" },
    { id: "D2", kind: "decision",  title: "数据库用 Supabase", topicId: "T1", detail: "托管数据库,因为没运维精力。" },
    { id: "D1", kind: "decision",  title: "前端 Next.js",      topicId: "T1", detail: "前端 Next.js。" },
    { id: "D3", kind: "decision",  title: "部署 Vercel",       topicId: "T1", detail: "部署 Vercel,零配置。" },
    { id: "D4", kind: "decision",  title: "Supabase 登录",     topicId: "T2", detail: "身份和数据放一起。" },
    { id: "D5", kind: "decision",  title: "按租户隔离",        topicId: "T2", detail: "行级权限做多租户隔离。" },
    { id: "Q1", kind: "open",      title: "要团队角色吗",      topicId: "T2", detail: "V1 是否做多人团队角色?未定。" },
    { id: "D6", kind: "decision",  title: "Stripe 收款",       topicId: "T3", detail: "Stripe 收订阅。" },
    { id: "D7", kind: "decision",  title: "席位+用量计费",     topicId: "T3", detail: "基础席位费 + 按用量。需收款通道和计量单位都就位。" },
    { id: "Q2", kind: "open",      title: "按什么计量",        topicId: "T3", detail: "按哪个动作计量收费?未定。" },
    { id: "C1", kind: "candidate", title: "设免费档",          topicId: "T3", detail: "有上限的免费档做获客。候选。" },
    { id: "D8", kind: "decision",  title: "单表 ir_nodes",     topicId: "T4", detail: "一张表 + 状态字段。" },
    { id: "D9", kind: "decision",  title: "改动新建节点",      topicId: "T4", detail: "已确认节点不改,要改就新建、旧的标取代。" },
    { id: "D10",kind: "decision",  title: "先预售",            topicId: "T5", detail: "注册公司前先收预售。" },
    { id: "F2", kind: "fact",      title: "用户在 X 上",       topicId: "T5", detail: "目标用户在 X 看 AI 工作流内容。" },
    { id: "C2", kind: "candidate", title: "X 内容引流",        topicId: "T5", detail: "X 内容做上线前引流。候选。" },
  ],
  deps: [
    ["D2","F1"],["D3","D1"],["D4","D2"],["D5","D4"],["D5","Q1"],
    ["D6","D4"],["D7","D6"],["D7","Q2"],["C1","Q2"],["D8","D2"],
    ["D9","D8"],["D10","D7"],["C2","F2"],
  ],
};

/* -----------------------------------------------------------------------------
   kind → 视觉映射 (全部走 token,零字面值)
   绿红只在 confirmed/rejected 时叠加;此参照用 kind 近似,生产按真实 status。
----------------------------------------------------------------------------- */
function strokeFor(kind, isOnChain) {
  if (isOnChain) return "var(--z-confirmed)";          // 链上高亮统一绿
  if (kind === "open")      return "var(--z-attention)";
  if (kind === "candidate") return "var(--z-candidate)";
  if (kind === "fact")      return "var(--z-fact-stroke)";
  return "var(--z-node-stroke)";
}
function textFor(kind, isOnChain) {
  if (isOnChain) return "var(--z-confirmed)";
  if (kind === "open")      return "var(--z-attention-text)";
  if (kind === "candidate") return "var(--z-candidate-text)";
  if (kind === "fact")      return "var(--z-text-2)";
  return "var(--z-text)";
}

/* =============================================================================
   主组件
   ============================================================================= */
export default function ZenoTruthGraph({ data = SAMPLE }) {
  const { topics, nodes, deps } = data;
  const [selected, setSelected] = useState(null);

  // 索引
  const nodeById = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const parents = useMemo(() => {
    const m = {};
    deps.forEach(([c, p]) => (m[c] = m[c] || []).push(p));
    return m;
  }, [deps]);
  const kids = useMemo(() => {
    const m = {};
    deps.forEach(([c, p]) => (m[p] = m[p] || []).push(c));
    return m;
  }, [deps]);

  // 选中节点的上游链 (root 在前, 选中在后) —— longest-path 拓扑序
  const chain = useMemo(() => {
    if (!selected) return [];
    const seen = new Set(), order = [];
    (function dfs(n) {
      if (seen.has(n)) return;
      seen.add(n);
      (parents[n] || []).forEach(dfs);
      order.push(n);
    })(selected);
    return order;
  }, [selected, parents]);
  const chainSet = useMemo(() => new Set(chain), [chain]);

  return (
    <div style={{ fontFamily: "var(--z-font-sans)", color: "var(--z-text)" }}>
      <div style={{ display: "flex", border: "0.5px solid var(--z-topic-border)", borderRadius: 12, overflow: "hidden" }}>
        {/* ---- 左: 全貌 (固定,选中后只点亮相关链) ---- */}
        <div style={{ flex: "1 1 58%", minWidth: 0, borderRight: "0.5px solid var(--z-topic-border)" }}>
          <PaneHeader>全貌 · 项目判断状态</PaneHeader>
          <Overview
            topics={topics} nodes={nodes} deps={deps}
            nodeById={nodeById}
            selected={selected} chainSet={chainSet}
            onPick={setSelected}
          />
        </div>
        {/* ---- 右: 单链 (随选刷新;左侧不动) ---- */}
        <div style={{ flex: "1 1 42%", minWidth: 0, background: "var(--z-node-fill)" }}>
          <PaneHeader>{selected ? `推导链 · ${nodeById[selected].title}` : "推导链 · 点左侧任意方框"}</PaneHeader>
          {selected
            ? <Chain chain={chain} nodeById={nodeById} parents={parents} selected={selected} />
            : <Empty />}
        </div>
      </div>
    </div>
  );
}

function PaneHeader({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 500, color: "var(--z-text-3)", letterSpacing: ".04em",
                       padding: "10px 14px 6px", textTransform: "uppercase" }}>{children}</div>;
}
function Empty() {
  return <div style={{ fontSize: 13, color: "var(--z-text-3)", padding: "24px 16px", lineHeight: 1.6 }}>
    点左边全貌里的任意一个方框,这里会把它<b style={{ color: "var(--z-text-2)" }}>怎么一步步被推导出来</b>铺成一条从上到下的流程。左边的图不会动。
  </div>;
}

/* -----------------------------------------------------------------------------
   全貌层
   [PROD-LAYOUT] 这里用「两列 + Topic 纵向堆叠 + 手算 y」近似。
   生产: 用 ELK.js 跑确定性布局 (Craft beautiful-mermaid 内置, 同步 FakeWorker),
         得到稳定坐标;新节点进入时做 stable incremental layout (旧节点尽量不动)。
   默认不画任何依赖线 (§1.1);只有 selected 时才画 chain 相关的线 (绿,正交)。
----------------------------------------------------------------------------- */
function Overview({ topics, nodes, deps, nodeById, selected, chainSet, onPick }) {
  // —— 手算布局 (PROD 替换为 ELK 输出) ——
  const COLX = [14, 210], BOXW = 176, NH = 26, ROW = 33, THEAD = 22, TGAP = 20;
  const layout = useMemo(() => {
    const pos = {}, tbox = {}, colY = [12, 12];
    topics.forEach((t, i) => {
      const col = i % 2;
      const items = nodes.filter(n => n.topicId === t.id);
      const x = COLX[col], top = colY[col];
      tbox[t.id] = { x, y: top, w: BOXW, h: THEAD + items.length * ROW + 6, title: t.title };
      items.forEach((n, j) => { pos[n.id] = { x: x + 10, y: top + THEAD + j * ROW, w: BOXW - 20, h: NH }; });
      colY[col] = top + tbox[t.id].h + TGAP;
    });
    return { pos, tbox, height: Math.max(colY[0], colY[1]) + 4 };
  }, [topics, nodes]);

  const { pos, tbox, height } = layout;

  return (
    <svg width="100%" viewBox={`0 0 400 ${height}`} role="img"
         aria-label="项目全貌:按主题分组的判断节点">
      <defs>
        <marker id="z-arrow-chain" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="var(--z-confirmed)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>

      {/* Topic 容器: 极淡描边 + 留白分隔 (不做成卡片) */}
      {topics.map(t => {
        const b = tbox[t.id];
        return (
          <g key={t.id}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="9" fill="none"
                  stroke="var(--z-topic-border)" strokeWidth="0.75" />
            <text x={b.x + 10} y={b.y + 14} fontSize="var(--z-font-topic)" fontWeight="500"
                  fill="var(--z-text-2)">{b.title}</text>
          </g>
        );
      })}

      {/* 依赖线: 默认不画;仅 selected 时画 chain 内的线 (正交直角, 绿) */}
      {selected && deps.filter(([c, p]) => chainSet.has(c) && chainSet.has(p)).map(([c, p], i) => {
        const a = pos[c], b = pos[p];
        if (!a || !b) return null;
        const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2, lx = a.x - 7;
        // 正交: 出左 → 直角 → 竖 → 直角 → 进父右边
        const d = `M${a.x} ${y1} L${lx} ${y1} L${lx} ${y2} L${b.x + b.w + 2} ${y2}`;
        return <path key={i} d={d} fill="none" stroke="var(--z-confirmed)"
                     strokeWidth="var(--z-line-w-strong)" markerEnd="url(#z-arrow-chain)"
                     strokeLinejoin="round" opacity="0.95"
                     style={{ transition: "opacity var(--z-transition)" }} />;
      })}

      {/* 节点: 选中后三级透明度 (在链上=full, 否则=faint) */}
      {nodes.map(n => {
        const p = pos[n.id];
        const onChain = chainSet.has(n.id);
        const faint = selected && !onChain;
        const op = !selected ? 1 : onChain ? "var(--z-focus-full)" : "var(--z-focus-faint)";
        return (
          <g key={n.id} style={{ cursor: "pointer", transition: "opacity var(--z-transition)" }}
             opacity={op} onClick={() => onPick(n.id)}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="6"
                  fill="var(--z-bg)"
                  stroke={strokeFor(n.kind, onChain)}
                  strokeWidth={onChain ? "var(--z-stroke-w-target)" : (n.kind === "fact" ? "var(--z-stroke-w-fact)" : "var(--z-stroke-w)")} />
            <text x={p.x + 9} y={p.y + p.h / 2 + 1} fontSize="11.5px"
                  fontWeight={n.kind === "fact" ? 400 : 500}
                  fill={textFor(n.kind, onChain)} dominantBaseline="central">
              {n.kind === "open" ? `${n.title} ?` : n.kind === "candidate" ? `${n.title} ·候选` : n.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* -----------------------------------------------------------------------------
   单链层 (flowchart 形态)
   [PROD-CHARTTYPE] 仅实现流程链。生产按内容形态切换 (状态图/时序图),见 §3.2。
   端点锚定 (§5.2): root=胶囊+▷+「从这里开始」, target=加粗+「你选中的」。
   纯线性段不编号;汇聚 (一个节点多个 parent) 处才标 ①② (此简化样例未展开多链汇聚,
   生产遇汇聚见 §5.3/§5.4: 多链并排汇入 + 入边编号 + 每链独立线型/色)。
----------------------------------------------------------------------------- */
function Chain({ chain, nodeById, parents, selected }) {
  const CW = 210, CH = 42, VGAP = 34, X = (296 - CW) / 2, TOP = 14;
  const H = TOP + chain.length * (CH + VGAP) + 8;
  const kidsOfSel = useMemo(() => {
    // 反向: 谁依赖选中节点 (用于详情「被谁依赖」, 此处略)
    return null;
  }, [selected]);

  return (
    <svg width="100%" viewBox={`0 0 296 ${H}`} role="img" aria-label="选中判断的推导链">
      <defs>
        <marker id="z-arrow-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="var(--z-confirmed)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>

      {/* 竖直依赖箭头 + 「需要」标签 (纯线性不编号) */}
      {chain.slice(0, -1).map((_, i) => {
        const y1 = TOP + i * (CH + VGAP) + CH, y2 = TOP + (i + 1) * (CH + VGAP), x = X + CW / 2;
        const my = (y1 + y2) / 2;
        return (
          <g key={i}>
            <path d={`M${x} ${y1} L${x} ${y2 - 3}`} fill="none" stroke="var(--z-confirmed)"
                  strokeWidth="var(--z-line-w-strong)" markerEnd="url(#z-arrow-flow)" />
            <rect x={x - 18} y={my - 9} width="36" height="18" rx="4" fill="var(--z-node-fill)" />
            <text x={x} y={my + 1} fontSize="11px" textAnchor="middle" dominantBaseline="central"
                  fill="var(--z-confirmed)" fontWeight="500">需要</text>
          </g>
        );
      })}

      {/* 节点: 端点锚定 */}
      {chain.map((id, i) => {
        const n = nodeById[id], y = TOP + i * (CH + VGAP);
        const isTarget = id === selected, isRoot = i === 0;
        const col = n.kind === "open" ? "var(--z-attention-text)"
                  : n.kind === "candidate" ? "var(--z-candidate-text)"
                  : isTarget ? "var(--z-confirmed)" : "var(--z-node-stroke)";
        const rx = isRoot ? "var(--z-start-radius)" : isTarget ? "var(--z-node-radius-target)" : "var(--z-node-radius)";
        const sw = isTarget ? "var(--z-stroke-w-target)" : n.kind === "fact" ? "var(--z-stroke-w-fact)" : "1.25px";
        const lead = isRoot ? "▷  从这里开始 · " : isTarget ? "选中 · " : "";
        return (
          <g key={id} style={{ cursor: "pointer" }}>
            <rect x={X} y={y} width={CW} height={CH} rx={rx} fill="var(--z-bg)" stroke={col} strokeWidth={sw} />
            <text x={X + CW / 2} y={y + CH / 2 + 1} fontSize="var(--z-font-node-tgt)" textAnchor="middle"
                  dominantBaseline="central"
                  fill={n.kind === "fact" ? "var(--z-text-2)" : col} fontWeight="500">
              {lead + (n.kind === "open" ? `${n.title} (待定)` : n.kind === "candidate" ? `${n.title} (候选)` : n.title)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
