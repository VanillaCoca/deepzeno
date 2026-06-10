/**
 * ZENO MCP route
 *
 * Boundary (Iron Law 4): every MCP write is candidate-first. External agents
 * propose; proposals land in the user's review queue and become truth only
 * after explicit user confirmation. There is no direct mutation path.
 */

import { z } from "zod";
import { decisionKindOrder } from "@/lib/decision-kinds";
import { ChatbotError } from "@/lib/errors";
import { authenticateProjectApiKey } from "@/lib/mcp/api-keys";
import {
  archiveMcpDecision,
  createMcpDecision,
  createMcpEdge,
  deleteMcpEdge,
  getMcpDecision,
  getMcpIRNode,
  getMcpProjectContext,
  getMcpTopicContext,
  listMcpDecisions,
  listMcpTopics,
  resolveMcpOpenQuestion,
  searchMcpIR,
  submitMcpCandidate,
  supersedeMcpDecision,
  updateMcpDecision,
} from "@/lib/mcp/service";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

const protocolVersion = "2025-03-26";

const listTopicsSchema = z.object({
  project_id: z.string().uuid(),
  status: z.string().optional(),
});

const listDecisionsSchema = z.object({
  project_id: z.string().uuid(),
  topic_id: z.string().uuid().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
});

const getDecisionSchema = z.object({
  decision_id: z.string().uuid(),
});

const getProjectContextSchema = z.object({
  project_id: z.string().uuid(),
  topic_id: z.string().uuid().optional(),
});

const getTopicContextSchema = z.object({
  topic_id: z.string().uuid(),
  include_relation_closure: z.boolean().optional().default(true),
});

const searchIRSchema = z.object({
  project_id: z.string().uuid(),
  query: z.string().trim().min(1).max(200),
  topic_id: z.string().uuid().optional(),
});

const getIRNodeSchema = z.object({
  node_id: z.string().trim().min(1),
});

const submitCandidateSchema = z.object({
  project_id: z.string().uuid(),
  topic_id: z.string().uuid(),
  proposed_title: z.string().min(1),
  proposed_content: z.string().min(1),
  proposed_kind: z.string().min(1),
  proposed_rationale: z.string().optional(),
  external_evidence: z.string().optional(),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
});

const decisionKindSchema = z.enum(decisionKindOrder);
const decisionWeightSchema = z.enum(["low", "normal", "high"]);

const codeAnchorSchema = z
  .object({
    repo: z.string().trim().min(1).optional(),
    file: z.string().trim().min(1),
    line_start: z.number().int().positive().optional(),
    line_end: z.number().int().positive().optional(),
    commit_sha: z.string().trim().min(1).optional(),
    captured_at: z
      .string()
      .min(1)
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: "captured_at must be ISO-parseable",
      }),
  })
  .superRefine((anchor, context) => {
    if (
      anchor.line_start !== undefined &&
      anchor.line_end !== undefined &&
      anchor.line_start > anchor.line_end
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["line_end"],
        message: "line_end must be greater than or equal to line_start",
      });
    }
  });

const agentWriteSchema = z.object({
  agent: z.string().trim().min(1),
  session_id: z.string().trim().min(1).optional(),
});

const createDecisionSchema = agentWriteSchema.extend({
  project_id: z.string().uuid(),
  topic_id: z.string().uuid(),
  title: z.string().min(1),
  content: z.string().min(1),
  kind: decisionKindSchema,
  rationale: z.string().optional(),
  weight: decisionWeightSchema.optional().default("normal"),
  relevant_message_ids: z.array(z.string().uuid()).optional(),
  code_anchors: z.array(codeAnchorSchema).optional(),
});

const updateDecisionSchema = agentWriteSchema.extend({
  decision_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  rationale: z.string().optional(),
  kind: decisionKindSchema.optional(),
  weight: decisionWeightSchema.optional(),
  code_anchors: z.array(codeAnchorSchema).optional(),
});

