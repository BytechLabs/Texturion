package com.loonext.android.features.compose

import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.model.Usage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import com.loonext.android.core.model.OPT_OUT_SOURCE_STOP

/** Banner precedence: opted_out > subscription > registration > cap > none. */
class ComposerBannerTest {

    @Test
    fun `only a texting gate offers the call, never an opt-out`() {
        // Carrier registration gates texting alone, so the call connects today.
        // A STOP revokes consent for the business to reach out at all, so the
        // phone must never be offered as a way around it.
        assertTrue(offersCallInstead(ComposerBanner.RegistrationPending))
        assertTrue(offersCallInstead(ComposerBanner.UsTextingOff))
        assertFalse(offersCallInstead(ComposerBanner.OptedOut(carrierBlocked = true)))
        assertFalse(offersCallInstead(ComposerBanner.OptedOut(carrierBlocked = false)))
        assertFalse(offersCallInstead(ComposerBanner.UsageCap))
        assertFalse(offersCallInstead(ComposerBanner.Subscription("past_due")))
    }

    @Test
    fun `a workspace without US texting is told what is off, not to wait`() {
        // No registration exists to approve, so the pending copy would promise
        // an outcome that cannot arrive however long the reader waits.
        assertEquals(
            ComposerBanner.UsTextingOff,
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "US",
                usApproved = false,
                usTextingOff = true,
                usage = usage(10, 100),
            ),
        )
        assertEquals(
            ComposerBanner.RegistrationPending,
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "US",
                usApproved = false,
                usTextingOff = false,
                usage = usage(10, 100),
            ),
        )
    }

    private fun usage(used: Long, cap: Long?) =
        Usage(used_segments = used, cap_segments = cap)

    @Test
    fun `no gates means no banner`() {
        assertNull(
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = false,
                usTextingOff = false,
                usage = usage(10, 100),
            ),
        )
    }

    @Test
    fun `opted out wins over everything`() {
        assertEquals(
            ComposerBanner.OptedOut(carrierBlocked = true),
            selectComposerBanner(
                contactOptedOut = true,
                contactOptOutSource = OPT_OUT_SOURCE_STOP,
                subscriptionStatus = SubscriptionStatus.CANCELED,
                destinationCountry = "US",
                usApproved = false,
                usTextingOff = false,
                usage = usage(200, 100),
            ),
        )
    }

    @Test
    fun `inactive subscription beats registration and cap`() {
        assertEquals(
            ComposerBanner.Subscription(SubscriptionStatus.PAST_DUE),
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.PAST_DUE,
                destinationCountry = "US",
                usApproved = false,
                usTextingOff = false,
                usage = usage(200, 100),
            ),
        )
    }

    @Test
    fun `US destination without approval shows registration pending`() {
        assertEquals(
            ComposerBanner.RegistrationPending,
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "US",
                usApproved = false,
                usTextingOff = false,
                usage = null,
            ),
        )
    }

    @Test
    fun `CA destination never sees the registration banner`() {
        assertNull(
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = false,
                usTextingOff = false,
                usage = null,
            ),
        )
    }

    @Test
    fun `cap reached shows the usage banner`() {
        assertEquals(
            ComposerBanner.UsageCap,
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usTextingOff = false,
                usage = usage(100, 100),
            ),
        )
    }

    @Test
    fun `no cap means no usage banner`() {
        assertNull(
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usTextingOff = false,
                usage = usage(1_000_000, null),
            ),
        )
    }

    @Test
    fun `loading usage (null) never shows the cap banner`() {
        assertNull(
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usTextingOff = false,
                usage = null,
            ),
        )
    }

    @Test
    fun `tells the two opt-outs apart, because only one has a way out`() {
        // A STOP is the customer's to undo. A hand-recorded opt-out is the
        // crew's, and telling them to wait for a START they will never get is
        // a dead end.
        assertEquals(
            ComposerBanner.OptedOut(carrierBlocked = false),
            selectComposerBanner(
                contactOptedOut = true,
                contactOptOutSource = "manual",
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usTextingOff = false,
                usage = usage(10, 100),
            ),
        )
    }
}
