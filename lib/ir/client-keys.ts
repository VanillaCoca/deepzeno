export type IRListStatus = "idea" | "pending" | "active";

export function getIRListKey({
  projectId,
  topicId,
  status,
}: {
  projectId: string | null;
  topicId?: string | null;
  status: IRListStatus;
}) {
  if (!projectId || !topicId) {
    return null;
  }

  const params = new URLSearchParams({
    project_id: projectId,
    status,
  });

  params.set("topic_id", topicId);

  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/ir?${params.toString()}`;
}

export function getUnassignedIRListKey({
  projectId,
  status,
}: {
  projectId: string | null;
  status: IRListStatus;
}) {
  if (!projectId) {
    return null;
  }

  const params = new URLSearchParams({
    project_id: projectId,
    status,
    unassigned: "true",
  });

  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/ir?${params.toString()}`;
}

export function isIRListKeyForScope({
  key,
  projectId,
  topicId,
}: {
  key: unknown;
  projectId: string | null;
  topicId: string | null;
}) {
  if (!(typeof key === "string" && projectId && topicId)) {
    return false;
  }

  const marker = "/api/ir?";
  const markerIndex = key.indexOf(marker);

  if (markerIndex < 0) {
    return false;
  }

  const query = key.slice(markerIndex + marker.length);
  const params = new URLSearchParams(query);

  return (
    params.get("project_id") === projectId && params.get("topic_id") === topicId
  );
}
