import { expect, test } from "@playwright/test";
import {
  createConfirmedTestUser,
  deleteTestUser,
  hasSupabaseE2EConfig,
  signInThroughLoginPage,
} from "../helpers";

function collectExtractionText(payload: {
  projectName?: unknown;
  topics?: unknown;
}) {
  const parts: string[] = [];

  if (typeof payload.projectName === "string") {
    parts.push(payload.projectName);
  }

  if (Array.isArray(payload.topics)) {
    for (const topic of payload.topics) {
      if (!topic || typeof topic !== "object") {
        continue;
      }

      const record = topic as Record<string, unknown>;

      if (typeof record.name === "string") {
        parts.push(record.name);
      }

      if (Array.isArray(record.decisions)) {
        for (const decision of record.decisions) {
          if (!decision || typeof decision !== "object") {
            continue;
          }

          const decisionRecord = decision as Record<string, unknown>;

          if (typeof decisionRecord.content === "string") {
            parts.push(decisionRecord.content);
          }
        }
      }
    }
  }

  return parts.join(" ").toLowerCase();
}

function expectValidExtraction(payload: {
  projectName?: unknown;
  topics?: unknown;
}) {
  expect(typeof payload.projectName).toBe("string");
  expect(Array.isArray(payload.topics)).toBe(true);

  for (const topic of payload.topics as Record<string, unknown>[]) {
    expect(typeof topic.name).toBe("string");
    expect(Array.isArray(topic.decisions)).toBe(true);

    for (const decision of topic.decisions as Record<string, unknown>[]) {
      expect(typeof decision.type).toBe("string");
      expect(typeof decision.content).toBe("string");
    }
  }
}

test.describe("Project extraction API", () => {
  // The route spends model money, so it now demands a session. That makes the
  // whole suite conditional on Supabase e2e config for the same reason
  // api.test.ts is: without it there is nobody to be.
  // biome-ignore lint/suspicious/noSkippedTests: conditional e2e requires Supabase auth.
  test.skip(
    !hasSupabaseE2EConfig,
    "Supabase auth must be configured for project extraction e2e."
  );

  let user: Awaited<ReturnType<typeof createConfirmedTestUser>> | null = null;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await signInThroughLoginPage(page, user);
  });

  test.afterEach(async () => {
    if (user) {
      await deleteTestUser(user.id);
      user = null;
    }
  });

  test("refuses anonymous extraction", async ({ request }) => {
    // Deliberately the bare `request` fixture, which carries no session
    // cookie. This is the regression that matters most in this file: the route
    // shipped for months with no `auth()` at all, which made 50,000 characters
    // of model input available to anyone who knew the URL.
    const response = await request.post("/api/extract", {
      data: { text: "Project: Anonymous. Goal: should never be extracted." },
    });

    expect(response.status()).toBe(401);
  });

  test("returns input-sensitive structured extraction", async ({ page }) => {
    const request = page.request;
    const pantryResponse = await request.post("/api/extract", {
      data: {
        text: "Project: Pantry Scanner. Goal: build a pantry barcode scanner for volunteers. Constraint: do not accept payments in V1. Open question: choose the barcode data source.",
      },
    });
    const grantResponse = await request.post("/api/extract", {
      data: {
        text: "Project: Grant Review Desk. Goal: triage grant applications for reviewers. Constraint: every recommendation needs human approval. Open question: conflict-of-interest policy.",
      },
    });

    expect(pantryResponse.ok()).toBe(true);
    expect(grantResponse.ok()).toBe(true);

    const pantry = await pantryResponse.json();
    const grant = await grantResponse.json();

    expectValidExtraction(pantry);
    expectValidExtraction(grant);
    expect(pantry).not.toEqual(grant);
    expect(pantry.projectName).not.toBe("ZENO V1");
    expect(grant.projectName).not.toBe("ZENO V1");
    expect(collectExtractionText(pantry)).toMatch(
      /pantry|barcode|scanner|payments/
    );
    expect(collectExtractionText(grant)).toMatch(
      /grant|review|human approval|conflict/
    );
  });

  test("rejects empty extraction input", async ({ page }) => {
    const response = await page.request.post("/api/extract", {
      data: {
        text: "   ",
      },
    });

    expect(response.status()).toBe(400);
  });
});
