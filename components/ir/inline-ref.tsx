"use client";

import useSWR from "swr";
import { irNodeKey, useIR } from "@/components/ir/ir-provider";
import type { IRDetail } from "@/lib/ir/types";
import { truncateIRTitle } from "@/lib/ir/types";
import { cn, fetcher } from "@/lib/utils";

export function InlineRef({ id }: { id: string }) {
  const { selectNode } = useIR();
  const { data } = useSWR<IRDetail>(irNodeKey(id), fetcher, {
    revalidateOnFocus: false,
  });
  const node = data?.node;

  if (!node) {
    return (
      <span className="inline-flex rounded px-1.5 py-0.5 text-xs text-[var(--ir-text-tertiary)]">
        {id}
      </span>
    );
  }

  if (node.status === "dismissed") {
    return (
      <span className="text-[var(--ir-text-tertiary)]" title={node.title}>
        {truncateIRTitle(node.title, 40)}
      </span>
    );
  }

  const label = `${node.id} · ${truncateIRTitle(node.title, 40)}`;

  return (
    <button
      className={cn(
        "inline cursor-pointer align-baseline font-medium underline-offset-2",
        node.status === "active" &&
          "text-[var(--ir-accent-blue)] hover:underline",
        node.status === "pending" &&
          "rounded border border-dashed border-[var(--ir-accent-blue-border)] bg-[var(--ir-accent-blue-bg)] px-1.5 py-0.5 text-[var(--ir-accent-blue)]",
        node.status === "superseded" &&
          "text-[var(--ir-text-tertiary)] line-through",
        node.status === "idea" && "text-[var(--ir-text-tertiary)]"
      )}
      onClick={() => selectNode(node.id)}
      title={node.title}
      type="button"
    >
      {node.status === "pending" ? "◇ " : ""}
      {label}
    </button>
  );
}
