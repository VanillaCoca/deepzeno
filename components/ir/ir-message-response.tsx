"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { InlineRef } from "@/components/ir/inline-ref";

const INLINE_MARKER_RE =
  /<inline-ref\s+id=["']([^"']+)["']\s*\/>|\[\[ir:([^[\]]+)\]\](?:\[\[rel:[^[\]]+\]\])*/g;

function getInlineMarkerTitle(rawBody: string) {
  const fields: string[] = [];
  let current = "";

  for (let index = 0; index < rawBody.length; index += 1) {
    const char = rawBody[index];
    const next = rawBody[index + 1];

    if (char === "\\" && next) {
      current += next;
      index += 1;
      continue;
    }

    if (char === "|") {
      fields.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields[1] || "candidate";
}

export function IRMessageResponse({ children }: { children: string }) {
  const parts: Array<
    | { key: string; type: "text"; value: string }
    | { key: string; title: string; type: "marker" }
    | { id: string; key: string; type: "ref" }
  > = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = INLINE_MARKER_RE.exec(children);

  while (match) {
    if (match.index > lastIndex) {
      parts.push({
        key: `text-${lastIndex}`,
        type: "text",
        value: children.slice(lastIndex, match.index),
      });
    }

    if (match[1]) {
      parts.push({
        id: match[1],
        key: `ref-${match.index}-${match[1]}`,
        type: "ref",
      });
    } else if (match[2]) {
      parts.push({
        key: `marker-${match.index}`,
        title: getInlineMarkerTitle(match[2]),
        type: "marker",
      });
    }

    lastIndex = match.index + match[0].length;
    match = INLINE_MARKER_RE.exec(children);
  }

  if (lastIndex < children.length) {
    parts.push({
      key: `text-${lastIndex}`,
      type: "text",
      value: children.slice(lastIndex),
    });
  }

  if (parts.length === 0 || parts.every((part) => part.type === "text")) {
    return <MessageResponse>{children}</MessageResponse>;
  }

  return (
    <span className="whitespace-pre-wrap leading-7">
      {parts.map((part) =>
        part.type === "ref" ? (
          <InlineRef id={part.id} key={part.key} />
        ) : part.type === "marker" ? (
          <span
            className="inline-flex rounded border border-dashed border-blue-300 bg-blue-100 px-1.5 py-0.5 align-baseline font-medium text-blue-900 text-xs"
            key={part.key}
            title="Candidate marker is being saved to ZENO"
          >
            ◇ {part.title}
          </span>
        ) : (
          <span key={part.key}>{part.value}</span>
        )
      )}
    </span>
  );
}