const archiveDecisionSchema = agentWriteSchema.extend({
  decision_id: z.string().uuid(),
  reason: z.string().optional(),
});

const supersedeDecisionSchema = agentWriteSchema.extend({
  superseded_decision_id: z.string().uuid(),
  new_title: z.string().min(1),
  new_content: z.string().min(1),
  new_rationale: z.string().optional(),
  new_kind: decisionKindSchema.optional(),
  new_weight: decisionWeightSchema.optional(),
  new_code_anchors: z.array(codeAnchorSchema).optional(),
  reason: z.string().min(1),
});

const resolveOpenQuestionSchema = agentWriteSchema.extend({
  question_decision_id: z.string().uuid(),
  resolution: z.enum(["answered", "no_longer_relevant", "split"]),
  answer_kind: decisionKindSchema.optional(),
  answer_title: z.string().min(1).optional(),
  answer_content: z.string().min(1).optional(),
  answer_rationale: z.string().optional(),
  answer_code_anchors: z.array(codeAnchorSchema).optional(),
});

const createEdgeSchema = agentWriteSchema.extend({
  project_id: z.string().uuid(),
  source_decision_id: z.string().uuid(),
  target_decision_id: z.string().uuid(),
  type: z.enum([
    "supports",
    "contradicts",
    "blocks",
    "blocked_by",
    "depends_on",
    "supersedes",
    "resolves",
    "related_to",
  ]),
});

const deleteEdgeSchema = agentWriteSchema.extend({
  edge_id: z.string().uuid(),
  reason: z.string().optional(),
});

function jsonRpcResult(id: JsonRpcId, result: unknown, init?: ResponseInit) {
  return Response.json(
    {
      jsonrpc: "2.0",
      id,
      result,
    },
    init
  );
}

function jsonRpcError(
  id: JsonRpcId,
  {
    code,
    message,
    data,
    status = 400,
  }: {
    code: number;
    message: string;
    data?: unknown;
    status?: number;
  }
) {
  return Response.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data }),
      },
    },
    { status }
  );
}

function toolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function parseBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-api-key")?.trim() ?? null;
}

const decisionKindJsonSchema = {
  type: "string",
  enum: [...decisionKindOrder],
};

const decisionWeightJsonSchema = {
  type: "string",
  enum: ["low", "normal", "high"],
};

const codeAnchorJsonSchema = {
  type: "object",
  properties: {
    repo: { type: "string" },
    file: { type: "string" },
    line_start: { type: "integer", minimum: 1 },
    line_end: { type: "integer", minimum: 1 },
    commit_sha: { type: "string" },
    captured_at: { type: "string", format: "date-time" },
  },
  required: ["file", "captured_at"],
  additionalProperties: false,
};

