import assert from "node:assert/strict";
import test from "node:test";
import { classifyProviderFailure } from "@/lib/ai/provider-failure-core";

// The shape the AI SDK actually throws. Built by hand rather than imported so
// this file stays runnable under `tsx --test` without pulling in the SDK, and
// so the duck-typing the classifier relies on is what is under test.
function apiCallError(statusCode: number | undefined, extra = {}) {
  return {
    name: "AI_APICallError",
    message: "provider said no",
    url: "https://api.example.com/v1/chat/completions",
    statusCode,
    ...extra,
  };
}

test("401 and 403 are credential failures", () => {
  for (const status of [401, 403]) {
    const failure = classifyProviderFailure(apiCallError(status), "deepseek");
    assert.equal(failure.kind, "credential");
    assert.equal(failure.statusCode, status);
    assert.match(failure.reason, /deepseek/);
  }
});

test("402 is a credential failure, and says so in the user's own terms", () => {
  // Not "capacity": nothing the product retries will refill an account. The
  // user's next action is the same as for a revoked key — go to the provider —
  // so it belongs on the side that stops routing and tells them.
  const failure = classifyProviderFailure(apiCallError(402), "openrouter");
  assert.equal(failure.kind, "credential");
  assert.match(failure.reason, /out of credit/i);
});

test("429 is capacity, not a bad key", () => {
  // A rate limit is positive evidence the key is REAL. Disabling it here would
  // punish the user for using the product successfully.
  const failure = classifyProviderFailure(apiCallError(429));
  assert.equal(failure.kind, "capacity");
  assert.equal(failure.statusCode, 429);
});

test("server errors and not-founds are endpoint failures", () => {
  for (const status of [400, 404, 500, 502, 503]) {
    assert.equal(
      classifyProviderFailure(apiCallError(status)).kind,
      "endpoint",
      `HTTP ${status} must not be read as a bad credential`
    );
  }
});

test("a network error with no status is an endpoint failure", () => {
  assert.deepEqual(classifyProviderFailure(new TypeError("fetch failed")), {
    kind: "endpoint",
    statusCode: null,
    reason: "The provider could not serve this request.",
  });
});

test("an error that merely has a statusCode is not a provider verdict", () => {
  // This is the regression that matters. `ChatbotError` carries a numeric
  // `statusCode`, and one of its codes is 402 — the allowance error. If that
  // bubbled through a model call and were read as "the user's key is out of
  // credit", the product would disable a perfectly good key because the user
  // ran out of FREE allowance, which is close to the exact opposite of true.
  class ChatbotErrorLike extends Error {
    statusCode = 402;
  }

  const failure = classifyProviderFailure(new ChatbotErrorLike("allowance"));
  assert.equal(failure.kind, "endpoint");
  assert.equal(failure.statusCode, null);
});

test("null, undefined and strings classify without throwing", () => {
  for (const value of [null, undefined, "boom", 42]) {
    assert.equal(classifyProviderFailure(value).kind, "endpoint");
  }
});

test("the stored reason never carries the provider's response body", () => {
  // `reason` is persisted to provider_keys.last_error and rendered back to the
  // user. Provider error bodies echo request context and occasionally key
  // prefixes; a body that leaked in here would sit in the database in
  // plaintext forever.
  const leaky = apiCallError(401, {
    responseBody: JSON.stringify({
      error: "invalid api key sk-live-abcdef123456",
    }),
  });

  const failure = classifyProviderFailure(leaky, "openai");
  assert.ok(!failure.reason.includes("sk-live"));
  assert.ok(!failure.reason.includes("abcdef"));
});
