import type { IRCreatedBy, IRSourceLayer } from "@/lib/ir/types";
import type { ImportStatus } from "./import-types";

export type StandardIRCreationInput = {
  sourceLayer: IRSourceLayer;
  initialStatus: "pending" | "idea";
};

export type ImportedIRCreationInput = {
  sourceLayer: IRSourceLayer;
  createdBy: IRCreatedBy;
  status: ImportStatus;
  importSessionId?: string | null;
};

export function validateStandardIRCreation(input: StandardIRCreationInput) {
  if (input.initialStatus === "idea" && input.sourceLayer !== "sweep") {
    return {
      ok: false as const,
      message: "Only sweep extraction can create idea nodes",
    };
  }

  if (input.sourceLayer === "mcp" && input.initialStatus !== "pending") {
    return {
      ok: false as const,
      message: "MCP writers can only create pending candidates",
    };
  }

  return { ok: true as const };
}

export function validateImportedIRCreation(input: ImportedIRCreationInput) {
  if (input.sourceLayer !== "manual" || input.createdBy !== "user") {
    return {
      ok: false as const,
      message: "Imported IR nodes must be manual/user-created",
    };
  }

  if (!input.importSessionId) {
    return {
      ok: false as const,
      message: "Imported IR nodes require import_session_id",
    };
  }

  if (!["idea", "pending", "active"].includes(input.status)) {
    return {
      ok: false as const,
      message: "Imported IR nodes can only be idea, pending, or active",
    };
  }

  return { ok: true as const };
}
