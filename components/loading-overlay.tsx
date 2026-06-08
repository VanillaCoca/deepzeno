"use client";

/**
 * Full-page frosted-glass loading veil with a centered "thinking"-style
 * shimmer message (ChatGPT/Claude feel). While shown it covers the whole
 * viewport and swallows pointer events, so the user can SEE that ZENO is still
 * working and cannot interact until the workspace is ready.
 */
export function LoadingOverlay({
  message,
  show,
  submessage,
}: {
  message: string;
  show: boolean;
  submessage?: string;
}) {
  if (!show) {
    return null;
  }

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="fixed inset-0 z-[70] flex cursor-progress flex-col items-center justify-center gap-2.5 bg-background/70 backdrop-blur-md animate-[fade-in_0.2s_ease]"
      data-testid="loading-overlay"
    >
      <p className="z-shimmer-text text-base font-medium tracking-tight">
        {message}
      </p>
      {submessage ? (
        <p className="text-xs text-muted-foreground/70">{submessage}</p>
      ) : null}
    </div>
  );
}
