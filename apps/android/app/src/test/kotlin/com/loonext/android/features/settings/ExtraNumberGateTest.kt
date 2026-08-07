package com.loonext.android.features.settings

import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #464 — who may buy an extra number.
 *
 * Vectors shared verbatim with packages/shared/src/extra-numbers.test.ts. A
 * client that disagrees with the server here either hides a purchase the
 * server would allow, or offers one it would refuse and turns a tap into an
 * error — which is exactly what a Canadian workspace used to get.
 */
class ExtraNumberGateTest {

    @Test
    fun `a Canadian workspace may buy one, with no registration to wait on`() {
        // Canada has no 10DLC equivalent, so us_texting_enabled is never true
        // for a CA workspace. Requiring it refused every Canadian customer
        // forever, for a US carrier rule that does not apply to them.
        assertNull(
            extraNumberBlockedReason(country = "CA", usTextingEnabled = false, billingCurrency = "usd"),
        )
    }

    @Test
    fun `a US workspace waits for carrier approval`() {
        val reason = extraNumberBlockedReason(country = "US", usTextingEnabled = false, billingCurrency = "usd")
        assertTrue(
            "should name the gate, got: $reason",
            reason?.contains("US texting") == true,
        )
    }

    @Test
    fun `an approved US workspace may buy one`() {
        assertNull(
            extraNumberBlockedReason(country = "US", usTextingEnabled = true, billingCurrency = "usd"),
        )
    }

    @Test
    fun `a country the provisioner cannot order in is refused`() {
        // The gate guards a CHARGE, so an unrecognised country fails closed.
        val reason = extraNumberBlockedReason(country = "GB", usTextingEnabled = true, billingCurrency = "usd")
        assertTrue(
            "should say which countries work, got: $reason",
            reason?.contains("US and Canadian") == true,
        )
    }

    @Test
    fun `every refusal explains itself`() {
        // The string is the only thing the customer is told, so a blocked case
        // that says nothing is worse than no gate at all.
        for (args in listOf("US" to false, "GB" to true)) {
            val reason = extraNumberBlockedReason(args.first, args.second, "usd")
            assertTrue("${args.first} must explain itself", (reason?.length ?: 0) > 20)
        }
    }

    @Test
    fun `a workspace billed in another currency is refused, with a reason`() {
        // #522: the extra-number prices are filed in USD only, so Stripe refuses
        // an item in another currency outright. Said in a sentence rather than
        // left to arrive as a failed charge.
        val reason = extraNumberBlockedReason(
            country = "CA",
            usTextingEnabled = false,
            billingCurrency = "cad",
        )
        assertTrue(
            "should name the currency, got: $reason",
            reason?.contains("US dollars") == true,
        )
    }

    @Test
    fun `a missing currency reads as USD and refuses nobody`() {
        // The direction that matters: an older response with no billing_currency
        // must not lose somebody a purchase the server would allow. Mirrors
        // billingCurrencyOf on the server.
        assertNull(
            extraNumberBlockedReason(
                country = "CA",
                usTextingEnabled = false,
                billingCurrency = null,
            ),
        )
        assertNull(
            extraNumberBlockedReason(
                country = "CA",
                usTextingEnabled = false,
                billingCurrency = "  USD  ",
            ),
        )
    }

    @Test
    fun `the currency it enforces is the shared constant`() {
        assertNull(
            extraNumberBlockedReason(
                country = "US",
                usTextingEnabled = true,
                billingCurrency = EXTRA_NUMBER_CURRENCY,
            ),
        )
    }
}
