package com.loonext.android.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #241 — the same table `packages/shared/src/carrier-failure.test.ts` asserts,
 * against the Kotlin hand-port.
 *
 * A drift here means this app offers a retry button that web withholds — for a
 * block only the customer can lift. That would not show up as a crash, which
 * is exactly why the port gets its own test.
 */
class CarrierFailureTest {
    @Test
    fun `classifies the opt-out, which is the one with a legal meaning`() {
        assertEquals(CarrierFailureReason.OPT_OUT, classifySendFailure("40300"))
    }

    @Test
    fun `collapses codes we treat identically`() {
        for (code in listOf("40001", "40012", "40310", "40004", "40006", "40008")) {
            assertEquals(code, CarrierFailureReason.UNREACHABLE, classifySendFailure(code))
        }
        for (code in listOf("40011", "40016", "40018", "40318")) {
            assertEquals(code, CarrierFailureReason.RATE_LIMITED, classifySendFailure(code))
        }
    }

    @Test
    fun `is unknown for a code we have not classified`() {
        assertEquals(CarrierFailureReason.UNKNOWN, classifySendFailure("99999"))
        assertEquals(CarrierFailureReason.UNKNOWN, classifySendFailure(""))
        assertEquals(CarrierFailureReason.UNKNOWN, classifySendFailure(null))
    }

    @Test
    fun `never guesses opt_out`() {
        // A wrongly-inferred opt-out takes somebody's number out of service and
        // nobody here can put it back — only the customer can.
        for (code in listOf("99999", "40999", "abc", " ", "4030", "403000")) {
            assertNotEquals(code, CarrierFailureReason.OPT_OUT, classifySendFailure(code))
        }
    }

    @Test
    fun `prefers the server's classification and falls back to the code`() {
        assertEquals(
            CarrierFailureReason.SPAM_BLOCKED,
            failureReasonOf("spam_blocked", "40300"),
        )
        // Rows written before the column existed live on phones for months.
        assertEquals(CarrierFailureReason.OPT_OUT, failureReasonOf(null, "40300"))
        assertEquals(CarrierFailureReason.RATE_LIMITED, failureReasonOf(null, "40011"))
    }

    @Test
    fun `ignores a server value it does not recognise rather than crashing`() {
        assertEquals(CarrierFailureReason.OPT_OUT, failureReasonOf("something_new", "40300"))
        assertEquals(CarrierFailureReason.UNKNOWN, failureReasonOf("something_new", null))
    }

    @Test
    fun `never offers a retry for an opt-out, and offers one otherwise`() {
        assertFalse(isRetryableFailure(CarrierFailureReason.OPT_OUT))
        for (reason in CarrierFailureReason.entries.filter { it != CarrierFailureReason.OPT_OUT }) {
            assertTrue(reason.name, isRetryableFailure(reason))
        }
    }
}
