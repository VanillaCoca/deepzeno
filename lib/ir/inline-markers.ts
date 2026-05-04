import "server-only";

import type { ChatMessage } from "@/lib/types";
import {
  createIRNodeForUser,
  findDuplicateIRCandidate,
  getIRNodeById,
} from "./queries";
import {
  type IRKind,
  type IRPlanSubtype,
  type IRRelation,
  irKinds,
  irPlanSubtypes,
  irRelations,
} from "./types";

type InlineRelationMarker = {
  relation: IRRelation;
  toNode: string;
};

type InlineIRMarker = {
  raw: string;
  kind: IRKind;
  subtype: IRPlanSubtype | null;
  title: string;
  rationale: string | null;
  relations: InlineRelationMarker[];
};

type ParsedMarker = {
  endIndex: number;
  marker: InlineIRMarker | null;
  startIndex: number;
};

const NODE_ID_RE = /^[A-Z]\d+$/;

function isEscaped(value: string, index: number) {
  let slashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && value[cursor] === "\\") {
    slashCount += 1;
    cursor -= 1;
  }

  return slashCount % 2 === 1;
}

function findMarkerEnd(value: string, startIndex: number) {
  let cursor = startIndex;

  while (cursor < value.length - 1) {
    if (
      value[cursor] === "]" &&
      value[cursor + 1] === "]" &&
      !isEscaped(value, cursor)
    ) {
      return cursor;
    }

    cursor += 1;
  }

  return -1;
}

function unescapeMarkerField(value: string) {
  return value
    .replaceAll("\\|", "|")
    .replaceAll("\\]\\]", "]]")
    .replaceAll("\\\\", "\\")
    .trim();
}