function getToolDefinitions() {
  return [
    {
      name: "list_topics",
      description:
        "List judgment topics for the authenticated project, optionally filtered by lifecycle status.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
          status: { type: "string" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
    },
    {
      name: "list_decisions",
      description:
        "List confirmed decisions for the authenticated project, optionally filtered by topic, kind, or status.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
          topic_id: { type: "string", format: "uuid" },
          kind: { type: "string" },
          status: { type: "string" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
    },
    {
      name: "get_decision",
      description: "Load one decision plus its local edge relations.",
      inputSchema: {
        type: "object",
        properties: {
          decision_id: { type: "string", format: "uuid" },
        },
        required: ["decision_id"],
        additionalProperties: false,
      },
    },
    {
      name: "list_open_questions",
      description: "List active open questions for the authenticated project.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
          topic_id: { type: "string", format: "uuid" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
    },
    {
      name: "list_rejections",
      description: "List active rejections for the authenticated project.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
          topic_id: { type: "string", format: "uuid" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
    },
    {
      name: "get_project_context",
      description:
        "Return the project-wide IR context from decided/executing judgment topics, topic relations, active IR nodes, and IR edges.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
          topic_id: { type: "string", format: "uuid" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
    },
    {
      name: "get_topic_context",
      description:
        "Return active IR for one judgment topic, optionally including upstream topic relation closure.",
      inputSchema: {
        type: "object",
        properties: {
          topic_id: { type: "string", format: "uuid" },
          include_relation_closure: { type: "boolean" },
        },
        required: ["topic_id"],
        additionalProperties: false,
      },
    },
    {
      name: "search_ir",
      description:
        "Search IR nodes in the authenticated project, optionally scoped to one judgment topic.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
          query: { type: "string" },
          topic_id: { type: "string", format: "uuid" },
        },
        required: ["project_id", "query"],
        additionalProperties: false,
      },
    },
    {
      name: "get_ir_node",
      description: "Load one IR node by id.",
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string" },
        },
        required: ["node_id"],
        additionalProperties: false,
      },
    },
    {
      name: "submit_candidate",
      description: "Submit a candidate decision for human review.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
          topic_id: { type: "string", format: "uuid" },
          proposed_title: { type: "string" },
          proposed_content: { type: "string" },
          proposed_kind: { type: "string" },
          proposed_rationale: { type: "string" },
          external_evidence: { type: "string" },
          source_metadata: {
            type: "object",
            additionalProperties: true,
          },
        },
        required: [
          "project_id",
          "topic_id",
          "proposed_title",
          "proposed_content",
          "proposed_kind",
        ],
        additionalProperties: false,
      },
    },
    {
      name: "create_decision",
      description:
        "Propose a new decision. Lands as a candidate in the user's review queue; becomes truth only after user confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
          topic_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          content: { type: "string" },
          kind: decisionKindJsonSchema,
          rationale: { type: "string" },
          weight: decisionWeightJsonSchema,
          relevant_message_ids: {
            type: "array",
            items: { type: "string", format: "uuid" },
          },
          code_anchors: {
            type: "array",
            items: codeAnchorJsonSchema,
          },
          agent: { type: "string" },
          session_id: { type: "string" },
        },
        required: [
          "project_id",
          "topic_id",
          "title",
          "content",
          "kind",
          "agent",
        ],
        additionalProperties: false,
      },
    },
    {
      name: "update_decision",
      description:
        "Propose an update to title, content, rationale, kind, weight, or code anchors of an existing decision. Lands as a candidate for user confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          decision_id: { type: "string", format: "uuid" },
          title: { type: "string" },
          content: { type: "string" },
          rationale: { type: "string" },
          kind: decisionKindJsonSchema,
          weight: decisionWeightJsonSchema,
          code_anchors: {
            type: "array",
            items: codeAnchorJsonSchema,
          },
          agent: { type: "string" },
          session_id: { type: "string" },
        },
        required: ["decision_id", "agent"],
        additionalProperties: false,
      },
    },
    {
      name: "archive_decision",
      description:
        "Propose archiving a decision. Lands as a candidate for user confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          decision_id: { type: "string", format: "uuid" },
          reason: { type: "string" },
          agent: { type: "string" },
          session_id: { type: "string" },
        },
        required: ["decision_id", "agent"],
        additionalProperties: false,
      },
    },
    {
      name: "supersede_decision",
      description:
        "Propose a replacement decision. On user confirmation the replacement is created, the old decision is marked superseded, and they are linked.",
      inputSchema: {
        type: "object",
        properties: {
          superseded_decision_id: { type: "string", format: "uuid" },
          new_title: { type: "string" },
          new_content: { type: "string" },
          new_rationale: { type: "string" },
          new_kind: decisionKindJsonSchema,
          new_weight: decisionWeightJsonSchema,
          new_code_anchors: {
            type: "array",
            items: codeAnchorJsonSchema,
          },
          reason: { type: "string" },
          agent: { type: "string" },
          session_id: { type: "string" },
        },
        required: [
          "superseded_decision_id",
          "new_title",
          "new_content",
          "reason",
          "agent",
        ],
        additionalProperties: false,
      },
    },
    {
      name: "resolve_open_question",
      description:
        "Propose resolving an active open question (answered, with an answer decision, or no longer relevant). Lands as a candidate for user confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          question_decision_id: { type: "string", format: "uuid" },
          resolution: {
            type: "string",
            enum: ["answered", "no_longer_relevant", "split"],
          },
          answer_kind: decisionKindJsonSchema,
          answer_title: { type: "string" },
          answer_content: { type: "string" },
          answer_rationale: { type: "string" },
          answer_code_anchors: {
            type: "array",
            items: codeAnchorJsonSchema,
          },
          agent: { type: "string" },
          session_id: { type: "string" },
        },
        required: ["question_decision_id", "resolution", "agent"],
        additionalProperties: false,
      },
    },
    {
      name: "create_edge",
      description:
        "Propose a relationship edge between two decisions in the same project. Lands as a candidate for user confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
          source_decision_id: { type: "string", format: "uuid" },
          target_decision_id: { type: "string", format: "uuid" },
          type: {
            type: "string",
            enum: [
              "supports",
              "contradicts",
              "blocks",
              "blocked_by",
              "depends_on",
              "supersedes",
              "resolves",
              "related_to",
            ],
          },
          agent: { type: "string" },
          session_id: { type: "string" },
        },
        required: [
          "project_id",
          "source_decision_id",
          "target_decision_id",
          "type",
          "agent",
        ],
        additionalProperties: false,
      },
    },
    {
      name: "delete_edge",
      description:
        "Propose deleting a decision relationship edge. Lands as a candidate for user confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          edge_id: { type: "string", format: "uuid" },
          reason: { type: "string" },
          agent: { type: "string" },
          session_id: { type: "string" },
        },
        required: ["edge_id", "agent"],
        additionalProperties: false,
      },
    },
  ];
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
  token: string
) {
  const apiKey = await authenticateProjectApiKey(token);

  if (!apiKey) {
    throw new ChatbotError(
      "unauthorized:chat",
      "API key is invalid or revoked"
    );
  }

  switch (name) {
    case "list_topics": {
      const input = listTopicsSchema.parse(args ?? {});
      return toolResult(
        await listMcpTopics({
          apiKey,
          projectId: input.project_id,
          status: input.status,
        })
      );
    }
    case "list_decisions": {
      const input = listDecisionsSchema.parse(args ?? {});
      return toolResult(
        await listMcpDecisions({
          apiKey,
          projectId: input.project_id,
          topicId: input.topic_id,
          kind: input.kind,
          status: input.status,
        })
      );
    }
    case "get_decision": {
      const input = getDecisionSchema.parse(args ?? {});
      return toolResult(
        await getMcpDecision({
          apiKey,
          decisionId: input.decision_id,
        })
      );
    }
    case "list_open_questions": {
      const input = getProjectContextSchema.parse(args ?? {});
      return toolResult(
        await listMcpDecisions({
          apiKey,
          projectId: input.project_id,
          topicId: input.topic_id,
          kind: "open_question",
          status: "active",
        })
      );
    }
    case "list_rejections": {
      const input = getProjectContextSchema.parse(args ?? {});
      return toolResult(
        await listMcpDecisions({
          apiKey,
          projectId: input.project_id,
          topicId: input.topic_id,
          kind: "rejection",
          status: "active",
        })
      );
    }
    case "get_project_context": {
      const input = getProjectContextSchema.parse(args ?? {});
      return toolResult(
        await getMcpProjectContext({
          apiKey,
          projectId: input.project_id,
          topicId: input.topic_id,
        })
      );
    }
    case "get_topic_context": {
      const input = getTopicContextSchema.parse(args ?? {});
      return toolResult(
        await getMcpTopicContext({
          apiKey,
          topicId: input.topic_id,
          includeRelationClosure: input.include_relation_closure,
        })
      );
    }
    case "search_ir": {
      const input = searchIRSchema.parse(args ?? {});
      return toolResult(
        await searchMcpIR({
          apiKey,
          projectId: input.project_id,
          query: input.query,
          topicId: input.topic_id,
        })
      );
    }
    case "get_ir_node": {
      const input = getIRNodeSchema.parse(args ?? {});
      return toolResult(
        await getMcpIRNode({
          apiKey,
          nodeId: input.node_id,
        })
      );
    }
    case "submit_candidate": {
      const input = submitCandidateSchema.parse(args ?? {});
      return toolResult(
        await submitMcpCandidate({
          apiKey,
          projectId: input.project_id,
          topicId: input.topic_id,
          proposedTitle: input.proposed_title,
          proposedContent: input.proposed_content,
          proposedKind: input.proposed_kind,
          proposedRationale: input.proposed_rationale,
          externalEvidence: input.external_evidence,
          sourceMetadata: input.source_metadata,
        })
      );
    }
    case "create_decision": {
      const input = createDecisionSchema.parse(args ?? {});
      return toolResult(
        await createMcpDecision({
          apiKey,
          projectId: input.project_id,
          topicId: input.topic_id,
          title: input.title,
          content: input.content,
          kind: input.kind,
          rationale: input.rationale,
          weight: input.weight,
          relevantMessageIds: input.relevant_message_ids,
          codeAnchors: input.code_anchors,
          agent: input.agent,
          sessionId: input.session_id,
        })
      );
    }
    case "update_decision": {
      const input = updateDecisionSchema.parse(args ?? {});
      return toolResult(
        await updateMcpDecision({
          apiKey,
          decisionId: input.decision_id,
          title: input.title,
          content: input.content,
          rationale: input.rationale,
          kind: input.kind,
          weight: input.weight,
          codeAnchors: input.code_anchors,
          agent: input.agent,
          sessionId: input.session_id,
        })
      );
    }
    case "archive_decision": {
      const input = archiveDecisionSchema.parse(args ?? {});
      return toolResult(
        await archiveMcpDecision({
          apiKey,
          decisionId: input.decision_id,
          reason: input.reason,
          agent: input.agent,
          sessionId: input.session_id,
        })
      );
    }
    case "supersede_decision": {
      const input = supersedeDecisionSchema.parse(args ?? {});
      return toolResult(
        await supersedeMcpDecision({
          apiKey,
          supersededDecisionId: input.superseded_decision_id,
          newTitle: input.new_title,
          newContent: input.new_content,
          newRationale: input.new_rationale,
          newKind: input.new_kind,
          newWeight: input.new_weight,
          newCodeAnchors: input.new_code_anchors,
          reason: input.reason,
          agent: input.agent,
          sessionId: input.session_id,
        })
      );
    }
    case "resolve_open_question": {
      const input = resolveOpenQuestionSchema.parse(args ?? {});
      return toolResult(
        await resolveMcpOpenQuestion({
          apiKey,
          questionDecisionId: input.question_decision_id,
          resolution: input.resolution,
          answerKind: input.answer_kind,
          answerTitle: input.answer_title,
          answerContent: input.answer_content,
          answerRationale: input.answer_rationale,
          answerCodeAnchors: input.answer_code_anchors,
          agent: input.agent,
          sessionId: input.session_id,
        })
      );
    }
    case "create_edge": {
      const input = createEdgeSchema.parse(args ?? {});
      return toolResult(
        await createMcpEdge({
          apiKey,
          projectId: input.project_id,
          sourceDecisionId: input.source_decision_id,
          targetDecisionId: input.target_decision_id,
          type: input.type,
          agent: input.agent,
          sessionId: input.session_id,
        })
      );
    }
    case "delete_edge": {
      const input = deleteEdgeSchema.parse(args ?? {});
      return toolResult(
        await deleteMcpEdge({
          apiKey,
          edgeId: input.edge_id,
          reason: input.reason,
          agent: input.agent,
          sessionId: input.session_id,
        })
      );
    }
    default:
      return null;
  }
}

