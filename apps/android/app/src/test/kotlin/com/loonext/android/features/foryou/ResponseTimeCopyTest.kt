package com.loonext.android.features.foryou

import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.ResponseTimeBaseline
import com.loonext.android.core.model.ResponseTimeReport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #239 — the arc copy, word for word with web (`response-time-card.test.ts`) and
 * iOS (`ResponseTimeCopyTests.swift`).
 *
 * Every case here is one where the easy sentence would be a flattering one. The
 * issue is explicit that the first disagreement with the crew's gut ends the
 * metric's usefulness, and a panel that only congratulates is the fastest way
 * there.
 */
class ResponseTimeCopyTest {

    /**
     * #228 moved these sentences into `InboxStrings`, so each helper now takes
     * the reader's language. Asserted in English because English is the wording
     * web owns and the three clients are held to; `AppStringsTest` holds the
     * French to the same keys and the same interpolation.
     */
    private val locale = MessageLocale.DEFAULT

    private fun report(
        median: Double? = 240.0,
        improved: Double? = null,
        baseline: Double? = null,
        unavailable: String? = null,
    ) = ResponseTimeReport(
        leads = 10,
        answered = 8,
        unanswered = 2,
        median_seconds = median,
        improved_by_seconds = improved,
        baseline = baseline?.let { ResponseTimeBaseline(5, 5, it) },
        baseline_unavailable = unavailable,
    )

    @Test
    fun `leads with the improvement, in the words a contractor repeats`() {
        assertEquals(
            "Down from 3 hr when you started",
            responseArcSentence(
                report(median = 240.0, improved = 10560.0, baseline = 10800.0),
                locale,
            ),
        )
    }

    @Test
    fun `says so when the workspace got slower`() {
        // A metric that only reports improvement is one nobody believes. This is
        // the sentence that keeps the other one credible.
        assertEquals(
            "Up from 4 min when you started",
            responseArcSentence(
                report(median = 10800.0, improved = -10560.0, baseline = 240.0),
                locale,
            ),
        )
    }

    @Test
    fun `draws no arc without a baseline, whatever the delta claims`() {
        assertNull(responseArcSentence(report(improved = 9999.0, baseline = null), locale))
    }

    @Test
    fun `draws no arc for a sub-minute change`() {
        assertNull(responseArcSentence(report(improved = 30.0, baseline = 270.0), locale))
    }

    @Test
    fun `explains a young workspace instead of comparing it to itself`() {
        assertEquals(
            "Your starting point lands once you have been here a fortnight",
            responseNoArcReason(report(unavailable = "too_new"), locale),
        )
    }

    @Test
    fun `explains an empty first fortnight rather than claiming progress from zero`() {
        assertEquals(
            "No answered leads in your first two weeks, so there is nothing to compare",
            responseNoArcReason(report(unavailable = "no_answered_leads"), locale),
        )
    }

    @Test
    fun `says flat is flat`() {
        assertEquals("About the same as when you started", responseNoArcReason(report(), locale))
    }

    @Test
    fun `names one unanswered lead in the singular, because it often is one`() {
        assertEquals("1 lead nobody answered", buildUnansweredLine(1, locale))
        assertEquals("2 leads nobody answered", buildUnansweredLine(2, locale))
    }
}
