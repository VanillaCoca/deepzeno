"use client";

import { toast } from "@/components/chat/toast";
import { ChatbotError } from "@/lib/errors";

/**
 * Renders a 402 as what it actually is: a door, not a wall.
 *
 * Every other error in the product is either the product's fault or something
 * the user cannot do anything about in the next thirty seconds. A refusal for
 * money is the exception — the allowance is out, or the watch quota is full,
 * and connecting a provider key fixes both immediately. It is also the only
 * moment the cost model asks anything of the user, so it is the one error
 * worth building a control for.
 *
 * Two departures from an ordinary error toast:
 *
 *   - It does not fade. The allowance does not refill four seconds later, so a
 *     message that disappears on that timer describes a state that has not
 *     changed and leaves the user re-sending a message to re-read it.
 *   - It carries the action. The sentence already says to connect a key; the
 *     button is the product doing what it just told the user to go do.
 *
 * The label is English on purpose. `getMessageByErrorCode` is not localized,
 * so the sentence beside the button is English in every locale — a translated
 * button next to an untranslated sentence reads worse than either.
 *
 * Returns false when the error is something else, so callers keep their own
 * fallback and nothing is swallowed on the way past.
 */
export function toastBillingRefusal(
  error: unknown,
  openProviderKeys?: () => void
): boolean {
  if (!(error instanceof ChatbotError) || error.type !== "payment_required") {
    return false;
  }

  toast({
    type: "error",
    description: error.message,
    persistent: true,
    // Offered only when something is actually mounted to open. A button that
    // does nothing is worse than the sentence alone.
    action: openProviderKeys
      ? { label: "Connect a key", onClick: openProviderKeys }
      : undefined,
  });

  return true;
}