function splitEscaped(value: string) {
  const parts: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (char === "\\" && next) {
      current += char + next;
      index += 1;
      continue;
    }

    if (char === "|") {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts.map(unescapeMarkerField);
}

function normalizeKindHeader(header: string) {
  const [kindValue, subtypeValue] = header.split(":");

  if (!(irKinds as readonly string[]).includes(kindValue)) {
    return null;
  }

  const kind = kindValue as IRKind;

  if (kind === "unclassified") {
    return null;
  }

  if (kind === "plan") {
    if (
      !subtypeValue ||
      !(irPlanSubtypes as readonly string[]).includes(subtypeValue)
    ) {
      return null;
    }

    return { kind, subtype: subtypeValue as IRPlanSubtype };
  }

  if (subtypeValue) {
    return null;
  }

  return { kind, subtype: null };
}

function parseIRMarkerBody(body: string) {
  const fields = splitEscaped(body);
  const header = fields[0];
  const title = fields[1]?.trim();
  const rationale = fields[2]?.trim() || null;
  const normalized = normalizeKindHeader(header);

  if (!(normalized && title && title.length <= 200)) {
    return null;
  }

  if (rationale && rationale.length > 1000) {
    return null;
  }

  return {
    kind: normalized.kind,
    subtype: normalized.subtype,
    title,
    rationale,
  };
}

function parseRelationMarkerBody(body: string) {
  const [relationValue, targetId] = splitEscaped(body);

  if (
    !(irRelations as readonly string[]).includes(relationValue) ||
    !NODE_ID_RE.test(targetId)
  ) {
    return null;
  }

  return {
    relation: relationValue as IRRelation,
    toNode: targetId,
  };
}

function parseInlineMarkerAt(value: string, startIndex: number): ParsedMarker {
  const irPrefix = "[[ir:";

  if (!value.startsWith(irPrefix, startIndex)) {
    return { endIndex: startIndex + 1, marker: null, startIndex };
  }

  const irBodyStart = startIndex + irPrefix.length;
  const irEnd = findMarkerEnd(value, irBodyStart);

  if (irEnd < 0) {
    return { endIndex: startIndex + 1, marker: null, startIndex };
  }

  const parsedIR = parseIRMarkerBody(value.slice(irBodyStart, irEnd));

  if (!parsedIR) {
    return { endIndex: irEnd + 2, marker: null, startIndex };
  }

  const relations: InlineRelationMarker[] = [];
  let cursor = irEnd + 2;
  const relPrefix = "[[rel:";

  while (value.startsWith(relPrefix, cursor)) {
    const relBodyStart = cursor + relPrefix.length;
    const relEnd = findMarkerEnd(value, relBodyStart);

    if (relEnd < 0) {
      break;
    }

    const relation = parseRelationMarkerBody(value.slice(relBodyStart, relEnd));

    if (relation) {
      relations.push(relation);
    }

    cursor = relEnd + 2;
  }

  return {
    endIndex: cursor,
    marker: {
      ...parsedIR,
      raw: value.slice(startIndex, cursor),
      relations,
    },
    startIndex,
  };
}

async function keepValidRelations({
  projectId,
  relations,
}: {
  projectId: string;
  relations: InlineRelationMarker[];
}) {
  const validRelations: InlineRelationMarker[] = [];

  for (const relation of relations) {
    const target = await getIRNodeById(relation.toNode);

    if (target?.projectId === projectId) {
      validRelations.push(relation);
    }
  }

  return validRelations;
}

async function createNodeFromMarker({
  conversationId,
  marker,
  messageId,
  projectId,
  topicId,
  userId,
}: {
  conversationId: string;
  marker: InlineIRMarker;
  messageId: string;
  projectId: string;
  topicId: string;
  userId: string;
}) {
  const duplicate = await findDuplicateIRCandidate({
    projectId,
    kind: marker.kind,
    subtype: marker.subtype,
    title: marker.title,
  });

  if (duplicate) {
    return duplicate;
  }

  const relations = await keepValidRelations({
    projectId,
    relations: marker.relations,
  });

  return createIRNodeForUser({
    userId,
    projectId,
    topicId,
    kind: marker.kind,
    subtype: marker.subtype,
    title: marker.title,
    content: marker.title,
    rationale: marker.rationale,
    sourceChatId: conversationId,
    sourceTurnId: messageId,
    sourceTextSpan: marker.raw,
    sourceLayer: "inline",
    createdBy: "ai",
    initialStatus: "pending",
    extractionConfidence: 0.9,
    relations: relations.map((relation) => ({
      relation: relation.relation,
      toNode: relation.toNode,
    })),
  });
}

async function persistMarkersInText({
  conversationId,
  messageId,
  projectId,
  text,
  topicId,
  userId,
}: {
  conversationId: string;
  messageId: string;
  projectId: string;
  text: string;
  topicId: string;
  userId: string;
}) {
  let cursor = 0;
  let output = "";
  let changed = false;
  let markersCreated = 0;

  while (cursor < text.length) {
    const nextMarkerStart = text.indexOf("[[ir:", cursor);

    if (nextMarkerStart < 0) {
      output += text.slice(cursor);
      break;
    }

    output += text.slice(cursor, nextMarkerStart);
    const parsed = parseInlineMarkerAt(text, nextMarkerStart);

    if (!parsed.marker) {
      output += text.slice(nextMarkerStart, parsed.endIndex);
      cursor = parsed.endIndex;
      continue;
    }

    try {
      const node = await createNodeFromMarker({
        conversationId,
        marker: parsed.marker,
        messageId,
        projectId,
        topicId,
        userId,
      });
      output += `<inline-ref id="${node.id}"/>`;
      changed = true;
      markersCreated += 1;
    } catch (error) {
      console.warn("Inline IR marker persistence failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      output += parsed.marker.raw;
    }

    cursor = parsed.endIndex;
  }

  return { changed, markersCreated, text: output };
}

export async function persistInlineIRMarkersForMessages({
  conversationId,
  messages,
  projectId,
  topicId,
  userId,
}: {
  conversationId: string;
  messages: ChatMessage[];
  projectId: string;
  topicId: string;
  userId: string;
}) {
  let changed = false;
  let markersCreated = 0;
  const nextMessages: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      nextMessages.push(message);
      continue;
    }

    const nextParts: ChatMessage["parts"] = [];

    for (const part of message.parts) {
      if (part.type !== "text") {
        nextParts.push(part);
        continue;
      }

      const result = await persistMarkersInText({
        conversationId,
        messageId: message.id,
        projectId,
        text: part.text,
        topicId,
        userId,
      });

      changed = changed || result.changed;
      markersCreated += result.markersCreated;
      nextParts.push({ ...part, text: result.text });
    }

    nextMessages.push({ ...message, parts: nextParts });
  }

  return {
    changed,
    markersCreated,
    messages: changed ? nextMessages : messages,
  };
}
