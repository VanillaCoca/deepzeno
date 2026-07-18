import "server-only";

import { fixturesDir } from "./search-provider";
import { extractReadableText } from "./text";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CHARS = 40_000;

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

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "ZENO-Research/1.0 (+read-only research agent)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!(contentType.includes("html") || contentType.includes("text/plain"))) {
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
