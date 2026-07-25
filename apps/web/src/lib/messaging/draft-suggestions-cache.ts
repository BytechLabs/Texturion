/**
 * The drafts Lou already wrote for a conversation, kept until the conversation
 * moves on.
 *
 * Asking costs a real AI call, so the answer is worth keeping: closing the
 * strip and opening it again, or leaving the thread and coming back, must not
 * spend again. And there is deliberately no "try again" — re-rolling until a
 * draft looks nice is the one interaction that turns a bounded per-message cost
 * into an unbounded one, for an answer that is only ever a starting point you
 * edit anyway.
 *
 * The cache key includes the conversation's last activity, so the moment a
 * message is sent or received the old drafts stop applying and the next ask is
 * a fresh one. That is the only thing that should ever buy a new set.
 *
 * Module-level and in-memory on purpose: drafts are a momentary offer, not
 * state worth surviving a reload.
 */

const drafts = new Map<string, string[]>();

/** Bound the map so a long session over many threads cannot grow forever. */
const MAX_ENTRIES = 50;

function keyFor(conversationId: string, lastActivityAt: string | null): string {
  return `${conversationId}:${lastActivityAt ?? "-"}`;
}

export function readCachedSuggestions(
  conversationId: string,
  lastActivityAt: string | null,
): string[] | null {
  return drafts.get(keyFor(conversationId, lastActivityAt)) ?? null;
}

export function cacheSuggestions(
  conversationId: string,
  lastActivityAt: string | null,
  suggestions: string[],
): void {
  if (suggestions.length === 0) return;
  const key = keyFor(conversationId, lastActivityAt);
  // Re-insert so the most recently used key is last, then drop from the front.
  drafts.delete(key);
  drafts.set(key, suggestions);
  while (drafts.size > MAX_ENTRIES) {
    const oldest = drafts.keys().next();
    if (oldest.done) break;
    drafts.delete(oldest.value);
  }
}

/** Test seam. */
export function clearCachedSuggestions(): void {
  drafts.clear();
}
