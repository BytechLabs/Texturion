/**
 * #214 — the task-enrichment call + its session cache. Kept in a leaf module
 * (only apiFetch + types) so it carries no React-provider imports and stays
 * unit-testable in isolation. The React hooks (useAiSettings / useUpdateAiSettings)
 * live in ai-settings.ts.
 */
import { apiFetch } from "./client";
import type { TaskEnrichment } from "./types";

/**
 * Session cache for enrichment results, keyed by company + message. The
 * founder's "local caching for the session": if the user opens the make-task
 * form for a message, gets an enrichment, cancels, then reopens the SAME
 * message, reuse the result instead of spending another AI call. Module-level so
 * it survives component unmounts within the session (cleared on page reload).
 */
const enrichmentCache = new Map<string, TaskEnrichment>();

function cacheKey(companyId: string, messageId: string): string {
  return `${companyId}:${messageId}`;
}

const EMPTY_ENRICHMENT: TaskEnrichment = {
  address: null,
  address_provenance: null,
  due_at: null,
};

/**
 * POST /v1/tasks/enrich — infer an address + due date/time from task text (a
 * pure suggestion the user reviews before saving). Session-cached per message.
 * Never rejects: any network error resolves to the empty enrichment, so task
 * creation is never blocked by the AI path.
 */
export async function enrichTaskFromMessage(
  companyId: string,
  input: { message_id: string; conversation_id: string; text: string },
): Promise<TaskEnrichment> {
  const ck = cacheKey(companyId, input.message_id);
  const cached = enrichmentCache.get(ck);
  if (cached) return cached;

  let result: TaskEnrichment;
  try {
    result = await apiFetch<TaskEnrichment>("/v1/tasks/enrich", {
      method: "POST",
      companyId,
      body: {
        text: input.text,
        message_id: input.message_id,
        conversation_id: input.conversation_id,
      },
    });
  } catch {
    result = EMPTY_ENRICHMENT;
  }
  enrichmentCache.set(ck, result);
  return result;
}
