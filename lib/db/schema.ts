import { type InferSelectModel, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const chat = pgTable("Chat", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  createdAt: timestamp("createdAt").notNull(),
  title: text("title").notNull(),
  userId: uuid("userId").notNull(),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
});

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable("Message_v2", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  role: varchar("role").notNull(),
  parts: json("parts").notNull(),
  attachments: json("attachments").notNull(),
  createdAt: timestamp("createdAt").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    messageId: uuid("messageId")
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean("isUpvoted").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.messageId] }),
  })
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  "Document",
  {
    id: uuid("id").notNull().defaultRandom(),
    createdAt: timestamp("createdAt").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    kind: varchar("text", { enum: ["text", "code", "image", "sheet"] })
      .notNull()
      .default("text"),
    userId: uuid("userId").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.createdAt] }),
  })
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  "Suggestion",
  {
    id: uuid("id").notNull().defaultRandom(),
    documentId: uuid("documentId").notNull(),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    description: text("description"),
    isResolved: boolean("isResolved").notNull().default(false),
    userId: uuid("userId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  })
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  "Stream",
  {
    id: uuid("id").notNull().defaultRandom(),
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
  })
);

export type Stream = InferSelectModel<typeof stream>;

export const project = pgTable("projects", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Project = InferSelectModel<typeof project>;

export const topic = pgTable("topics", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  isGeneral: boolean("is_general").notNull().default(false),
  status: text("status").notNull().default("exploring"),
  description: text("description"),
  defaultModelId: text("default_model_id"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  executingAt: timestamp("executing_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Topic = InferSelectModel<typeof topic>;

export const topicRelation = pgTable(
  "topic_relations",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    fromTopicId: uuid("from_topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    toTopicId: uuid("to_topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    noSelfLoop: check(
      "topic_relations_no_self_loop",
      sql`${table.fromTopicId} <> ${table.toTopicId}`
    ),
    uniqueRelation: uniqueIndex("topic_relations_unique_relation").on(
      table.fromTopicId,
      table.toTopicId,
      table.relationType
    ),
  })
);

export type TopicRelation = InferSelectModel<typeof topicRelation>;

export const projectUserViewState = pgTable(
  "project_user_view_state",
  {
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.projectId] }),
  })
);

export type ProjectUserViewState = InferSelectModel<
  typeof projectUserViewState
>;

