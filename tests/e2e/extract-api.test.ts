import { expect, test } from "@playwright/test";

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
  test("returns input-sensitive structured extraction", async ({ request }) => {
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

  test("rejects empty extraction input", async ({ request }) => {
    const response = await request.post("/api/extract", {
      data: {
        text: "   ",
      },
    });

    expect(response.status()).toBe(400);
  });
});
