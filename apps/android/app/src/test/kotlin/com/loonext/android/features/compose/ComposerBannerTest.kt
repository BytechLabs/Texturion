package com.loonext.android.features.compose

import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.model.Usage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import com.loonext.android.core.model.OPT_OUT_SOURCE_CARRIER
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
    fun `a carrier-sourced opt-out is a carrier block too`() {
        // #331: Telnyx refused the send, or the nightly reconciliation found
        // the number on their list. The customer said stop either way, so the
        // banner must not offer an undo the server answers with a 409.
        assertEquals(
            ComposerBanner.OptedOut(carrierBlocked = true),
            selectComposerBanner(
                contactOptedOut = true,
                contactOptOutSource = OPT_OUT_SOURCE_CARRIER,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usTextingOff = false,
                usage = usage(10, 100),
            ),
        )
    }

    @Test
    fun `a manual opt-out can still be undone from here`() {
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
    @Test
    fun `a suspended registration is not told to wait for approval`() {
        // #423. The pending copy says carriers are "still reviewing" and texts
        // "will send once it's approved". For a suspended workspace both are
        // false: they WERE approved, nothing is under review, and waiting
        // achieves nothing. Same defect UsTextingOff was split out to fix.
        val banner = selectComposerBanner(
            contactOptedOut = false,
            contactOptOutSource = null,
            subscriptionStatus = SubscriptionStatus.ACTIVE,
            destinationCountry = "US",
            usApproved = false,
            usTextingOff = false,
            usage = usage(10, 100),
            usSuspended = true,
        )
        assertEquals(ComposerBanner.RegistrationSuspended, banner)

        val (title, body) = bannerCopy(ComposerBanner.RegistrationSuspended)
        assertEquals("US texting is paused", title)
        // It must not send the reader hunting for a form to fill in.
        assertFalse(body.contains("resubmit"))
        assertFalse(body.contains("reviewing"))
        // And it says who is acting on it, because they cannot fix it.
        assertTrue(body.contains("we're on it"))
    }

    @Test
    fun `a suspension still offers the call`() {
        // #423: registration gates TEXTING only, so the call connects — and
        // during a suspension it is the only thing the reader can do now.
        assertTrue(offersCallInstead(ComposerBanner.RegistrationSuspended))
    }

    @Test
    fun `a workspace with US texting off wins over a suspension`() {
        // Most-specific-to-this-reader: somebody who never turned the add-on
        // on has no live registration to discuss, so telling them about a
        // carrier suspension would be describing a state they are not in.
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
                usSuspended = true,
            ),
        )
    }

    @Test
    fun `a note-only member is told why, not left guessing`() {
        // #363: the one send-blocking condition that had no banner. Without it
        // the composer just quietly had no text mode, which reads as the
        // product being broken rather than as a permission.
        assertEquals(
            ComposerBanner.NumberAccess,
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usTextingOff = false,
                usage = usage(10, 100),
                viewerLevel = "note",
            ),
        )
    }

    @Test
    fun `number access wins over every other banner`() {
        // A note-only member told "your subscription is past due" learns
        // something true, irrelevant and unfixable by them: they could not
        // text on this number either way, and they cannot pay the bill.
        assertEquals(
            ComposerBanner.NumberAccess,
            selectComposerBanner(
                contactOptedOut = true,
                contactOptOutSource = "stop_keyword",
                subscriptionStatus = "past_due",
                destinationCountry = "US",
                usApproved = false,
                usTextingOff = true,
                usage = usage(2000, 100),
                optOutHint = true,
                usSuspended = true,
                viewerLevel = "note",
            ),
        )
    }

    @Test
    fun `says nothing at all for a member who CAN text`() {
        // The regression that would matter most: a banner shown to everybody
        // would replace the composer for the whole crew.
        assertNull(
            selectComposerBanner(
                contactOptedOut = false,
                contactOptOutSource = null,
                subscriptionStatus = SubscriptionStatus.ACTIVE,
                destinationCountry = "CA",
                usApproved = true,
                usTextingOff = false,
                usage = usage(10, 100),
                viewerLevel = "text",
            ),
        )
    }

    @Test
    fun `the number-access banner never offers a call`() {
        // Whether a note-only member may CALL is a separate access question,
        // and pointing at a second thing they may also lack would be a second
        // dead end.
        assertFalse(offersCallInstead(ComposerBanner.NumberAccess))
    }

    @Test
    fun `note-only banner names the calls consequence too`() {
        // #348: dial targets and the call push audience are filtered by 'text'
        // level, so a note-only member also never rings and never gets call
        // notifications — and until this line, nothing anywhere said so. The
        // composer banner is the one place they meet the restriction.
        val (_, body) = bannerCopy(ComposerBanner.NumberAccess)
        assertTrue(
            "the note-only banner must mention calls: ${'$'}body",
            body.contains("ring", ignoreCase = true),
        )
    }

}
