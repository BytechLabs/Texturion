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

/**
 * #299/#269 — save whatever is in the box when the page is going away.
 *
 * The composer writes its draft on a debounce: one entry per idle moment
 * rather than one per keystroke. That is right for the steady state and wrong
 * at exactly the moment it matters, because the debounce's cleanup CANCELS a
 * pending write. Type a reply and leave inside that window — close the tab,
 * reload, background the app, open another thread — and the last keystrokes
 * are discarded rather than saved.
 *
 * #299 makes it specific rather than theoretical. A mid-session network drop
 * makes the product look broken, the reasonable response is a reload, and that
 * reload lands inside the window somebody was still typing in. The draft
 * feature exists precisely so that reply survives, and it was losing it in the
 * one case it was built for. #269 was this same bug on Android.
 *
 * `pagehide` rather than `beforeunload`: the latter disqualifies a page from
 * the bfcache and does not fire reliably on mobile. `visibilitychange` covers
 * the phone that is backgrounded and then killed without the page ever hiding.
 * Unmount is the third exit, and the one a thread switch takes.
 *
 * `read` is called at flush time rather than closed over, so the listener is
 * registered once and never re-registers on a keystroke. Writing the same
 * value twice is free — this is a localStorage set, not a request — so a flush
 * that races the timer costs nothing.
 */
export function flushDraftOnExit(
  read: () => { conversationId: string; text: string; mentions: readonly StoredMention[] },
): () => void {
  if (typeof window === "undefined") return () => {};

  const flush = () => {
    const { conversationId, text, mentions } = read();
    saveDraft(conversationId, text);
    saveDraftMentions(conversationId, mentions);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
  };

  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", onVisibility);
    flush();
  };
}
