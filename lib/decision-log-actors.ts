export const decisionLogActorTypes = [
  "user",
  "external_agent",
  "system",
] as const;

export type DecisionLogActorType = (typeof decisionLogActorTypes)[number];

export function isDecisionLogActorType(
  value: string
): value is DecisionLogActorType {
  return (decisionLogActorTypes as readonly string[]).includes(value);
}
