package com.loonext.android.core.security

/**
 * #330 — handing the phone to whoever is covering the rest of the shift.
 *
 * The hand-port of `packages/shared/src/hand-over-phone.ts`.
 *
 * D12's customer is a crew of one to ten texting customers from PERSONAL handsets,
 * and a spare phone lives in the truck. It gets handed to whoever is on this evening.
 * Until now the only way to do that honestly was Settings, then Profile, then scroll,
 * then "Sign out on this device" — so the fast path was to hand the phone over signed
 * in as somebody else, which attributes every reply to the wrong person and gives
 * them permissions that are not theirs.
 *
 * ## Why there is no stored account switcher
 *
 * The obvious feature is two signed-in accounts and a toggle. It is the wrong one
 * here: keeping the previous person's session on the device is exactly what this
 * issue exists to stop, and it would contradict what the privacy policy now promises
 * — everything goes when the session ends. So a handover is a full, clean exit, made
 * fast rather than made partial.
 *
 * ## The one thing it must not do quietly
 *
 * Ending the session clears the offline outbox, because a message half-written to a
 * homeowner must not sit on a phone the business does not own. That means a handover
 * DISCARDS anything still waiting for signal — and the person tapping it is the only
 * one who can be told, since a session the server revokes has nobody to ask.
 */
object HandOverPhone {

    /** The action, named for what somebody is actually doing. */
    const val ACTION = "Hand this phone to someone else"

    /** The confirmation's heading. */
    const val TITLE = "Hand this phone over?"

    /** Goes through with it. */
    const val CONFIRM = "Sign out and clear"

    /** Backs out. */
    const val CANCEL = "Stay signed in"

    /**
     * What happens, in the order it matters to the person holding the phone.
     *
     * [unsent] is how many messages are still waiting for signal. Naming the number
     * rather than saying "any unsent messages" is the difference between a warning
     * somebody reads past and one they act on.
     */
    fun body(unsent: Int): String {
        val first = "You'll be signed out and everything from this workspace comes " +
            "off this phone: the conversations, your customers' details, and the " +
            "unread counts. The next person signs in as themselves."
        if (unsent <= 0) return first
        val warning = if (unsent == 1) {
            "One message hasn't sent yet and will be discarded. If it matters, " +
                "stay signed in until you have signal."
        } else {
            "$unsent messages haven't sent yet and will be discarded. If they " +
                "matter, stay signed in until you have signal."
        }
        return "$first\n\n$warning"
    }

    /**
     * Is there anything to lose by handing the phone over right now?
     *
     * Split out so the confirmation can be coloured as a warning rather than a
     * routine question, without re-deriving the rule from the copy.
     */
    fun costs(unsent: Int): Boolean = unsent > 0
}
