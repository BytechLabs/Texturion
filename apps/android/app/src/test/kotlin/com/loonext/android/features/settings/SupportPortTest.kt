package com.loonext.android.features.settings

import com.loonext.android.core.diag.RecentErrors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #253/#382 — the support pre-fill, hand-ported.
 *
 * Same vectors as packages/shared/src/support.test.ts. This file is a MIRROR of
 * a TypeScript module Kotlin cannot import, and a mirror that drifts is worse
 * than no mirror: the same carrier suspension would then arrive in the support
 * inbox under two different names, and the pattern that matters most — five
 * reports of one failure in a morning — becomes invisible.
 */
class SupportPortTest {
    private val companyId = "7c9e6679-7425-40de-944b-e07fc1f90ae7"

    private fun body(
        situation: String? = null,
        errors: List<String> = emptyList(),
    ) = supportBody(
        companyId = companyId,
        companyName = "Ace Plumbing",
        plan = "starter",
        appVersion = "1.4.0",
        situation = situation,
        recentErrors = errors,
    )

    @Test
    fun `carries the workspace, plan and platform`() {
        val text = body()
        assertTrue(text.contains("Ace Plumbing"))
        assertTrue(text.contains(companyId))
        assertTrue(text.contains("Plan: starter"))
        assertTrue(text.contains("App: android 1.4.0"))
    }

    @Test
    fun `puts the customer's own words above our diagnostics`() {
        val text = body()
        assertTrue(text.startsWith("\n\n"))
        assertTrue(text.indexOf("---") < text.indexOf("Workspace:"))
    }

    @Test
    fun `names the situation the person was looking at`() {
        val text = body(situation = supportSituation("registration_pending"))
        assertTrue(text.contains("Screen: US registration is pending approval"))
    }

    @Test
    fun `gives the same failure the same subject as the other clients`() {
        assertEquals(
            "Problem: the carrier suspended our US registration",
            supportSubjectFor("registration_suspended"),
        )
        assertEquals(
            "Problem: sending is paused at the spending cap",
            supportSubjectFor("usage_cap"),
        )
    }

    @Test
    fun `says nothing rather than guessing for a banner it has not heard of`() {
        assertNull(supportSituation("something_new"))
        assertEquals("Help with my Loonext workspace", supportSubjectFor("something_new"))
    }

    @Test
    fun `carries recent errors without the customer assembling them`() {
        val text = body(errors = listOf("12:04 POST /v1/messages/send 500 internal_error"))
        assertTrue(text.contains("Recent errors on this device (newest first):"))
        assertTrue(text.contains("internal_error"))
    }

    @Test
    fun `caps the error list, because a truncated body carries NO diagnostics`() {
        val text = body(errors = (0 until 20).map { "error $it" })
        assertTrue(text.contains("error 0"))
        assertTrue(text.contains("error 5"))
        assertTrue(!text.contains("error 6"))
    }

    @Test
    fun `omits the error block entirely when there is nothing to report`() {
        // A heading over an empty list reads as "we looked and found nothing",
        // which is a different claim from "we did not look".
        assertTrue(!body(errors = emptyList()).contains("Recent errors"))
        assertTrue(!body(errors = listOf("  ")).contains("Recent errors"))
    }

    @Test
    fun `the feedback channel arrives under its own subject`() {
        val url = feedbackMailto(companyId, "Ace Plumbing", "starter", "1.4.0")
        assertTrue(url.contains("subject=Idea%20for%20Loonext"))
        assertTrue(url.contains(companyId.replace("-", "-")))
    }

    @Test
    fun `the stated response time survives a bad week`() {
        // "A support channel a solo founder cannot service is worse than none."
        assertTrue(SUPPORT_RESPONSE_TIME.contains("two business days"))
        assertTrue(!SUPPORT_RESPONSE_TIME.contains("hour"))
    }

    @Test
    fun `the fix promise says the same thing as the other clients`() {
        // #321: the loop, and it must promise a reply on the FIX rather than on
        // receipt — a report that vanishes after an acknowledgement teaches the
        // same lesson as one that vanishes immediately.
        assertTrue(SUPPORT_FIX_PROMISE.contains("fixed"))
        assertTrue(SUPPORT_FIX_PROMISE.contains("not just when"))
    }

    @Test
    fun `the answers cover the confusions the issue names`() {
        val all = SUPPORT_TOPICS.joinToString(" ") { "${it.first} ${it.second}" }.lowercase()
        for (subject in listOf("registration", "spending cap", "stop", "port")) {
            assertTrue("no answer mentions $subject", all.contains(subject))
        }
    }

    @Test
    fun `a recorded error keeps the diagnostic and drops the customer`() {
        // A buffer that holds PII and filters on read is one careless caller
        // away from leaking it. The digits were never the diagnostic.
        assertEquals(
            "send to [number] failed: carrier_rejected",
            RecentErrors.scrub("send to +1 415 555 0142 failed: carrier_rejected"),
        )
        assertEquals("mail to [email] bounced", RecentErrors.scrub("mail to bob@acme.co bounced"))
    }

    @Test
    fun `the ring reports newest first and stays bounded`() {
        RecentErrors.clear()
        for (i in 1..20) RecentErrors.record("failure $i")
        val lines = RecentErrors.recentLines()
        assertEquals(6, lines.size)
        assertTrue(lines.first().endsWith("failure 20"))
        assertTrue(lines.last().endsWith("failure 15"))
        RecentErrors.clear()
    }
}
