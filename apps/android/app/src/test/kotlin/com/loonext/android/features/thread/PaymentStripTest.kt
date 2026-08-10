package com.loonext.android.features.thread

import com.loonext.android.features.payments.PaymentRequest
import com.loonext.android.features.payments.PaymentState
import com.loonext.android.features.payments.PaymentStatus
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #224 — which payment rows earn space above the composer.
 *
 * The half of the strip that can be wrong without LOOKING wrong: a filter that
 * drops the wrong row renders perfectly, and the only symptom is a crew that
 * never learns about a chargeback. Kept as a function with vectors on it rather
 * than a `filter` buried in a layout for exactly that reason.
 */
class PaymentStripTest {

    private fun row(
        id: String,
        status: String = PaymentStatus.REQUESTED,
        paidAt: String? = null,
        refundedAt: String? = null,
        disputedAt: String? = null,
        createdAt: String? = null,
    ) = PaymentRequest(
        id = id,
        status = status,
        paid_at = paidAt,
        refunded_at = refundedAt,
        disputed_at = disputedAt,
        created_at = createdAt,
        amount_cents = 25_000,
        currency = "usd",
        description = "Deposit",
    )

    private fun daysAgo(days: Long): String =
        Instant.ofEpochMilli(NOW - days * DAY).toString()

    @Test
    fun `a thread with nothing outstanding shows no strip at all`() {
        // Zen of Clarity: this is the answer on almost every thread in the
        // product, and reserving space for the rare one is a permanent cost.
        assertTrue(paymentRowsToShow(emptyList(), NOW).isEmpty())
        assertTrue(
            paymentRowsToShow(
                listOf(row("old", PaymentStatus.PAID, paidAt = daysAgo(30))),
                NOW,
            ).isEmpty(),
        )
    }

    @Test
    fun `an unpaid request stays up however long it has been waiting`() {
        val rows = paymentRowsToShow(
            listOf(row("live", createdAt = daysAgo(90))),
            NOW,
        )
        assertEquals(listOf("live"), rows.map { it.id })
    }

    @Test
    fun `a chargeback from three days ago is still on screen`() {
        // The row somebody has to act on. Dropping it would leave a dispute
        // visible only in Stripe's email, which is the failure the strip's
        // whole recently-settled window exists to prevent.
        val rows = paymentRowsToShow(
            listOf(
                row(
                    "disputed",
                    PaymentStatus.PAID,
                    paidAt = daysAgo(5),
                    disputedAt = daysAgo(3),
                ),
            ),
            NOW,
        )
        assertEquals(listOf("disputed"), rows.map { it.id })
        assertEquals(PaymentState.DISPUTED, rows.first().state)
    }

    @Test
    fun `the server's newest-first order is kept`() {
        // The route orders by created_at descending and the filter must not
        // reshuffle it: the money somebody just asked for belongs at the top,
        // nearest the composer they asked from.
        val rows = paymentRowsToShow(
            listOf(
                row("newest", createdAt = daysAgo(0)),
                row("middle", PaymentStatus.PAID, paidAt = daysAgo(2)),
                row("stale", PaymentStatus.PAID, paidAt = daysAgo(40)),
                row("oldest", createdAt = daysAgo(60)),
            ),
            NOW,
        )
        assertEquals(listOf("newest", "middle", "oldest"), rows.map { it.id })
    }

    @Test
    fun `three tones, and every state has exactly one`() {
        // A `when` with an `else` would silently give a new state the quiet
        // tone, which is the tone that says "nothing to do here" — the wrong
        // default for anything a payments feature invents next.
        assertEquals(PaymentTone.ATTENTION, toneFor(PaymentState.DISPUTED))
        assertEquals(PaymentTone.ATTENTION, toneFor(PaymentState.REFUNDED))
        assertEquals(PaymentTone.SETTLED, toneFor(PaymentState.PAID))
        assertEquals(PaymentTone.QUIET, toneFor(PaymentState.REQUESTED))
        assertEquals(PaymentTone.QUIET, toneFor(PaymentState.CANCELLED))
        assertEquals(PaymentTone.QUIET, toneFor(PaymentState.EXPIRED))
        // And no tone is unreachable — a colour nothing can ever paint is a
        // colour somebody later reuses for something it does not mean.
        assertEquals(
            PaymentTone.entries.toSet(),
            PaymentState.entries.map { toneFor(it) }.toSet(),
        )
    }

    private companion object {
        const val DAY = 24L * 60 * 60 * 1000
        /** Fixed: a window computed from the wall clock starts failing on a
         *  date nobody chose. */
        val NOW = Instant.parse("2026-08-10T12:00:00Z").toEpochMilli()
    }
}
