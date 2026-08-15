package com.loonext.android.core.format

import com.loonext.android.core.i18n.AppStrings
import java.util.Locale

/**
 * #313 — how a rating READS. Hand-port of `packages/shared/src/satisfaction.ts`;
 * `SatisfactionFormatTest` carries the same cases as the TS and Swift suites.
 *
 * The refusals matter more than the arithmetic here. An average of three
 * answers is noise, and #313 is explicit about what noise costs: "in a small
 * crew, a bad month for one tech is noise, and treating it as data damages
 * trust faster than it improves service." The server applies that floor and
 * sends null; nothing in this file ever fills the gap.
 */
object SatisfactionFormat {

    /** Mirrors SATISFACTION_ARC_MIN_DELTA. Below this, a move is rounding. */
    const val ARC_MIN_DELTA = 0.2

    /** Mirrors SATISFACTION_MIN_SAMPLE. */
    const val MIN_SAMPLE = 5

    /**
     * One decimal, or an em dash.
     *
     * LOCALE.US IS LOAD-BEARING, not boilerplate. Kotlin's default-locale
     * formatting renders 4.6 as "4,6" across most of Europe, which would make
     * this number disagree with the same number on the laptop — the exact
     * failure the parity guards exist to stop, and one that would only ever
     * appear on a customer's phone.
     */
    fun format(average: Double?): String {
        if (average == null || average.isNaN() || average.isInfinite()) return "—"
        return String.format(Locale.US, "%.1f", average)
    }

    /**
     * "better", "worse", or null when the honest answer is "not enough to say".
     *
     * Mirrors `arcDirection` for response time deliberately: the two cards sit
     * together, and an arc meaning one thing on one and another on the other is
     * worse than no arc at all.
     */
    fun arcDirection(improvedBy: Double?): String? {
        if (improvedBy == null || improvedBy.isNaN() || improvedBy.isInfinite()) return null
        if (Math.abs(improvedBy) < ARC_MIN_DELTA) return null
        return if (improvedBy > 0) "better" else "worse"
    }

    /**
     * The poor count as a sentence — work that happened, not a score.
     *
     * "2 jobs needed a call back" is a fact an owner can check; "customer
     * satisfaction: 87%" is a number nobody can do anything with.
     *
     * Two whole sentences rather than a count glued to a shared tail: French
     * agrees the verb with the number — "1 travail A nécessité un rappel"
     * against "3 travaux ONT nécessité un rappel" — so a shared fragment is
     * wrong in one of the two cases whichever way it is written.
     */
    fun poorRatingLine(count: Int, locale: String? = null): String =
        if (count == 1) {
            AppStrings.translate(locale, "inbox.satisfactionPoorOne")
        } else {
            AppStrings.translate(
                locale,
                "inbox.satisfactionPoorMany",
                mapOf("count" to count.toString()),
            )
        }
}
