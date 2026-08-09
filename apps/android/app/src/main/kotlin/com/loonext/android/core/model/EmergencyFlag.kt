package com.loonext.android.core.model

/**
 * #414 / #565 — is this thread still flagged urgent?
 *
 * The hand-port of `packages/shared/src/emergency-flag.ts`, asserted against it
 * by `EmergencyFlagTest`.
 *
 * One rule, because it is now asked in two places on this client — the inbox row
 * and the thread header — and the same two on each of the others. It was written
 * out three times before the shared module existed and the fourth copy is what
 * prompted it: a predicate that spreads by copying is how "is anything filtered"
 * came to disagree with itself across the same three clients (#548).
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
 * `emergency_at` is a timestamp and is never cleared — the timeline keeps the
 * fact that this happened. The BADGE is about now.
 *
 * Takes the two fields rather than a model, because the two models that carry
 * them ([Conversation] for the list, [ConversationDetail] for the thread) have no
 * common supertype and inventing one for two nullable strings would be worse than
 * passing them.
 */
fun isConversationFlaggedUrgent(emergencyAt: String?, closedAt: String?): Boolean =
    emergencyAt != null && closedAt == null

/**
 * The word on the mark, in one place so the inbox and the thread cannot drift
 * into saying different things about the same thread. Upper-cased by the badge's
 * own styling — a screen reader should say "Urgent", not spell it.
 */
const val URGENT_BADGE_LABEL: String = "Urgent"