export const conversation = pgTable("conversations", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  topicId: uuid("topic_id")
    .notNull()
    .references(() => topic.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Conversation = InferSelectModel<typeof conversation>;

export const workspaceMessage = pgTable("messages", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id")
    .notNull()
    .references(() => topic.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WorkspaceMessage = InferSelectModel<typeof workspaceMessage>;

export const decision = pgTable("decisions", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id),
  topicId: uuid("topic_id")
    .notNull()
    .references(() => topic.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  rationale: text("rationale"),
  kind: text("kind").notNull().default("plan"),
  weight: text("weight").notNull().default("normal"),
  status: text("status").notNull().default("active"),
  sensitivity: text("sensitivity").notNull().default("normal"),
  relevantMessageIds: uuid("relevant_message_ids").array(),
  codeAnchors: jsonb("code_anchors"),
  createdFromMessageId: uuid("created_from_message_id").references(
    () => workspaceMessage.id
  ),
  confirmedByUserId: uuid("confirmed_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Decision = InferSelectModel<typeof decision>;

export const edge = pgTable("edges", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id),
  topicId: uuid("topic_id")
    .notNull()
    .references(() => topic.id),
  sourceDecisionId: uuid("source_decision_id")
    .notNull()
    .references(() => decision.id),
  targetDecisionId: uuid("target_decision_id")
    .notNull()
    .references(() => decision.id),
  type: text("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Edge = InferSelectModel<typeof edge>;

export const candidateDecisionSources = [
  "zeno_extraction",
  "mcp_agent",
  "manual",
] as const;

export type CandidateDecisionSource = (typeof candidateDecisionSources)[number];

export const candidateDecision = pgTable("candidate_decisions", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id),
  topicId: uuid("topic_id")
    .notNull()
    .references(() => topic.id),
  conversationId: uuid("conversation_id").references(() => conversation.id),
  messageId: uuid("message_id").references(() => workspaceMessage.id),
  proposedTitle: text("proposed_title"),
  proposedContent: text("proposed_content").notNull(),
  proposedRationale: text("proposed_rationale"),
  proposedKind: text("proposed_kind").default("plan"),
  proposedWeight: text("proposed_weight").default("normal"),
  proposedForDecisionId: uuid("proposed_for_decision_id").references(
    () => decision.id
  ),
  proposedStatus: text("proposed_status"),
  proposedIntent: text("proposed_intent"),
  confidence: real("confidence"),
  preSelected: boolean("pre_selected").notNull().default(true),
  status: text("status").notNull().default("pending"),
  suggestedEdges: jsonb("suggested_edges"),
  relevantMessageIds: uuid("relevant_message_ids").array(),
  contentHash: text("content_hash"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedDecisionId: uuid("resolved_decision_id").references(
    () => decision.id
  ),
  source: text("source").notNull().default("zeno_extraction"),
  sourceMetadata: jsonb("source_metadata"),
  externalEvidence: text("external_evidence"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CandidateDecision = InferSelectModel<typeof candidateDecision>;

export const decisionLog = pgTable("decision_log", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  decisionId: uuid("decision_id").references(() => decision.id),
  candidateId: uuid("candidate_id").references(() => candidateDecision.id),
  action: text("action").notNull(),
  actorType: text("actor_type").notNull().default("user"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DecisionLog = InferSelectModel<typeof decisionLog>;

export const apiKey = pgTable("api_keys", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id").notNull(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  label: text("label"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ApiKey = InferSelectModel<typeof apiKey>;

export const irNode = pgTable("ir_nodes", {
  id: text("id").primaryKey().notNull(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").references(() => topic.id, {
    onDelete: "set null",
  }),
  // Optional hierarchy: a node can be a sub-node of another IR node. Self-ref
  // FK; deleting a parent detaches children (set null) rather than cascading.
  parentId: text("parent_id").references((): AnyPgColumn => irNode.id, {
    onDelete: "set null",
  }),
  kind: text("kind").notNull(),
  subtype: text("subtype"),
  status: text("status").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  rationale: text("rationale"),
  sensitivity: text("sensitivity").notNull().default("normal"),
  sourceChatId: uuid("source_chat_id"),
  sourceTurnId: uuid("source_turn_id"),
  sourceTextSpan: text("source_text_span"),
  sourceLayer: text("source_layer"),
  importSessionId: uuid("import_session_id"),
  reactivationAnchorId: text("reactivation_anchor_id"),
  extractionConfidence: real("extraction_confidence"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  promotedToPendingAt: timestamp("promoted_to_pending_at", {
    withTimezone: true,
  }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  supersededBy: text("superseded_by"),
  createdBy: text("created_by").notNull(),
  confirmedBy: uuid("confirmed_by"),
});

export type IRNodeRow = InferSelectModel<typeof irNode>;

export const irEdge = pgTable("ir_edges", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  fromNode: text("from_node")
    .notNull()
    .references(() => irNode.id),
  toNode: text("to_node")
    .notNull()
    .references(() => irNode.id),
  relation: text("relation").notNull(),
  status: text("status").notNull().default("pending"),
  isAnchorHint: boolean("is_anchor_hint").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

export type IREdgeRow = InferSelectModel<typeof irEdge>;

export const irExtractionEvent = pgTable("ir_extraction_events", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  projectId: uuid("project_id").references(() => project.id, {
    onDelete: "cascade",
  }),
  topicId: uuid("topic_id").references(() => topic.id, {
    onDelete: "set null",
  }),
  nodeId: text("node_id").references(() => irNode.id),
  edgeId: uuid("edge_id").references(() => irEdge.id, {
    onDelete: "set null",
  }),
  event: text("event").notNull(),
  layer: text("layer").notNull().default("system"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type IRExtractionEvent = InferSelectModel<typeof irExtractionEvent>;

export const chatSessionState = pgTable("chat_session_state", {
  chatSessionId: uuid("chat_session_id")
    .primaryKey()
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  reactivationAnchorId: text("reactivation_anchor_id").references(
    () => irNode.id
  ),
  reactivationAnchorSetAtTurn: integer("reactivation_anchor_set_at_turn"),
  lastSweepAtTurn: integer("last_sweep_at_turn").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ChatSessionState = InferSelectModel<typeof chatSessionState>;
