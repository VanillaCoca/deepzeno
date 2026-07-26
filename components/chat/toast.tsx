"use client";

import { XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast as sonnerToast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckCircleFillIcon, WarningIcon } from "./icons";

const iconsByType: Record<"success" | "error", ReactNode> = {
  success: <CheckCircleFillIcon />,
  error: <WarningIcon />,
};

export function toast(props: Omit<ToastProps, "id">) {
  return sonnerToast.custom(
    (id) => (
      <Toast
        action={props.action}
        description={props.description}
        id={id}
        persistent={props.persistent}
        type={props.type}
      />
    ),
    // `persistent` is a claim about the world, not about the animation. A
    // toast that fades after four seconds while the condition it describes is
    // still true leaves the user re-triggering the same failure just to read
    // the explanation again.
    props.persistent ? { duration: Number.POSITIVE_INFINITY } : undefined
  );
}

function Toast(props: ToastProps) {
  const { id, type, description, action, persistent } = props;

  const descriptionRef = useRef<HTMLDivElement>(null);
  const [multiLine, setMultiLine] = useState(false);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) {
      return;
    }

    const update = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      const lines = Math.round(el.scrollHeight / lineHeight);
      setMultiLine(lines > 1);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  const stacked = multiLine || Boolean(action) || Boolean(persistent);

  return (
    <div className="flex toast-mobile:w-[356px] w-full justify-center">
      <div
        className={cn(
          "flex toast-mobile:w-fit w-full flex-row gap-3 rounded-lg bg-card border border-border/50 shadow-[var(--shadow-float)] p-3",
          stacked ? "items-start" : "items-center"
        )}
        data-testid="toast"
        key={id}
      >
        <div
          className={cn(
            "data-[type=error]:text-red-600 data-[type=success]:text-green-600",
            { "pt-1": stacked }
          )}
          data-type={type}
        >
          {iconsByType[type]}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="text-sm text-foreground" ref={descriptionRef}>
            {description}
          </div>
          {action ? (
            <div>
              <Button
                onClick={() => {
                  // Dismissed first: what it opens is a modal that covers this
                  // corner, and a toast counting down behind it is a second
                  // thing moving while the user is trying to read the first.
                  sonnerToast.dismiss(id);
                  action.onClick();
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {action.label}
              </Button>
            </div>
          ) : null}
        </div>
        {persistent ? (
          <Button
            aria-label="Dismiss"
            className="-mt-1 -mr-1 text-muted-foreground"
            onClick={() => sonnerToast.dismiss(id)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type ToastProps = {
  id: string | number;
  type: "success" | "error";
  description: string;
  /**
   * The one next step this failure has, when it has one. Rendered as a button
   * beside the sentence rather than described inside it: "in Settings" is a
   * scavenger hunt when the product already knows which door to open.
   */
  action?: { label: string; onClick: () => void };
  /**
   * Set when the condition being reported does not clear by itself. Holds the
   * toast open until dismissed, and adds the control that dismisses it — an
   * undismissable permanent toast is its own bug.
   */
  persistent?: boolean;
};
