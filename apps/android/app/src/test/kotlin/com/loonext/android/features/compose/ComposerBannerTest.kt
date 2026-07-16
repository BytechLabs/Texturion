package com.loonext.android.features.compose

import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.model.Usage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Banner precedence: opted_out > subscription > registration > cap > none. */
class ComposerBannerTest {

    private fun usage(used: Long, cap: Long?) =
        Usage(used_segments = used, cap_segments = cap)

    @Test
    fun `no gates means no banner`() {
        assertNull(
            selectComposerBanner(
                contactOptedOut = false,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = false,
                usage = usage(10, 100),
            ),
        )
    }

    @Test
    fun `opted out wins over everything`() {
        assertEquals(
            ComposerBanner.OptedOut,
            selectComposerBanner(
                contactOptedOut = true,
                subscriptionStatus = SubscriptionStatus.CANCELED,
                destinationCountry = "US",
                usApproved = false,
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
                subscriptionStatus = SubscriptionStatus.PAST_DUE,
                destinationCountry = "US",
                usApproved = false,
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
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "US",
                usApproved = false,
                usage = null,
            ),
        )
    }

    @Test
    fun `CA destination never sees the registration banner`() {
        assertNull(
            selectComposerBanner(
                contactOptedOut = false,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = false,
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
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usage = usage(100, 100),
            ),
        )
    }

    @Test
    fun `no cap means no usage banner`() {
        assertNull(
            selectComposerBanner(
                contactOptedOut = false,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usage = usage(1_000_000, null),
            ),
        )
    }

    @Test
    fun `loading usage (null) never shows the cap banner`() {
        assertNull(
            selectComposerBanner(
                contactOptedOut = false,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usage = null,
            ),
        )
    }
}
