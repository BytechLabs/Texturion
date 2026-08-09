/**
 * #414 / #565 — is this thread still flagged urgent?
 *
 * One rule, because it is now asked in six places: the inbox row and the thread
 * header, on each of three clients. It was written out three times before this
 * file existed and the fourth copy is what prompted it — a predicate that spreads
 * by copying is how "is anything filtered" came to disagree with itself across
 * the same three clients (#548).
 *
 * ## Why closing is what clears it
 *
 * A badge that never clears is decoration. Closing the thread is the product's
 * existing word for "handled", so it is the honest thing to clear on: no second
 * notion of resolved to keep in step, and no timer quietly deciding an emergency
 * stopped mattering while somebody was still driving to it.
 *
 * ## Why it is not "was it ever urgent"
 *
 * `emergency_at` is a timestamp and it is never cleared — the timeline keeps the
 * fact that this happened. The BADGE is about now. A thread that was urgent last
 * month and was dealt with is history, and history does not belong in a mark whose
 * whole job is to be found at a glance at 11pm by somebody a notification just
 * woke.
 */

/** The two fields this rule reads. Anything shaped like a conversation. */
export interface EmergencyFlagFields {
  /** When a customer's reply last read as urgent. Never cleared. */
  emergency_at: string | null;
  /** When the crew closed the thread, which is what "handled" means here. */
  closed_at: string | null;
}

/** Should this thread carry the urgent mark right now? */
export function isFlaggedUrgent(conversation: EmergencyFlagFields): boolean {
  return conversation.emergency_at !== null && conversation.closed_at === null;
}

/**
 * The word on the mark, in one place so the inbox and the thread cannot drift
 * into saying different things about the same thread.
 *
 * Upper case in the clients' own styling rather than here — a screen reader
 * should say "Urgent", not spell it.
 */
export const URGENT_BADGE_LABEL = "Urgent";
