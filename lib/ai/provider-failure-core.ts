// Why a provider call failed — specifically, whether the failure says
// something about the CREDENTIAL or about the ENDPOINT.
//
// Before BYOK that distinction did not exist, because every call ran on the
// operator's keys and every failure had the same owner: a 401 and a 503 both
// meant "this provider is not serving us right now", and the only sensible
// response to either was to trip the breaker and try somewhere else.
//
// With user-supplied keys the two failures have different owners and opposite
// correct responses:
//
//   - A 401 on a USER's key is one tenant's revoked credential. Tripping the
//     shared breaker on it lets one user's bad key open the circuit for
//     everyone; degrading to another provider silently moves that user's spend
//     onto the platform allowance, which is the exact misattribution the whole
//     cost model exists to prevent. The right response is to stop, mark the key,
//     and say so.
//   - A 503 on the same key is the provider having a bad day, which is what the
//     breaker and the degrade path were built for.
//
// Pure and dependency-free so `tsx --test` can import it, and duck-typed rather
// than `APICallError.isInstance` so that a provider SDK throwing its own error
// class still classifies correctly.

export type ProviderFailureKind =
  /** The credential itself was refused, or cannot fund the call. */
  | "credential"
  /** Real key, real endpoint, too many requests. Says nothing about either. */
  | "capacity"
  /** Everything else: outages, timeouts, malformed requests, unknown. */
  | "endpoint";

export type ProviderFailure = {
  kind: ProviderFailureKind;
  statusCode: number | null;
  /**
   * One sentence, safe to persist and to render.
   *
   * Synthesized from the status code and the provider name only — never from
   * the response body. Provider error bodies routinely echo request context,
   * and this string is written to `provider_keys.last_error`, which the
   * settings dialog renders back to the user. A body that happened to contain
   * a key prefix would be stored in plaintext forever.
   */
  reason: string;
};

type ApiCallErrorLike = {
  name?: unknown;
  url?: unknown;
  statusCode?: unknown;
};

/**
 * `statusCode` alone is not enough evidence.
 *
 * `ChatbotError` also carries a `statusCode`, and one of its codes is 402 —
 * so an allowance error bubbling through a model call would otherwise be read
 * as "the user's key is out of credit" and would disable a perfectly good key.
 * Requiring the shape of an HTTP call error keeps the classifier's input to
 * things that actually came back from a provider.
 */
function httpStatusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as ApiCallErrorLike;
  const looksLikeApiCall =
    candidate.name === "AI_APICallError" || typeof candidate.url === "string";

  if (!looksLikeApiCall) {
    return null;
  }

  return typeof candidate.statusCode === "number" ? candidate.statusCode : null;
}

/**
 * Statuses that are positive evidence the credential cannot serve the call.
 *
 * The same narrow set `lib/billing/validate-key.ts` uses, plus 402. Narrow on
 * purpose: 404 means we asked the wrong question, 5xx means the provider is
 * having a bad day, 400 means we sent something malformed. Reading any of
 * those as "your key is bad" would disable a working key — Iron Law 2 cuts
 * against *making things up* more than against missing them, and a wrongly
 * disabled key is an invented failure the user has to undo by hand.
 *
 * 402 is here rather than under `capacity` because the user's next action is
 * the same as for a revoked key: go do something at the provider. Nothing the
 * product retries will fix an empty balance. DeepSeek and OpenRouter both
 * answer 402 for exactly this.
 */
const CREDENTIAL_STATUSES = new Set([401, 402, 403]);

function reasonFor(provider: string, status: number | null): string {
  if (status === 402) {
    return `${provider} accepted the key but the account is out of credit. Top it up, then reconnect the key.`;
  }
  if (status === null) {
    return `${provider} refused this key.`;
  }
  return `${provider} rejected this key (HTTP ${status}). Re-paste it, or remove it to fall back to the free allowance.`;
}

export function classifyProviderFailure(
  error: unknown,
  provider = "The provider"
): ProviderFailure {
  const statusCode = httpStatusOf(error);

  if (statusCode !== null && CREDENTIAL_STATUSES.has(statusCode)) {
    return {
      kind: "credential",
      statusCode,
      reason: reasonFor(provider, statusCode),
    };
  }

  if (statusCode === 429) {
    return {
      kind: "capacity",
      statusCode,
      reason: `${provider} is rate limiting this key.`,
    };
  }

  return {
    kind: "endpoint",
    statusCode,
    reason: `${provider} could not serve this request.`,
  };
}
