import type { WorkspaceDecision, WorkspaceEdge } from "@/lib/workspace/types";

const MAX_SERIALIZED_CHARS = 8000;

function sortDecisions(decisions: WorkspaceDecision[]) {
  const weightRank: Record<string, number> = {
    anchor: 0,
    key: 1,
    normal: 2,
  };

  return [...decisions].sort((left, right) => {
    const leftRank = weightRank[left.weight] ?? 3;
    const rightRank = weightRank[right.weight] ?? 3;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function serializeDecisionGraph(
  decisions: WorkspaceDecision[],
  edges: WorkspaceEdge[]
) {
  if (decisions.length === 0) {
    return "";
  }

  const titleById = new Map(
    decisions.map((decision) => [decision.id, decision.title])
  );
  const decisionLines = sortDecisions(decisions).map((decision) => {
    const summary = decision.content.replace(/\s+/g, " ").trim();

    return `[${decision.id}] ${decision.title} | kind=${decision.kind} | weight=${decision.weight} | status=${decision.status} | ${summary}`;
  });

  const edgeLines = edges.map((edge) => {
    const sourceTitle =
      titleById.get(edge.sourceDecisionId) ?? edge.sourceDecisionId;
    const targetTitle =
      titleById.get(edge.targetDecisionId) ?? edge.targetDecisionId;
    return `[${sourceTitle}] --${edge.type}--> [${targetTitle}]`;
  });

  const output = [...decisionLines, ...edgeLines].join("\n");

  if (output.length <= MAX_SERIALIZED_CHARS) {
    return output;
  }

  return `${output.slice(0, MAX_SERIALIZED_CHARS)}\n...`;
}
