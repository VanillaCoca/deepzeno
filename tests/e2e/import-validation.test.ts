import { expect, test } from "@playwright/test";
import {
  validateImportedIRCreation,
  validateStandardIRCreation,
} from "@/lib/ir/creation-guards";
import type { ImportConfirmRow } from "@/lib/ir/import-types";
import {
  ImportValidationError,
  validateImportCandidate,
  validateImportConfirmationRequest,
} from "@/lib/ir/import-validation";

const sourceDocument =
  "已决定：V1 使用 Supabase 存储 IR。\nOpen question: should import support PDFs?\nTask: add import review route.";

const validCandidate = {
  kind: "plan",
  subtype: "decision",
  title: "V1 使用 Supabase 存储 IR",
  content: "已决定：V1 使用 Supabase 存储 IR。",
  rationale: null,
  suggested_status: "active",
  confidence_caveat: null,
  source_text_span: "已决定：V1 使用 Supabase 存储 IR。",
} as const;

function confirmRow(
  overrides: Partial<ImportConfirmRow> = {}
): ImportConfirmRow {
  return {
    ...validCandidate,
    client_id: "row-1",
    final_status: "pending",
    action_state: "confirmed",
    ...overrides,
  };
}

test.describe("Bulk Import validation", () => {
  test("valid candidate passes", () => {
    const result = validateImportCandidate(validCandidate, sourceDocument);
    expect(result.errors).toEqual([]);
    expect(result.candidate?.title).toBe("V1 使用 Supabase 存储 IR");
  });

  test("invalid source span fails", () => {
    const result = validateImportCandidate(
      { ...validCandidate, source_text_span: "not in document" },
      sourceDocument
    );
    expect(result.candidate).toBeNull();
    expect(result.errors.join(" ")).toContain("source_text_span");
  });

  test("title over 60 Unicode chars fails", () => {
    const result = validateImportCandidate(
      { ...validCandidate, title: "长".repeat(61) },
      sourceDocument
    );
    expect(result.candidate).toBeNull();
    expect(result.errors.join(" ")).toContain("60");
  });

  test("caveat over 100 Unicode chars fails", () => {
    const result = validateImportCandidate(
      { ...validCandidate, confidence_caveat: "x".repeat(101) },
      sourceDocument
    );
    expect(result.candidate).toBeNull();
    expect(result.errors.join(" ")).toContain("100");
  });

  test("plan without subtype fails", () => {
    const result = validateImportCandidate(
      { ...validCandidate, subtype: null },
      sourceDocument
    );
    expect(result.candidate).toBeNull();
    expect(result.errors.join(" ")).toContain("kind/subtype");
  });

  test("non-plan with subtype fails", () => {
    const result = validateImportCandidate(
      { ...validCandidate, kind: "goal", subtype: "decision" },
      sourceDocument
    );
    expect(result.candidate).toBeNull();
    expect(result.errors.join(" ")).toContain("kind/subtype");
  });

  test("unclassified active fails", () => {
    const result = validateImportCandidate(
      {
        ...validCandidate,
        kind: "unclassified",
        subtype: null,
        suggested_status: "active",
      },
      sourceDocument
    );
    expect(result.candidate).toBeNull();
    expect(result.errors.join(" ")).toContain("unclassified");
  });

  test("dismissed rows are not persisted", () => {
    const rows = validateImportConfirmationRequest({
      project_id: "11111111-1111-4111-8111-111111111111",
      topic_id: null,
      import_session_id: "22222222-2222-4222-8222-222222222222",
      source_document: sourceDocument,
      rows: [
        confirmRow({
          final_status: "active",
          action_state: "dismissed",
        }),
      ],
    });
    expect(rows).toEqual([]);
  });

  test("active rows without explicit confirmation metadata are rejected", () => {
    expect(() =>
      validateImportConfirmationRequest({
        project_id: "11111111-1111-4111-8111-111111111111",
        topic_id: null,
        import_session_id: "22222222-2222-4222-8222-222222222222",
        source_document: sourceDocument,
        rows: [confirmRow({ final_status: "active" })],
      })
    ).toThrow(ImportValidationError);
  });

  test("confirm-all active rows without bulk ack are rejected", () => {
    expect(() =>
      validateImportConfirmationRequest({
        project_id: "11111111-1111-4111-8111-111111111111",
        topic_id: null,
        import_session_id: "22222222-2222-4222-8222-222222222222",
        source_document: sourceDocument,
        confirmation_source: "confirm_all_modal",
        rows: [confirmRow({ final_status: "active" })],
      })
    ).toThrow(ImportValidationError);
  });

  test("review truth unhandled rows can be demoted to pending", () => {
    const rows = validateImportConfirmationRequest({
      project_id: "11111111-1111-4111-8111-111111111111",
      topic_id: null,
      import_session_id: "22222222-2222-4222-8222-222222222222",
      source_document: sourceDocument,
      rows: [
        confirmRow({
          final_status: "pending",
          action_state: "unhandled",
        }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].final_status).toBe("pending");
  });

  test("generic manual idea creation remains blocked", () => {
    expect(
      validateStandardIRCreation({
        sourceLayer: "manual",
        initialStatus: "idea",
      }).ok
    ).toBe(false);
  });

  test("import-specific manual idea creation requires import_session_id", () => {
    expect(
      validateImportedIRCreation({
        sourceLayer: "manual",
        createdBy: "user",
        status: "idea",
      }).ok
    ).toBe(false);
    expect(
      validateImportedIRCreation({
        sourceLayer: "manual",
        createdBy: "user",
        status: "idea",
        importSessionId: "22222222-2222-4222-8222-222222222222",
      }).ok
    ).toBe(true);
  });
});
