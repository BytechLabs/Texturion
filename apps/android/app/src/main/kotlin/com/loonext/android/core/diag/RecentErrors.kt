package com.loonext.android.core.diag

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * #253 — the last few things that went wrong on this device, for a report.
 *
 * The acceptance criterion is that a report carries recent errors "without the
 * user assembling them". iOS already had this (DiagnosticsLog records every API
 * failure); [CallFlowLog] on this side is deliberately about the CALL trace and
 * says so in its own header, so widening it would blur a channel whose whole
 * value is being narrow.
 *
 * # In memory only, on purpose
 *
 * A shared work tablet outlives the session typed into it. A ring that empties
 * with the process is worth less than one that persists — and worth much more
 * than one that leaves a previous crew member's customer data readable on a
 * device somebody else picked up.
 *
 * # Scrubbed at the door
 *
 * Phone-shaped digit runs and email addresses are redacted before storage, not
 * before sending. A buffer that holds PII and filters on read is one careless
 * caller away from leaking it, and the digits were never the diagnostic:
 * "POST /v1/messages/send 500 internal_error" is.
 */
object RecentErrors {
    /** Matches SUPPORT_ERROR_LINES headroom; more would never be sent. */
    private const val CAPACITY = 12

    /** Mirror of packages/shared SUPPORT_ERROR_LINES. */
    private const val REPORTED_LINES = 6

    private val lock = Any()
    private val ring = ArrayDeque<String>(CAPACITY)

    private val PHONE = Regex("""\+?\d[\d\s().-]{6,}\d""")
    private val EMAIL = Regex("""[\w.+-]+@[\w-]+\.[\w.-]+""")
    private val CLOCK: DateTimeFormatter =
        DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneOffset.UTC)

    /**
     * Redact the two things error text most often carries.
     *
     * Deliberately blunt. A rule that tries to be clever about which digit runs
     * are phone numbers will miss one, and over-redacting costs a slightly less
     * specific line — a price worth paying every single time.
     */
    fun scrub(raw: String): String =
        PHONE.replace(EMAIL.replace(raw, "[email]"), "[number]").take(160)

    /**
     * Record something that failed. Never throws: a diagnostics buffer that can
     * break the app it is diagnosing is strictly worse than no buffer.
     */
    fun record(line: String) {
        runCatching {
            val clean = scrub(line).trim()
            if (clean.isEmpty()) return
            val stamped = "${CLOCK.format(Instant.now())} $clean"
            synchronized(lock) {
                ring.addLast(stamped)
                while (ring.size > CAPACITY) ring.removeFirst()
            }
        }
    }

    /**
     * Newest first, capped for a mailto body — the failure that made somebody
     * write in is the one they hit last.
     */
    fun recentLines(): List<String> = synchronized(lock) {
        ring.toList().asReversed().take(REPORTED_LINES)
    }

    /** Test seam, and what a sign-out should call. */
    fun clear() {
        synchronized(lock) { ring.clear() }
    }
}
