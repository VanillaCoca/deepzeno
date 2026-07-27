"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import type { ReEntryOverlay } from "@/lib/workspace/re-entry-overlay-core";
import { shouldAdvanceWatermark } from "@/lib/workspace/re-entry-overlay-core";

/**
 * Owns the re-entry overlay's data and, more importantly, its watermark timing
 * (修订案 №4 §2.5).
 *
 * The watermark advances when the diff has been READ, not when the panel
 * opened. Advancing on open means switching tabs mid-read silently destroys the
 * unread remainder with no way to get it back — the user is told "nothing
 * changed" the next time, and that is the exact failure the overlay exists to
 * prevent. `shouldAdvanceWatermark` encodes the rule; it is unit-tested, and
 * this hook is the only caller that can violate it.
 *
 * The pagehide fallback stays because closing the tab is also "done looking".
 * Without it a user who reads the diff and leaves would be shown the same diff
 * forever.
 */
export function useReEntryOverlay(projectId: string | null) {
  const [dismissed, setDismissed] = useState(false);

  const url = projectId
    ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${projectId}/re-entry`
    : null;

  const { data } = useSWR<{ overlay: ReEntryOverlay | null }>(url, fetcher, {
    revalidateOnFocus: false,
  });

  // A different project is a different diff — never carry a dismissal across.
  useEffect(() => {
    setDismissed(false);
  }, [projectId]);

  const markSeen = useCallback(() => {
    if (!projectId) {
      return;
    }

    const markUrl = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/projects/${projectId}/re-entry/mark-seen`;

    // keepalive so the write survives the navigation that triggered it.
    fetch(markUrl, { keepalive: true, method: "POST" }).catch(() => undefined);
  }, [projectId]);

  const dismiss = useCallback(() => {
    setDismissed(true);

    if (shouldAdvanceWatermark("overlay_dismissed")) {
      markSeen();
    }
  }, [markSeen]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    function onPageHide() {
      markSeen();
    }

    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [projectId, markSeen]);

  return {
    // Dismissal is applied here rather than sent to the server: §2.1's
    // `dismissedInSession` is a client-session fact, and a round trip to
    // re-learn something we already know would only add a flash of the overlay
    // reappearing before the refetch settles.
    overlay: dismissed ? null : (data?.overlay ?? null),
    dismiss,
  };
}
