"use client";

import { computeRedline } from "@/lib/ir/redline";
import { cn } from "@/lib/utils";

// Renders a sentence-level redline: deletions struck through, insertions
// tinted. The old truth is reconstructable as unchanged+deleted, the proposed
// one as unchanged+inserted (PRD K4 / JI-02).
export function Redline({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const segments = computeRedline(oldText, newText);
  let offset = 0;

  return (
    <p className="whitespace-pre-wrap text-[13px] leading-[1.65]">
      {segments.map((segment) => {
        const key = `${segment.type}-${offset}`;
        offset += segment.text.length;

        return (
          <span
            className={cn(
              segment.type === "deleted" &&
                "text-rose-500/80 line-through decoration-rose-500/40",
              segment.type === "inserted" &&
                "text-emerald-600 dark:text-emerald-400",
              segment.type === "unchanged" && "text-[var(--ir-text-secondary)]"
            )}
            key={key}
          >
            {segment.text}
          </span>
        );
      })}
    </p>
  );
}
