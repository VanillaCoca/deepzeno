import "server-only";

import { extractReadableText } from "./text";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CHARS = 40_000;

export type FetchedPage = {
  url: string;
  text: string;
  retrievedAt: string;
};

// Read-only by construction: GET only, no cookies, no auth forwarding.
// Returns null on any failure — the pipeline treats an unfetchable page as
// a miss, never as evidence (Iron Law 2).
export async function fetchPageText(url: string): Promise<FetchedPage | null> {
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
