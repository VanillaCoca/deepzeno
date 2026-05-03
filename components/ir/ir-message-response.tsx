"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { InlineRef } from "@/components/ir/inline-ref";

const INLINE_REF_RE = /<inline-ref\s+id=["']([^"']+)["']\s*\/>/g;

export function IRMessageResponse({ children }: { children: string }) {
  const parts: Array<
    | { key: string; type: "text"; value: string }
    | { id: string; key: string; type: "ref" }
  > = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = INLINE_REF_RE.exec(children);

  while (match) {
    if (match.index > lastIndex) {
      parts.push({
        key: `text-${lastIndex}`,
        type: "text",
        value: children.slice(lastIndex, match.index),
      });
    }

    parts.push({
      id: match[1],
      key: `ref-${match.index}-${match[1]}`,
      type: "ref",
    });
    lastIndex = match.index + match[0].length;
    match = INLINE_REF_RE.exec(children);
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
        ) : (
          <span key={part.key}>{part.value}</span>
        )
      )}
    </span>
  );
}
