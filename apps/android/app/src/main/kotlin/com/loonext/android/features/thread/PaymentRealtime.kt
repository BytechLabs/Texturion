package com.loonext.android.features.thread

import com.loonext.android.core.realtime.RealtimeEvent
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * #607 — the one rule for "did money just move on the thread in front of me".
 *
 * A `payment_paid` row has always landed in `conversation_events` and nothing
 * announced it, so "Paid" appeared on the NEXT FETCH: opening the thread, one of
 * our own mutations, or coming back to the app. Migration
 * `20260813110000_the_deposit_lands_before_anyone_refreshes.sql` gives that
 * insert a broadcast, and this is the client half of its contract.
 *
 * ## Why a function rather than a string compare at each call site
 *
 * Two surfaces on the open thread react to this frame — the strip above the
 * composer and the audit timeline behind it — and both have to agree on which
 * frames belong to THIS conversation. A rule written twice is the rule that
 * drifts (#548), and this one drifts silently: a wrong answer renders a
 * perfectly correct screen that is simply out of date, which is the exact
 * failure #607 exists to end. The name is a constant for the same reason
 * `task.changed` is worth remembering — an earlier client shipped a listener for
 * `task.updated`, which nothing broadcasts, and the rows just never refreshed.
 *
 * ## Nothing here subscribes to anything
 *
 * The event rides `company:{id}:number:{n}`, which `RealtimeClient` has joined
 * since #480 — every conversation-scoped broadcast already arrives that way, and
 * frames are delivered to `events` without regard to which topic carried them.
 * So this is a new listener on an existing socket, not a new subscription.
 */

/** The wire name. Pinned to the migration itself by `PaymentRealtimeTest`. */
const val PAYMENT_UPDATED = "payment.updated"

/**
 * The one payload key this client routes on.
 *
 * The frame also carries `payment_request_id` and `type`, and this deliberately
 * reads neither. The payload is ID-only by design (SPEC §8), so a `type` of
 * `payment_paid` cannot be painted — the amount, the currency and the six-state
 * answer all come from the API — and `payment_request_id` is documented as
 * nullable, which makes it the wrong thing to route on.
 */
const val PAYMENT_CONVERSATION_ID = "conversation_id"

/**
 * Is this frame the database telling us a payment on [conversationId] changed?
 *
 * Deliberately blind to WHICH change it was. The trigger admits exactly three
 * types and a refund and a chargeback are two of them — filtering down to the
 * happy one would leave a crew unwarned about the disputed payment that
 * [PaymentStrip] calls the one failure it exists to prevent.
 *
 * A frame for another thread is not ours to act on: the reader has one
 * conversation open, and refetching this one's rows because a different thread
 * was paid would be a round trip that changes nothing on screen.
 */
fun paymentMovedOnThread(event: RealtimeEvent, conversationId: String): Boolean {
    if (event.event != PAYMENT_UPDATED) return false
    // contentOrNull, not content: a JSON null is itself a JsonPrimitive, and
    // `.content` answers the four-letter string "null" for it. That is a value
    // that could in principle be compared against and matched, so the honest
    // read is the one that says "absent".
    val id = (event.payload[PAYMENT_CONVERSATION_ID] as? JsonPrimitive)?.contentOrNull
    return id != null && id == conversationId
}
