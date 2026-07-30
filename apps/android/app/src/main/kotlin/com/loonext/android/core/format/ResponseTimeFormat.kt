package com.loonext.android.core.format

/**
 * #239 — how a response time READS. Hand-port of
 * `packages/shared/src/response-time.ts`; `ResponseTimeFormatTest` carries the
 * same table of cases as the TS and Swift suites.
 *
 * This number is the product's whole retention argument and the customer is meant
 * to repeat it to other contractors. It has to say the same thing on the phone as
 * on the laptop, or a crew comparing two screens learns not to trust either.
 */
object ResponseTimeFormat {

    /** Rounded, coarse, and honest: the largest unit that still tells the truth. */
    fun format(seconds: Double?): String {
        // No median is a real state — a window with no answered lead. Refuse to
        // invent a zero; "0 sec" would read as instant service for a workspace
        // that answered nothing.
        if (seconds == null || seconds.isNaN() || seconds.isInfinite()) return "—"
        val total = Math.round(maxOf(0.0, seconds)).toInt()

        // Under a minute keeps its precision: it is the number worth bragging
        // about, and "under a minute" would round away the difference between a
        // fifty-second reply and a five-second one.
        if (total < 60) return "$total sec"

        // ROUNDING CARRIES. A rounded remainder can reach a whole unit of the
        // next size up: 3,599 seconds rounds to 60 minutes and 86,399 to 24
        // hours. Without the carry those print as "60 min" and "23 hr 60 min".
        var minutes = Math.round(total / 60.0).toInt()
        var hours = 0
        var days = 0
        if (minutes >= 60) {
            hours = minutes / 60
            minutes -= hours * 60
        }
        if (hours >= 24) {
            days = hours / 24
            hours -= days * 24
        }

        if (days > 0) {
            val rounded = if (hours >= 12) days + 1 else days
            return if (rounded == 1) "1 day" else "$rounded days"
        }
        if (hours > 0) {
            if (minutes == 0) return if (hours == 1) "1 hr" else "$hours hr"
            return "$hours hr $minutes min"
        }
        return if (minutes == 1) "1 min" else "$minutes min"
    }

    /**
     * A change of under a minute is not a story — it is the same performance
     * measured twice, and dressing it up as progress is how a metric earns a
     * reputation for flattery.
     */
    const val ARC_MIN_SECONDS = 60

    /** Which way the arc goes, or null when there is no arc worth drawing. */
    fun arcDirection(improvedBySeconds: Double?): String? {
        if (improvedBySeconds == null ||
            improvedBySeconds.isNaN() ||
            improvedBySeconds.isInfinite() ||
            Math.abs(improvedBySeconds) < ARC_MIN_SECONDS
        ) {
            return null
        }
        // Including the wrong direction. A metric that only ever reports
        // improvement is one nobody believes.
        return if (improvedBySeconds > 0) "faster" else "slower"
    }
}
