"use client";

// TEMPORARY dev harness: renders the flagship immigration example's graph
// (real example-content data) through the real TruthGraph, without auth/DB.
// Not linked from anywhere; delete before release.

import { useMemo, useState } from "react";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { TruthGraph } from "@/components/ir/truth-graph";
import type { IREdge, IRNode } from "@/lib/ir/types";
import { EXAMPLE_PROJECTS } from "@/lib/workspace/example-content";

const SPEC =
  EXAMPLE_PROJECTS.find((project) => project.slug === "zh-coze-coding") ??
  EXAMPLE_PROJECTS[0];

function buildData() {
  const nodes: IRNode[] = [];
  const edges: IREdge[] = [];
  const idByKey = new Map<string, string>();
  const counters = new Map<string, number>();
  const nextId = (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}${next}`;
  };

  const topics = SPEC.topics.filter((topic) => !topic.isGeneral);
  for (const topic of topics) {
    for (const node of topic.nodes) {
      const id = nextId(node.kind.slice(0, 1).toUpperCase());
      idByKey.set(node.key, id);
      nodes.push({
        id,
        projectId: "demo",
        topicId: topic.key,
        parentId: null,
        kind: node.kind,
        subtype: node.subtype ?? null,
        status: node.status,
        title: node.title,
        content: node.rationale,
        rationale: node.rationale,
        sensitivity: "normal",
        sourceChatId: null,
        sourceTurnId: null,
        sourceTextSpan: null,
        sourceLayer: node.sourceLayer ?? "manual",
        importSessionId: null,
        reactivationAnchorId: null,
        extractionConfidence: null,
        createdAt: "2026-07-01T00:00:00Z",
        promotedToPendingAt:
          node.status === "pending" ? "2026-07-02T00:00:00Z" : null,
        confirmedAt: node.status === "active" ? "2026-07-02T00:00:00Z" : null,
        supersededAt: null,
        supersededBy: null,
        createdBy: "ai",
        confirmedBy: null,
      });
    }
  }
  let edgeSeq = 0;
  for (const topic of topics) {
    for (const edge of topic.edges) {
      const fromNode = idByKey.get(edge.from);
      const toNode = idByKey.get(edge.to);
      if (!(fromNode && toNode)) {
        continue;
      }
      edgeSeq += 1;
      edges.push({
        id: `E${edgeSeq}`,
        projectId: "demo",
        fromNode,
        toNode,
        relation: edge.relation,
        label: edge.label ?? null,
        status: "active",
        isAnchorHint: false,
        createdAt: "2026-07-02T00:00:00Z",
        confirmedAt: "2026-07-02T00:00:00Z",
      });
    }
  }
  const topicList = topics.map((topic) => ({
    id: topic.key,
    label: topic.label,
  }));
  const watched = new Set<string>();
  for (const entry of SPEC.research ?? []) {
    const id = idByKey.get(entry.nodeKey);
    if (id && entry.watch) {
      watched.add(id);
    }
  }
  return { nodes, edges, topicList, watched };
}

export default function LaneEdgesDemoPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"truth" | "all">("all");
  const { nodes, edges, topicList, watched } = useMemo(buildData, []);

  return (
    <LocaleProvider initialLocale="zh">
      <div className="h-dvh p-4">
        <TruthGraph
          childrenByParent={new Map()}
          edges={edges}
          mode={mode}
          nodes={nodes}
          onModeChange={setMode}
          onSelect={setSelected}
          selectedNodeId={selected}
          topics={topicList}
          watchedNodeIds={watched}
        />
      </div>
    </LocaleProvider>
  );
}
