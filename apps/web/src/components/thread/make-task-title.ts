/**
 * The task title defaults to a trimmed one-line snippet of the promoted
 * message's body (TASKS.md T5.1). Pure + dependency-free so it is unit-testable
 * without the client component's React/UI imports.
 */
export function messageTaskTitle(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine === "") return "Follow up";
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
}
