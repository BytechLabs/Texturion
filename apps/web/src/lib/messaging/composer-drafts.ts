/**
 * Client-side composer drafts, one per conversation (SPEC: the server keeps NO
 * drafts, so cross-open persistence is purely ours). Keyed per conversation
 * because the composer is reused across threads, and a half-typed reply to one
 * customer must never appear in the box for the next.
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

/**
 * The teammates named on a note draft, kept beside the text.
 *
 * A mention is two things: the "@Sam" the author typed and the id that decides
 * who gets told. Persisting only the text restored a draft that still SAID
 * "@Sam" while notifying nobody, which is worse than losing the draft: the
 * words on screen were positive evidence of something that would not happen.
 *
 * Stored under its own key so a text-only draft written by an older build is
 * still read correctly, and so a parse failure costs the picks rather than the
 * draft.
 */
const MENTION_PREFIX = "loonext:composer-draft-mentions:";

export interface StoredMention {
  userId: string;
  name: string;
}

export function loadDraftMentions(conversationId: string): StoredMention[] {
  try {
    const raw = storage()?.getItem(MENTION_PREFIX + conversationId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything that is not a well-formed pick is dropped: a half-understood
    // mention must never become a notification for the wrong person.
    return parsed.filter(
      (row): row is StoredMention =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as StoredMention).userId === "string" &&
        typeof (row as StoredMention).name === "string",
    );
  } catch {
    return [];
  }
}

export function saveDraftMentions(
  conversationId: string,
  mentions: readonly StoredMention[],
): void {
  try {
    const store = storage();
    if (!store) return;
    if (mentions.length === 0) {
      store.removeItem(MENTION_PREFIX + conversationId);
    } else {
      store.setItem(MENTION_PREFIX + conversationId, JSON.stringify(mentions));
    }
  } catch {
    // As above: losing the picks is survivable, and the text-presence check
    // means a lost pick fails CLOSED (nobody is notified).
  }
}

export function clearDraftMentions(conversationId: string): void {
  try {
    storage()?.removeItem(MENTION_PREFIX + conversationId);
  } catch {
    // As above.
  }
}
