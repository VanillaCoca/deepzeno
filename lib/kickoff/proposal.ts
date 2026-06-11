// L1 Kickoff proposal shapes and the pure normalizer between the model's raw
// structured output and anything the app persists. Constitution: kickoff may
// only propose open questions / goals / constraints / hypotheses (no plans —
// premature; no rejections — they require user history), and volume is capped
// so seeding never floods the confirm queue (principle 2a).

export const kickoffNodeKinds = [
  "open_question",
  "goal",
  "constraint",
  "hypothesis",
] as const;
export type KickoffNodeKind = (typeof kickoffNodeKinds)[number];

export const KICKOFF_LIMITS = {
  maxTopics: 5,
  maxNodesPerTopic: 4,
};

// Same conceptual boundary as the sweep funnel (high→pending ~0.82,
// medium→idea ~0.58): at or above this, a proposal is worth the user's
// confirmation queue; below it, it parks as an idea.
export const KICKOFF_PENDING_THRESHOLD = 0.7;

export type KickoffNodeProposal = {
  kind: KickoffNodeKind;
  title: string;
  content: string | null;
  rationale: string | null;
  confidence: number;
};

export type KickoffTopicProposal = {
  name: string;
  charter: string;
  nodes: KickoffNodeProposal[];
};

export type KickoffProposal = {
  topics: KickoffTopicProposal[];
};

type RawNode = {
  kind?: string | null;
  title?: string | null;
  content?: string | null;
  rationale?: string | null;
  confidence?: number | null;
};

type RawTopic = {
  name?: string | null;
  charter?: string | null;
  nodes?: RawNode[] | null;
};

export function statusForConfidence(
  confidence: number | null | undefined
): "pending" | "idea" {
  return (confidence ?? 0) >= KICKOFF_PENDING_THRESHOLD ? "pending" : "idea";
}

function clampConfidence(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

export function normalizeKickoffProposal(raw: {
  topics?: RawTopic[] | null;
}): KickoffProposal {
  const topics = (raw.topics ?? [])
    .map((topic) => {
      const name = topic.name?.trim() ?? "";
      const charter = topic.charter?.trim() ?? "";
      const nodes = (topic.nodes ?? [])
        .map((node) => {
          const kind = node.kind?.trim() as KickoffNodeKind;
          const title = node.title?.trim() ?? "";

          if (!(kickoffNodeKinds as readonly string[]).includes(kind)) {
            return null;
          }

          if (!title) {
            return null;
          }

          return {
            kind,
            title: title.slice(0, 200),
            content: node.content?.trim() || null,
            rationale: node.rationale?.trim() || null,
            confidence: clampConfidence(node.confidence),
          };
        })
        .filter((node): node is KickoffNodeProposal => Boolean(node))
        .slice(0, KICKOFF_LIMITS.maxNodesPerTopic);

      // The confirm API requires both (charter is the topic's reason to
      // exist); admitting a charterless topic here would only 400 later.
      if (!(name && charter)) {
        return null;
      }

      return {
        name: name.slice(0, 120),
        charter: charter.slice(0, 500),
        nodes,
      };
    })
    .filter((topic): topic is KickoffTopicProposal => Boolean(topic))
    .slice(0, KICKOFF_LIMITS.maxTopics);

  return { topics };
}
