export type CodeAnchor = {
  repo?: string;
  file: string;
  line_start?: number;
  line_end?: number;
  commit_sha?: string;
  captured_at: string;
};

function isPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isIsoParseable(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isValidCodeAnchor(value: unknown): value is CodeAnchor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.file !== "string" || record.file.trim().length === 0) {
    return false;
  }

  if (!isOptionalString(record.repo) || !isOptionalString(record.commit_sha)) {
    return false;
  }

  if (!isIsoParseable(record.captured_at)) {
    return false;
  }

  const hasLineStart = record.line_start !== undefined;
  const hasLineEnd = record.line_end !== undefined;

  if (hasLineStart && !isPositiveInteger(record.line_start)) {
    return false;
  }

  if (hasLineEnd && !isPositiveInteger(record.line_end)) {
    return false;
  }

  if (
    hasLineStart &&
    hasLineEnd &&
    Number(record.line_start) > Number(record.line_end)
  ) {
    return false;
  }

  return true;
}

export function normalizeCodeAnchors(value: unknown): CodeAnchor[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const anchors = value.filter(isValidCodeAnchor);
  return anchors.length > 0 ? anchors : null;
}
