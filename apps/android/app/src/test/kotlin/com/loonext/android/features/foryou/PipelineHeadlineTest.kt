package com.loonext.android.features.foryou

import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.PipelineReport
import com.loonext.android.core.model.PipelineReportResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #228 — the sentence the quotes card leads with, in three server shapes.
 *
 * The insight is composed by the SERVER, so this card cannot translate it by
 * reading a shared function the way most copy here works. The report carries a
 * KEY instead, and the priority order between the key, the English the server
 * still sends, and the card's own fallback is the whole of this file.
 *
 * Worth its own test because the middle branch is the one that only shows up
 * against a server that has not shipped yet, or a phone talking to an older
 * one — neither of which any other test here exercises.
 */
class PipelineHeadlineTest {

    private fun response(
        insight: String? = null,
        key: String? = null,
        vars: Map<String, String>? = null,
        quoted: Int = 3,
    ) = PipelineReportResponse(
        current = PipelineReport(quoted = quoted),
        insight = insight,
        insight_key = key,
        insight_vars = vars,
    )

    @Test
    fun `a named sentence is read in the reader's own language`() {
        val french = pipelineHeadline(
            response(
                insight = "You win 75% of the quotes that get an answer.",
                key = "inbox.pipelineWinRate",
                vars = mapOf("rate" to "75"),
            ),
            MessageLocale.FR_CA,
        )
        assertTrue(french, french.contains("75"))
        assertTrue(french, french.contains("devis"))
        // The English is right there in the same payload, so a client that
        // preferred it would look identical to one that had no French at all.
        assertTrue(french, !french.contains("You win"))
        assertTrue(french, !french.contains("{"))
    }

    @Test
    fun `one open quote and many read differently in French`() {
        // The reason this is three keys and not one: French agrees the noun,
        // the article and the verb with the count.
        val one = pipelineHeadline(
            response(key = "inbox.pipelineWinRateOneOpen", vars = mapOf("rate" to "75")),
            MessageLocale.FR_CA,
        )
        val many = pipelineHeadline(
            response(
                key = "inbox.pipelineWinRateManyOpen",
                vars = mapOf("rate" to "75", "open" to "4"),
            ),
            MessageLocale.FR_CA,
        )
        assertTrue(one, one.contains("devis attend"))
        assertTrue(many, many.contains("devis attendent"))
        assertTrue(many, many.contains("4"))
    }

    @Test
    fun `an older server that sends only a sentence still fills the card`() {
        // The branch nothing else exercises. Builds that predate the key are on
        // real phones for months, and the reverse — this build against a server
        // that has not shipped the key — is exactly what a staged rollout looks
        // like from here. Blank would be worse than English.
        assertEquals(
            "You win 75% of the quotes that get an answer.",
            pipelineHeadline(
                response(insight = "You win 75% of the quotes that get an answer."),
                MessageLocale.FR_CA,
            ),
        )
    }

    @Test
    fun `with nothing decided it counts the quotes instead, in French`() {
        // Not a fallback for a missing translation — a different fact. Below
        // five decided jobs the shared rule refuses to state a win rate at all.
        val text = pipelineHeadline(response(quoted = 1), MessageLocale.FR_CA)
        assertTrue(text, text.contains("devis envoyé"))
        assertTrue(text, !text.contains("inbox."))

        val many = pipelineHeadline(response(quoted = 6), MessageLocale.FR_CA)
        assertTrue(many, many.contains("devis envoyés"))
    }

    @Test
    fun `a key the catalogue does not know never reaches the screen as itself`() {
        /*
         * The resolver fails OPEN: an unknown key comes back as its own name.
         * That is the right behaviour for a client meeting a server newer than
         * itself — but it means the three keys this card can receive have to be
         * checked against the catalogue here, because nothing downstream will.
         */
        for (key in listOf(
            "inbox.pipelineWinRate",
            "inbox.pipelineWinRateOneOpen",
            "inbox.pipelineWinRateManyOpen",
        )) {
            for (locale in listOf(MessageLocale.EN, MessageLocale.FR_CA)) {
                val text = pipelineHeadline(
                    response(key = key, vars = mapOf("rate" to "75", "open" to "4")),
                    locale,
                )
                assertTrue("$locale did not answer $key", !text.contains("inbox."))
                assertTrue("$locale left a token in $key: $text", !text.contains("{"))
            }
        }
    }
}
