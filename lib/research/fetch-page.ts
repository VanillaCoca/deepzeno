import "server-only";

import { lookup } from "node:dns/promises";

import { fixturesDir } from "./search-provider";
import { extractReadableText } from "./text";
import { isBlockedHost, isBlockedIp } from "./url-guard";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CHARS = 40_000;
const MAX_REDIRECTS = 5;
// HTML markup inflates well past the 40k extracted-text clamp; 5 MiB is
// generous for any article page while refusing archive-sized bodies.
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type FetchedPage = {
  url: string;
  text: string;
  retrievedAt: string;
};

// Fixture pages: `${dir}/pages.json` maps url → text-file name in the same
// dir. Dev/test only (gated in search-provider.ts).
async function fetchFixturePage(
  url: string,
  dir: string
): Promise<FetchedPage | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const pages = JSON.parse(
      await readFile(join(dir, "pages.json"), "utf8")
    ) as Record<string, string>;
    const file = pages[url];
    if (!file) {
      return null;
    }
    const text = await readFile(join(dir, file), "utf8");
    return { url, text, retrievedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

// SSRF guard: rejects non-http(s) schemes, private/loopback/link-local/
// metadata hosts, and hostnames that resolve to such addresses. The DNS
// check is best-effort (a TOCTOU window remains between lookup and fetch),
// which matches the low-severity posture: GET-only, no credentials.
async function isSafeTarget(parsed: URL): Promise<boolean> {
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  if (isBlockedHost(parsed.hostname)) {
    return false;
  }

  // IP literals were fully classified by isBlockedHost; only names need DNS.
  if (
    /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) ||
    parsed.hostname.startsWith("[")
  ) {
    return true;
  }

  const addresses = await lookup(parsed.hostname, { all: true });

  return (
    addresses.length > 0 &&
    addresses.every((entry) => !isBlockedIp(entry.address))
  );
}

// Follows redirects manually so every hop is re-validated — a vetted public
// hostname must not be allowed to bounce the fetcher into 169.254.169.254
// or a peered private network. Returns null on any rejection.
async function fetchWithGuardedRedirects(
  initialUrl: URL,
  signal: AbortSignal
): Promise<Response | null> {
  let current = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeTarget(current))) {
      return null;
    }

    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        "user-agent": "ZENO-Research/1.0 (+read-only research agent)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    response.body?.cancel();

    if (!location) {
      return null;
    }

    current = new URL(location, current);
  }

  return null;
}

// Read-only by construction: GET only, no cookies, no auth forwarding.
// Returns null on any failure — the pipeline treats an unfetchable page as
// a miss, never as evidence (Iron Law 2).
export async function fetchPageText(url: string): Promise<FetchedPage | null> {
  const fixtures = fixturesDir();
  if (fixtures) {
    return await fetchFixturePage(url, fixtures);
  }

  try {
    const parsed = new URL(url);
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const response = await fetchWithGuardedRedirects(parsed, signal);

    if (!response?.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!(contentType.includes("html") || contentType.includes("text/plain"))) {
      return null;
    }

    const declaredLength = Number(response.headers.get("content-length"));

    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return null;
    }

    const body = await response.text();
    const text = contentType.includes("text/plain")
      ? body.slice(0, MAX_PAGE_CHARS)
      : extractReadableText(body).slice(0, MAX_PAGE_CHARS);

    if (text.trim().length < 80) {
      return null;
    }

    return { url, text, retrievedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}
