import "server-only";

import type { ByokProvider } from "./queries";

/**
 * A one-request probe that tells the user whether the key they just pasted
 * actually authenticates.
 *
 * The probe INFORMS; it never DECIDES. `POST /api/billing/keys` saves the key
 * regardless of the verdict and returns this alongside it.
 *
 * That split is the whole design, and it is worth stating why. The obvious
 * alternative — refuse to save a key the probe rejects — trades one failure
 * mode for a worse one. If the probe is right, refusing saves the user a few
 * minutes of confusion. If the probe is wrong (a provider changed an endpoint,
 * an enterprise deployment fronts a proxy that 401s on `/models` but not on
 * completions, a corporate egress returns 403), refusing throws away a working
 * key and leaves the user with no way to override it. The durable mechanism for
 * "this key stopped working" already exists and is strictly more accurate:
 * `markProviderKeyInvalid` fires on the real request path, with the real
 * payload. This probe only buys latency on that same feedback — so it should
 * not be allowed to cost correctness.
 */
export type KeyValidationVerdict = "valid" | "rejected" | "unverified";

export type KeyValidation = {
  verdict: KeyValidationVerdict;
  /** One sentence, safe to render. Never contains the key. */
  detail: string;
};

// Long enough for a cold TLS handshake to a Chinese or US endpoint, short
// enough that a hung provider does not hold the settings dialog open. On
// timeout the verdict is `unverified`, which is a fine answer.
const PROBE_TIMEOUT_MS = 6000;

/**
 * Statuses that are positive evidence the credential itself was refused.
 *
 * Deliberately narrow. 404 means we asked the wrong question, 500 means the
 * provider is having a bad day, 429 means the key is real and busy — none of
 * those say anything about whether the key is good.
 */
const REJECTED_STATUSES = new Set([401, 403]);

// Tavily's own codes for "the key is genuine but the account cannot serve this
// request": 432 = plan limit, 433 = out of credit. Worth separating from a bad
// key, because the user's next action is completely different.
const TAVILY_EXHAUSTED_STATUSES = new Set([432, 433]);

type Probe = {
  url: string;
  init: RequestInit;
};

function bearer(url: string, apiKey: string): Probe {
  return {
    url,
    init: { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
  };
}

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

function buildProbe(
  provider: ByokProvider,
  apiKey: string,
  env: Record<string, string | undefined>
): Probe | null {
  switch (provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models?limit=1",
        init: {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
      };
    case "openai":
      return bearer("https://api.openai.com/v1/models", apiKey);
    case "deepseek":
      return bearer(
        `${trimBase(env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1")}/models`,
        apiKey
      );
    case "openrouter":
      // `/key` rather than `/models`: OpenRouter's model catalogue is public
      // and answers 200 to an invalid key, which would make every probe pass.
      return bearer(
        `${trimBase(env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1")}/key`,
        apiKey
      );
    case "dashscope":
      return bearer(
        `${trimBase(env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1")}/models`,
        apiKey
      );
    case "gateway":
      return bearer("https://ai-gateway.vercel.sh/v1/credits", apiKey);
    case "tavily":
      // Deliberately malformed: an empty query. A working key gets a 400
      // ("query is required"), a bad key gets a 401 before the body is ever
      // parsed. That distinguishes authentication from validity without
      // spending one of the user's search credits to find out.
      return {
        url: "https://api.tavily.com/search",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ query: "" }),
        },
      };
    default:
      return null;
  }
}

function verdictFor(
  provider: ByokProvider,
  status: number
): KeyValidation | null {
  if (REJECTED_STATUSES.has(status)) {
    return {
      verdict: "rejected",
      detail: `${provider} rejected this key (HTTP ${status}). It was saved anyway — double-check it if calls start failing.`,
    };
  }

  if (provider === "tavily" && TAVILY_EXHAUSTED_STATUSES.has(status)) {
    return {
      verdict: "rejected",
      detail:
        "Tavily accepted the key but the account is out of search credit or over its plan limit.",
    };
  }

  return null;
}

/**
 * Never throws. Every failure path collapses to `unverified`, because "we could
 * not check" and "the key is bad" must not be the same answer — the same
 * distinction `BillingNotReadyError` exists to preserve on the metering side.
 */
export async function validateProviderKey({
  provider,
  apiKey,
  env = process.env,
}: {
  provider: ByokProvider;
  apiKey: string;
  env?: Record<string, string | undefined>;
}): Promise<KeyValidation> {
  const probe = buildProbe(provider, apiKey.trim(), env);
  if (!probe) {
    return { verdict: "unverified", detail: "No check available for this provider." };
  }

  let response: Response;
  try {
    response = await fetch(probe.url, {
      ...probe.init,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return {
      verdict: "unverified",
      detail: `Couldn't reach ${provider} to check the key. Saved as-is.`,
    };
  }

  const rejection = verdictFor(provider, response.status);
  if (rejection) {
    return rejection;
  }

  // Tavily's probe is malformed on purpose, so a 4xx that is not an auth code
  // means the request got past authentication — which is exactly what we asked.
  if (provider === "tavily" || response.ok) {
    return { verdict: "valid", detail: `Key verified with ${provider}.` };
  }

  return {
    verdict: "unverified",
    detail: `${provider} answered HTTP ${response.status}, which doesn't say whether the key is good. Saved as-is.`,
  };
}
