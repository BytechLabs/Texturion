package com.loonext.android.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #310 — the same table `packages/shared/src/registration-progress.test.ts`
 * asserts, against the Kotlin hand-port.
 *
 * A drift means this app saying "under review" while the web app says
 * "submitted" — worse than either alone, because it teaches the customer to
 * distrust both at the moment they are already wondering if the wait is
 * broken.
 */
class RegistrationProgressTest {
    @Test
    fun `needs details when nothing has been submitted`() {
        assertEquals(RegistrationStage.NEEDS_DETAILS, registrationStage(null, null))
    }

    @Test
    fun `follows the campaign, because the campaign unlocks texting`() {
        assertEquals(RegistrationStage.UNDER_REVIEW, registrationStage("approved", "pending"))
        assertEquals(RegistrationStage.APPROVED, registrationStage("approved", "approved"))
        assertEquals(RegistrationStage.SUBMITTING, registrationStage("approved", null))
    }

    @Test
    fun `makes a rejection the headline wherever it happens`() {
        assertEquals(RegistrationStage.REJECTED, registrationStage("rejected", "pending"))
        assertEquals(RegistrationStage.REJECTED, registrationStage("approved", "rejected"))
    }

    @Test
    fun `is never zero percent once anything has been sent`() {
        // A bar sitting at 0% for four days IS the spinner this replaces.
        for (pair in listOf(null to null, "submitted" to null, "approved" to "pending")) {
            assertTrue(registrationProgress(pair.first, pair.second).percent > 0)
        }
    }

    @Test
    fun `only asks for action when something is required of them`() {
        assertTrue(registrationProgress(null, null).actionNeeded)
        assertTrue(registrationProgress("rejected", null).actionNeeded)
        // Waiting is not a task; marking it as one puts a permanent red dot on
        // a screen the person can do nothing about.
        assertFalse(registrationProgress("submitted", null).actionNeeded)
        assertFalse(registrationProgress("approved", "pending").actionNeeded)
    }

    @Test
    fun `quotes a range only while there is a wait to describe`() {
        val waiting = registrationProgress("approved", "pending")
        assertTrue(waiting.expected!!.contains("3–7"))
        // "sometimes longer", because it sometimes is — an estimate that
        // quietly expires teaches somebody not to believe the next one.
        assertTrue(waiting.expected.contains("sometimes longer"))
        assertNull(registrationProgress("approved", "approved").expected)
        assertNull(registrationProgress("rejected", null).expected)
    }

    @Test
    fun `speaks the customer language, not the state machine's`() {
        val title = registrationProgress("approved", "pending").title.lowercase()
        assertFalse(title.contains("campaign"))
        assertFalse(title.contains("brand"))
        assertFalse(title.contains("10dlc"))
    }

    @Test
    fun `is waiting only while the carriers genuinely have it`() {
        assertTrue(isWaitingOnRegistration("submitted", null))
        assertTrue(isWaitingOnRegistration("approved", "pending"))
        // Not waiting on anybody — being waited ON.
        assertFalse(isWaitingOnRegistration(null, null))
        assertFalse(isWaitingOnRegistration("rejected", null))
        assertFalse(isWaitingOnRegistration("approved", "approved"))
    }
}
