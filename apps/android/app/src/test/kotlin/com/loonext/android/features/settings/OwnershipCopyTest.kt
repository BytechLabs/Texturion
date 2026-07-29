package com.loonext.android.features.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #332 — the sentences a workspace reads while it is changing hands.
 *
 * These are copy, not layout, and they are hand-ported to three clients. The
 * failure mode is not a crash: it is one client telling a workspace something
 * subtly different about who is taking it over and by when, which is exactly
 * the confusion an ownership handover cannot afford.
 */
class OwnershipCopyTest {
    private val ripens = "2026-08-05T12:00:00Z"
    private val expires = "2026-08-05T12:00:00Z"

    @Test
    fun `an offer names the recipient, a claim names the person asking`() {
        assertEquals(
            "Ownership has been offered to Riley Partner.",
            handoverHeadline(HandoverKind.OFFER, "Riley Partner"),
        )
        assertEquals(
            "Riley Partner has asked to take over this workspace.",
            handoverHeadline(HandoverKind.CLAIM, "Riley Partner"),
        )
    }

    @Test
    fun `an offer says nothing has changed yet`() {
        val text = handoverDetail(HandoverKind.OFFER, ready = false, ripens, expires)
        assertTrue(text, text.startsWith("Nothing changes until they accept."))
    }

    @Test
    fun `a claim in its waiting period tells the owner they can still stop it`() {
        val text = handoverDetail(HandoverKind.CLAIM, ready = false, ripens, expires)
        // The whole safety property of the claim path is that the owner knows
        // they have a deadline AND a veto. Both have to be in this sentence.
        assertTrue(text, text.contains("unless the owner stops it"))
        assertTrue(text, text.contains("immediately"))
        // And it must never read as though it already happened.
        assertTrue(text, !text.contains("has taken over"))
    }

    @Test
    fun `a ripe claim stops promising a deadline that has passed`() {
        val text = handoverDetail(HandoverKind.CLAIM, ready = true, ripens, expires)
        assertEquals(
            "The waiting period is over. They can complete this at any time.",
            text,
        )
    }

    @Test
    fun `the same button reads as a veto to an owner and a decline to a recipient`() {
        // One call, one outcome, two different things a person is doing.
        assertEquals("Stop this", handoverCancelLabel(isOwner = true, isMine = false))
        assertEquals("Decline", handoverCancelLabel(isOwner = false, isMine = true))
        // An owner turning down an offer aimed at THEM is declining, not
        // vetoing — they are the recipient in that case.
        assertEquals("Decline", handoverCancelLabel(isOwner = true, isMine = true))
    }
}
