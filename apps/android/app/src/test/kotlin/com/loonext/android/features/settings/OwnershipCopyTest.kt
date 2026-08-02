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

    // -----------------------------------------------------------------------
    // #515 — the same handover, read by the person it is happening to.
    // Vectors shared with packages/shared/src/handover.test.ts.
    // -----------------------------------------------------------------------

    private fun ownership(
        canClaim: Boolean = false,
        pending: PendingHandover? = null,
    ) = Ownership(can_claim = canClaim, pending = pending)

    private fun pending(kind: String, mine: Boolean, ready: Boolean) =
        PendingHandover(
            kind = kind,
            ripens_at = ripens,
            expires_at = expires,
            created_at = ripens,
            mine = mine,
            ready = ready,
        )

    @Test
    fun `the named backup is given somewhere to start`() {
        // The bug #515 reported, at its root: this person could reach the API
        // and not the button, on a phone with no URL bar to type around it.
        assertEquals(
            HandoverPrompt.BACKUP_STANDING,
            viewerHandoverPrompt(ownership(canClaim = true)),
        )
    }

    @Test
    fun `an offer addressed to the reader is theirs to accept`() {
        assertEquals(
            HandoverPrompt.ACCEPT_OFFER,
            viewerHandoverPrompt(
                ownership(pending = pending(HandoverKind.OFFER, mine = true, ready = true)),
            ),
        )
    }

    @Test
    fun `a claim waits until its veto window closes`() {
        assertEquals(
            HandoverPrompt.CLAIM_WAITING,
            viewerHandoverPrompt(
                ownership(pending = pending(HandoverKind.CLAIM, mine = true, ready = false)),
            ),
        )
        assertEquals(
            HandoverPrompt.COMPLETE_CLAIM,
            viewerHandoverPrompt(
                ownership(pending = pending(HandoverKind.CLAIM, mine = true, ready = true)),
            ),
        )
    }

    @Test
    fun `somebody else's handover is not this reader's prompt`() {
        assertEquals(null, viewerHandoverPrompt(ownership()))
        assertEquals(
            null,
            viewerHandoverPrompt(
                ownership(pending = pending(HandoverKind.CLAIM, mine = false, ready = true)),
            ),
        )
    }

    @Test
    fun `the prompt speaks to the reader, and never asks them to decline their own request`() {
        for (kind in listOf(
            HandoverPrompt.ACCEPT_OFFER,
            HandoverPrompt.COMPLETE_CLAIM,
            HandoverPrompt.CLAIM_WAITING,
            HandoverPrompt.BACKUP_STANDING,
        )) {
            val line = handoverPromptHeadline(kind)
            assertTrue(line, line.startsWith("You"))
            assertTrue(line, line.endsWith("."))
        }
        assertEquals("Decline", handoverPromptCancelLabel(HandoverPrompt.ACCEPT_OFFER))
        assertEquals(
            "Withdraw my request",
            handoverPromptCancelLabel(HandoverPrompt.COMPLETE_CLAIM),
        )
        // A standing nomination has nothing to call off.
        assertEquals(null, handoverPromptCancelLabel(HandoverPrompt.BACKUP_STANDING))
    }

    @Test
    fun `the standing nomination explains what it is for, not what to do now`() {
        val text = handoverPromptDetail(HandoverPrompt.BACKUP_STANDING, ripens, expires)
        assertTrue(text, text.contains("Nothing changes until you ask."))
        val waiting = handoverPromptDetail(HandoverPrompt.CLAIM_WAITING, ripens, expires)
        // Same safety property as the crew-facing line: a deadline and a veto.
        assertTrue(waiting, waiting.contains("can stop this until"))
    }
}
