package com.loonext.android.features.thread

import com.loonext.android.core.model.Tag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #298 — the suggestion has to catch real duplicates without crying wolf.
 *
 * The same vectors as packages/shared/src/tag-similarity.test.ts, because this
 * file is a hand-port and a port that drifts is worse than no port: the prompt
 * would then say different things on a phone and a laptop about the same two
 * names.
 *
 * Both failures are costly and only one is obvious. Missing "Warranty" when
 * somebody types "warranty" lets the sprawl happen. Offering "was" when
 * somebody types "gas" trains them to dismiss the prompt, after which it
 * catches nothing at all — and that failure is invisible, because a dismissed
 * prompt looks exactly like a prompt that was never needed.
 */
class TagSimilarityTest {
    private fun tag(id: String, name: String) = Tag(id = id, name = name)

    private val tags = listOf(
        tag("1", "Warranty"),
        tag("2", "Quote sent"),
        tag("3", "Emergency"),
        tag("4", "Gas"),
    )

    @Test
    fun `normalize treats case, punctuation and spacing as the same idea`() {
        assertEquals("quotesent", normalizeTagName("Quote sent"))
        assertEquals("quotesent", normalizeTagName("quote-sent"))
        assertEquals("quotesent", normalizeTagName("  QUOTE  SENT  "))
    }

    @Test
    fun `normalize survives a name that is only punctuation`() {
        assertEquals("", normalizeTagName("!!!"))
    }

    @Test
    fun `edit distance counts the edits`() {
        assertEquals(1, editDistance("warranty", "warrenty"))
        assertEquals(1, editDistance("emergency", "emergancy"))
        assertEquals(0, editDistance("abc", "abc"))
    }

    @Test
    fun `edit distance bails past the cap`() {
        assertTrue(editDistance("warranty", "completely different", 3) > 3)
    }

    @Test
    fun `edit distance is symmetric`() {
        assertEquals(
            editDistance("schedule", "scheduled"),
            editDistance("scheduled", "schedule"),
        )
    }

    @Test
    fun `catches the case and punctuation variants, exactly`() {
        val warranty = suggestExistingTag("warranty", tags)
        assertEquals("1", warranty?.tag?.id)
        assertEquals(true, warranty?.exact)

        val quote = suggestExistingTag("quote-sent", tags)
        assertEquals("2", quote?.tag?.id)
        assertEquals(true, quote?.exact)
    }

    @Test
    fun `catches a typo as a near match`() {
        val warranty = suggestExistingTag("warrenty", tags)
        assertEquals("1", warranty?.tag?.id)
        assertEquals(false, warranty?.exact)

        val emergency = suggestExistingTag("emergancy", tags)
        assertEquals("3", emergency?.tag?.id)
        assertEquals(false, emergency?.exact)
    }

    @Test
    fun `does NOT fuzzy-match a short name`() {
        // "was" against "gas" is one edit and a completely different word. A
        // prompt people dismiss is a prompt that stops working.
        assertNull(suggestExistingTag("was", tags))
        assertNull(suggestExistingTag("van", tags))
    }

    @Test
    fun `leaves a genuinely new tag alone`() {
        assertNull(suggestExistingTag("Roof", tags))
        assertNull(suggestExistingTag("Needs parts", tags))
    }

    @Test
    fun `prefers an exact normalised match over a closer-looking fuzzy one`() {
        val withBoth = listOf(tag("a", "Warrantys"), tag("b", "warranty"))
        val hit = suggestExistingTag("Warranty", withBoth)
        assertEquals("b", hit?.tag?.id)
        assertEquals(true, hit?.exact)
    }

    @Test
    fun `picks the closest when several are near`() {
        val near = listOf(tag("a", "scheduling"), tag("b", "scheduled"))
        assertEquals("b", suggestExistingTag("schedule", near)?.tag?.id)
    }

    @Test
    fun `never throws on empty or punctuation-only input`() {
        assertNull(suggestExistingTag("", tags))
        assertNull(suggestExistingTag("!!!", tags))
        assertNull(suggestExistingTag("Roof", listOf(tag("x", "!!!"))))
    }

    @Test
    fun `stays within the stated threshold`() {
        // The constant is the contract three clients port; a change here is a
        // change to how noisy the prompt is on every one of them.
        assertEquals(2, TAG_SUGGEST_DISTANCE)
        assertEquals(1, tagNameDistance("Warranty", "warrenty"))
    }
}