async function handleRequest(payload: JsonRpcRequest, request: Request) {
  const id = payload.id ?? null;

  if (payload.jsonrpc !== "2.0") {
    return jsonRpcError(id, {
      code: -32_600,
      message: "Invalid JSON-RPC payload",
      status: 400,
    });
  }

  const method = payload.method;

  if (!method) {
    return jsonRpcError(id, {
      code: -32_600,
      message: "Missing JSON-RPC method",
      status: 400,
    });
  }

  if (method === "initialize") {
    const token = parseBearerToken(request);

    if (!token) {
      return jsonRpcError(id, {
        code: -32_001,
        message: "Missing API key",
        status: 401,
      });
    }

    const apiKey = await authenticateProjectApiKey(token);

    if (!apiKey) {
      return jsonRpcError(id, {
        code: -32_001,
        message: "API key is invalid or revoked",
        status: 401,
      });
    }

    return jsonRpcResult(id, {
      protocolVersion:
        typeof payload.params?.protocolVersion === "string"
          ? payload.params.protocolVersion
          : protocolVersion,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "zeno-mcp",
        version: "1.0.0",
      },
      instructions:
        "Read confirmed truth with the read tools. All write tools are candidate-first: every write lands as a candidate (requires_approval=true) and becomes truth only after the user confirms it in Zeno. Nothing you write takes effect immediately.",
    });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (method === "tools/list") {
    const token = parseBearerToken(request);

    if (!token) {
      return jsonRpcError(id, {
        code: -32_001,
        message: "Missing API key",
        status: 401,
      });
    }

    const apiKey = await authenticateProjectApiKey(token);

    if (!apiKey) {
      return jsonRpcError(id, {
        code: -32_001,
        message: "API key is invalid or revoked",
        status: 401,
      });
    }

    return jsonRpcResult(id, {
      tools: getToolDefinitions(),
    });
  }

  if (method === "tools/call") {
    const token = parseBearerToken(request);

    if (!token) {
      return jsonRpcError(id, {
        code: -32_001,
        message: "Missing API key",
        status: 401,
      });
    }

    const params = payload.params ?? {};
    const name = typeof params.name === "string" ? params.name : null;

    if (!name) {
      return jsonRpcError(id, {
        code: -32_602,
        message: "Missing tool name",
        status: 400,
      });
    }

    const args =
      params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};

    const result = await handleToolCall(name, args, token);

    if (!result) {
      return jsonRpcError(id, {
        code: -32_601,
        message: `Unknown tool: ${name}`,
        status: 404,
      });
    }

    return jsonRpcResult(id, result);
  }

  return jsonRpcError(id, {
    code: -32_601,
    message: `Method not found: ${method}`,
    status: 404,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (Array.isArray(body)) {
      if (body.length === 0) {
        return jsonRpcError(null, {
          code: -32_600,
          message: "Batch requests must not be empty",
          status: 400,
        });
      }

      const responses = await Promise.all(
        body.map(async (entry) => {
          const response = await handleRequest(
            entry as JsonRpcRequest,
            request
          );

          if (response.status === 202) {
            return null;
          }

          return response.json();
        })
      );

      return Response.json(responses.filter(Boolean));
    }

    return handleRequest(body as JsonRpcRequest, request);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonRpcError(null, {
        code: -32_602,
        message: "Invalid MCP tool arguments",
        data: error.flatten(),
        status: 400,
      });
    }

    if (error instanceof ChatbotError) {
      return jsonRpcError(null, {
        code:
          error.statusCode === 401
            ? -32_001
            : error.statusCode === 403
              ? -32_003
              : -32_000,
        message: error.cause ? String(error.cause) : error.message,
        status: error.statusCode,
      });
    }

    console.error("MCP request failed", error);
    return jsonRpcError(null, {
      code: -32_603,
      message: "Internal MCP server error",
      status: 500,
    });
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
    },
  });
}
