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
      <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        {id}
      </span>
    );
  }

  if (node.status === "dismissed") {
    return (
      <span className="text-muted-foreground" title={node.title}>
        {truncateIRTitle(node.title, 40)}
      </span>
    );
  }

  const label = `${node.id} · ${truncateIRTitle(node.title, 40)}`;

  return (
    <button
      className={cn(
        "inline cursor-pointer align-baseline font-medium",
        node.status === "active" &&
          "text-blue-600 underline-offset-2 hover:underline",
        node.status === "pending" &&
          "rounded border border-dashed border-blue-300 bg-blue-100 px-1.5 py-0.5 text-blue-900",
        node.status === "superseded" && "text-muted-foreground line-through",
        node.status === "idea" && "text-muted-foreground"
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
