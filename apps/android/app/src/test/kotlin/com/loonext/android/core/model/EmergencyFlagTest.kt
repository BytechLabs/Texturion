package com.loonext.android.core.model

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #414 / #565 — the urgent mark, and that this phone agrees with the laptop and
 * with iOS about when it shows.
 *
 * Two halves. The behaviour tests assert the rule; the parity tests read
 * `packages/shared/src/emergency-flag.ts`, because this is a hand-port and
 * nothing about Kotlin says the original stayed put.
 *
 * The bug this file exists for is one layer up: `ConversationDetail` never
 * declared `emergency_at`, so `ignoreUnknownKeys` dropped it and the thread an
 * urgent notification opens was the one screen that could not say why you were
 * there. `scripts/check-conversation-detail-parity.mjs` guards that half — a
 * model missing a field the server sends. This file guards the rule that reads it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EmergencyFlagTest {

    private val WHEN = "2026-08-08T23:04:00.000Z"

    @Test
    fun `an ordinary open thread is not flagged`() {
        assertFalse(isConversationFlaggedUrgent(null, null))
    }

    @Test
    fun `an urgent thread is flagged while it is open`() {
        assertTrue(isConversationFlaggedUrgent(WHEN, null))
    }

    @Test
    fun `closing the thread clears the mark`() {
        // Closing is the product's existing word for "handled". A badge that
        // never cleared would be decoration, and a timer deciding an emergency
        // stopped mattering would be a guess made while somebody was still
        // driving to it.
        assertFalse(isConversationFlaggedUrgent(WHEN, WHEN))
    }

    @Test
    fun `a closed thread that was never urgent is not flagged`() {
        assertFalse(isConversationFlaggedUrgent(null, WHEN))
    }

    @Test
    fun `the label is not pre-shouted, so TalkBack does not spell it`() {
        assertEquals("Urgent", URGENT_BADGE_LABEL)
        assertTrue(URGENT_BADGE_LABEL != URGENT_BADGE_LABEL.uppercase())
    }

    // --- Against the original ------------------------------------------------

    private fun repoFile(relative: String): File {
        var dir = File("").absoluteFile
        while (true) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate
            dir = dir.parentFile ?: break
        }
        throw AssertionError("$relative is not reachable from ${File("").absolutePath}")
    }

    private fun sharedSource(): String =
        repoFile("packages/shared/src/emergency-flag.ts").readText()

    @Test
    fun `the shared module still reads presence rather than an ordering`() {
        // A grep rather than a second implementation: the one way this rule could
        // change without any behaviour test here failing is if the original
        // started COMPARING the two timestamps. Both answers are "a boolean", so
        // only the source shows the difference.
        val shared = sharedSource()
        assertTrue(
            "the shared rule is no longer a presence check",
            shared.contains(
                "conversation.emergency_at !== null && conversation.closed_at === null",
            ),
        )
    }

    @Test
    fun `the shared label is the word this file expects`() {
        val shared = sharedSource()
        assertTrue(
            "URGENT_BADGE_LABEL has changed in the shared module",
            shared.contains("URGENT_BADGE_LABEL = \"$URGENT_BADGE_LABEL\""),
        )
    }
}
