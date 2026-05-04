/**
 * ZENO MCP route
 *
 * V1 boundary: external agents may only READ confirmed truth and WRITE
 * candidate_decisions through submit_candidate. They must never mutate
 * decisions, edges, or decision_log directly from MCP.
 */

import { z } from "zod";
import { ChatbotError } from "@/lib/errors";
import { authenticateProjectApiKey } from "@/lib/mcp/api-keys";
import {
  getMcpDecision,
  getMcpProjectContext,
  listMcpDecisions,
  listMcpTopics,
  submitMcpCandidate,
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

function getToolDefinitions() {
  return [
    {
      name: "list_topics",
      description: "List topics for the authenticated project.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", format: "uuid" },
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
        "Return project truth, active open questions, rejections, and serialized context for one project or topic.",
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
      name: "submit_candidate",
      description:
        "Submit a candidate decision for human review. This is the only MCP write path in V1.",
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
        "Read confirmed truth via the read-only tools. Submit new findings through submit_candidate only.",
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
