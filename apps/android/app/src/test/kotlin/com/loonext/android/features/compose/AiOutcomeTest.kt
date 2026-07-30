package com.loonext.android.features.compose

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #431 — parity with `apps/web/src/lib/ai/outcome.test.ts`, case for case.
 *
 * The dominant risk is not a wrong label. It is reporting an outcome where none
 * happened: Lou is involved in a small fraction of the messages a crew sends, so
 * a rule that says "discarded" whenever a suggestion was not used would bury the
 * real signal under every ordinary typed message and make the ledger read as a
 * catastrophic rejection rate. Every assertNull below is that guard.
 */
class AiOutcomeTest {
    @Test
    fun `no draft shown reports nothing`() {
        // The important one. Most messages are typed with Lou uninvolved.
        assertNull(AiOutcome.forDraft(shown = false, picked = null, sent = "on my way"))
    }

    @Test
    fun `draft sent untouched is used`() {
        assertEquals(
            AiOutcome.USED,
            AiOutcome.forDraft(shown = true, picked = "On my way", sent = "On my way"),
        )
    }

    @Test
    fun `whitespace the composer adds is not an edit`() {
        assertEquals(
            AiOutcome.USED,
            AiOutcome.forDraft(shown = true, picked = "On my way", sent = "On my way\n"),
        )
    }

    @Test
    fun `draft changed before sending is edited`() {
        assertEquals(
            AiOutcome.EDITED,
            AiOutcome.forDraft(shown = true, picked = "On my way", sent = "On my way, 20 min"),
        )
    }

    @Test
    fun `drafts shown and ignored are discarded`() {
        assertEquals(
            AiOutcome.DISCARDED,
            AiOutcome.forDraft(shown = true, picked = null, sent = "different words"),
        )
    }

    @Test
    fun `enrichment that filled in nothing reports nothing`() {
        // Enrichment runs on every make-a-task and often finds no address at
        // all. That is not a rejected suggestion.
        assertNull(
            AiOutcome.forEnrichment(
                suggestedAddress = false,
                suggestedDue = false,
                addressEdited = false,
                addressCleared = false,
                dueEdited = false,
                dueCleared = false,
            ),
        )
    }

    @Test
    fun `untouched suggestions are used`() {
        assertEquals(
            AiOutcome.USED,
            AiOutcome.forEnrichment(
                suggestedAddress = true,
                suggestedDue = true,
                addressEdited = false,
                addressCleared = false,
                dueEdited = false,
                dueCleared = false,
            ),
        )
    }

    @Test
    fun `a corrected address is edited not used`() {
        // A suggestion that needed fixing is not a suggestion that was right.
        assertEquals(
            AiOutcome.EDITED,
            AiOutcome.forEnrichment(
                suggestedAddress = true,
                suggestedDue = false,
                addressEdited = true,
                addressCleared = false,
                dueEdited = false,
                dueCleared = false,
            ),
        )
    }

    @Test
    fun `one part kept and the other thrown away is edited`() {
        assertEquals(
            AiOutcome.EDITED,
            AiOutcome.forEnrichment(
                suggestedAddress = true,
                suggestedDue = true,
                addressEdited = false,
                addressCleared = false,
                dueEdited = false,
                dueCleared = true,
            ),
        )
    }

    @Test
    fun `every suggested part thrown away is cleared`() {
        assertEquals(
            AiOutcome.DISCARDED,
            AiOutcome.forEnrichment(
                suggestedAddress = true,
                suggestedDue = true,
                addressEdited = false,
                addressCleared = true,
                dueEdited = false,
                dueCleared = true,
            ),
        )
    }

    @Test
    fun `clearing a field that was never suggested is ignored`() {
        // Somebody clearing a due date they typed themselves says nothing
        // about Lou.
        assertEquals(
            AiOutcome.USED,
            AiOutcome.forEnrichment(
                suggestedAddress = true,
                suggestedDue = false,
                addressEdited = false,
                addressCleared = false,
                dueEdited = false,
                dueCleared = true,
            ),
        )
    }

    @Test
    fun `the transcript feature key is the ledger key`() {
        // Transcript outcomes are recorded SERVER-side (see AiOutcome's closing
        // comment), but the key is declared here so a client that ever needs it
        // cannot invent a friendlier spelling and open a second ledger row.
        assertEquals("voicemail_transcript", AiOutcome.FEATURE_VOICEMAIL_TRANSCRIPT)
        assertEquals("enrich", AiOutcome.FEATURE_ENRICH)
        assertEquals("suggest_reply", AiOutcome.FEATURE_SUGGEST_REPLY)
    }
}
