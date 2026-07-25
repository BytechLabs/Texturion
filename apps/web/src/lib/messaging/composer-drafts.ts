/**
 * Client-side composer drafts, one per conversation (SPEC: the server keeps NO
 * drafts, so cross-open persistence is purely ours). Both phone apps have kept
 * these since the composer shipped; on web a half-typed reply died the moment
 * you opened another thread to check something, and worse, the composer is
 * remounted with the same React state across conversations, so the draft you
 * were writing to one customer appeared in the box for the next one.
 *
 * Text only: staged attachments are File handles that cannot outlive the tab,
 * and restoring dead chips would be a lie about what is about to be sent.
 */

const PREFIX = "loonext:composer-draft:";

/** The new-conversation screen's draft rides a fixed slot. */
export const NEW_CONVERSATION_DRAFT = "new";

function storage(): Storage | null {
  // Server render, private-mode quota refusals, and disabled storage all end
  // up here. A draft is a convenience; losing it must never break the composer.
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraft(conversationId: string): string {
  try {
    return storage()?.getItem(PREFIX + conversationId) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(conversationId: string, text: string): void {
  try {
    const store = storage();
    if (!store) return;
    if (text.trim() === "") {
      store.removeItem(PREFIX + conversationId);
    } else {
      store.setItem(PREFIX + conversationId, text);
    }
  } catch {
    // Full or blocked storage: the draft simply is not kept.
  }
}

export function clearDraft(conversationId: string): void {
  try {
    storage()?.removeItem(PREFIX + conversationId);
  } catch {
    // As above.
  }
}
