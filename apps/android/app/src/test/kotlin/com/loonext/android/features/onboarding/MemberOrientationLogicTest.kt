package com.loonext.android.features.onboarding

import com.loonext.android.core.model.MemberRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #286 — "An invited member sees a short, skippable, member-specific
 * orientation on first sign-in."
 *
 * Vectors shared with packages/shared/src/member-orientation.test.ts and the
 * Swift port. A phone that disagrees with the web about whether somebody is
 * new shows them the flow twice, or never.
 */
class MemberOrientationLogicTest {

    @Test
    fun `shows it to the person it was written for`() {
        assertTrue(shouldShowOrientation(MemberRole.MEMBER, false))
    }

    @Test
    fun `never shows it to somebody who has already been through it`() {
        // The server's answer for THIS membership, so a skip on a phone is a
        // skip on the laptop too. That is the whole reason it is not a device
        // flag.
        for (role in listOf(
            MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER,
            MemberRole.READ_ONLY, MemberRole.BOOKKEEPER,
        )) {
            assertFalse(role, shouldShowOrientation(role, true))
        }
    }

    @Test
    fun `shows nothing while the answer is still in flight`() {
        // Null is "we have not asked yet". Flashing four screens at somebody
        // who has been here for months, then taking them away, is worse than
        // the wait.
        assertFalse(shouldShowOrientation(MemberRole.MEMBER, null))
    }

    @Test
    fun `does not orient the person who built the workspace`() {
        assertFalse(shouldShowOrientation(MemberRole.OWNER, false))
        assertFalse(shouldShowOrientation(MemberRole.ADMIN, false))
    }

    @Test
    fun `does not orient a role that does not answer customers`() {
        // #315: a read-only observer and a bookkeeper are not lesser members —
        // they are different sets. Every screen of this flow is about
        // answering customers.
        assertFalse(shouldShowOrientation(MemberRole.READ_ONLY, false))
        assertFalse(shouldShowOrientation(MemberRole.BOOKKEEPER, false))
    }

    @Test
    fun `shows nothing to a role this build has never heard of`() {
        assertFalse(shouldShowOrientation("superuser", false))
        assertFalse(shouldShowOrientation(null, false))
        assertFalse(shouldShowOrientation("", false))
    }

    @Test
    fun `the bar never starts at zero`() {
        // Somebody on screen one accepted an invite, signed in and opened the
        // app. *Applying: Goal Gradient Effect.*
        assertTrue(orientationProgress(0) > 0f)
        assertEquals(0.25f, orientationProgress(0), 0.0001f)
    }

    @Test
    fun `the bar fills as they go and is full on the last screen`() {
        val values = (0 until ORIENTATION_SCREEN_COUNT).map { orientationProgress(it) }
        assertEquals(values.sorted(), values)
        assertEquals(1f, values.last(), 0.0001f)
    }

    @Test
    fun `the bar holds for an index outside the flow`() {
        assertEquals(0.25f, orientationProgress(-3), 0.0001f)
        assertEquals(1f, orientationProgress(99), 0.0001f)
    }

    @Test
    fun `nothing to say is the ordinary answer, not a failure`() {
        // #521: every membership predating this, every owner who made their
        // own workspace, and every invite sent without a note answers null.
        // A client that treated that as an error would show an empty
        // quotation mark to the majority.
        assertNull(joiningNoteToShow(null))
    }

    @Test
    fun `a note of nothing but whitespace is nothing`() {
        // The server normalises blank to null, so this is belt-and-braces.
        // But a client that trusted it blindly would draw a lime rule beside
        // an empty line if it ever stopped.
        assertNull(joiningNoteToShow("   "))
        assertNull(joiningNoteToShow("\n\t "))
        assertEquals("Take the Bathurst jobs.", joiningNoteToShow("  Take the Bathurst jobs.  "))
    }

    @Test
    fun `the attribution repeats the words the invite email already used`() {
        // The member read `Dave says: "…"` in the email that brought them
        // here. A second phrasing over the same quote reads as a second
        // message from a second person.
        assertEquals("Dave says", joiningNoteAttribution("Dave"))
        assertEquals("Dave says", joiningNoteAttribution("  Dave  "))
    }

    @Test
    fun `an unattributed note still reads as a person`() {
        // `from` is best-effort server-side: a display name can be missing
        // while the note is not. "The workspace said" would be a lie about
        // who wrote it.
        assertEquals("They said", joiningNoteAttribution(null))
        assertEquals("They said", joiningNoteAttribution(""))
        assertEquals("They said", joiningNoteAttribution("   "))
    }

    @Test
    fun `the flow stays short`() {
        // "Short" is the Acceptance word, and four is the number the issue
        // scoped. A flow that grows past that is a tutorial, which is the
        // thing being replaced.
        assertEquals(4, ORIENTATION_SCREEN_COUNT)
        assertEquals(4, orientationCopy().size)
    }
}
