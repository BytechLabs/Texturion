package com.loonext.android.core.model

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #247 — the catch-up offer rule, held against the TypeScript it was ported
 * from.
 *
 * The rule itself is four comparisons. What is worth guarding is not the
 * arithmetic but the HAND-PORT: this codebase has lost a `\b` to Kotlin's
 * backspace escape and shipped a Swift twin that silently disagreed, and the
 * expensive version of that here is a client that offers a catch-up the server
 * then refuses, or hides one the server would have given.
 *
 * So the constants are read out of `packages/shared/src/thread-summary.ts` at
 * test time rather than typed in below. A number typed into a test only ever
 * proves the test agrees with itself; read from the shipped source, the same
 * assertion catches either side drifting. That is the ParityVectorsTest
 * philosophy applied to a rule too small to justify generated vectors.
 */
class ThreadSummaryRuleTest {

    /**
     * Walk UP to the repo root rather than counting `../` from the working
     * directory: Gradle runs unit tests from `apps/android/app`, but that is a
     * detail of the runner rather than a promise.
     */
    /**
     * Where the catch-up's WORDS live since #228: the web catalogue.
     *
     * The shared module names keys now, so `sharedSource` no longer contains
     * any of these sentences. The ID and ORDER assertions below still read it,
     * because those are wire values a line carries in its `section` field and
     * they did not move — pointing them here would have them search a copy
     * file for ids it has never held and pass on an empty comparison.
     *
     * Sliced to the English half: the French holds the same keys, and a
     * `contains` over the whole file would ask whether a heading appears in
     * EITHER language.
     */
    private val catalogueEnglish: String by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "apps/web/src/i18n/sections/domain.ts")
            if (candidate.exists()) {
                return@lazy candidate.readText()
                    .substringAfter("export const domainEn")
                    .substringBefore("export const domainFr")
            }
            dir = dir.parentFile
        }
        throw AssertionError("apps/web/src/i18n/sections/domain.ts is not reachable")
    }

    private val sharedSource: String by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/shared/src/thread-summary.ts")
            if (candidate.exists()) return@lazy candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError(
            "packages/shared/src/thread-summary.ts not found walking up from " +
                File("").absolutePath,
        )
    }

    private fun sharedInt(name: String): Int {
        val match = Regex("export const $name = (\\d+);").find(sharedSource)
            ?: throw AssertionError(
                "$name is no longer declared in packages/shared/src/thread-summary.ts — " +
                    "the Kotlin port is now unanchored",
            )
        return match.groupValues[1].toInt()
    }

    // -- the ported constants -------------------------------------------------

    @Test
    fun `the thresholds are the ones the server enforces`() {
        assertEquals(
            "THREAD_SUMMARY_MIN_MESSAGES drifted from the shared rule",
            sharedInt("THREAD_SUMMARY_MIN_MESSAGES"),
            THREAD_SUMMARY_MIN_MESSAGES,
        )
        assertEquals(
            "THREAD_SUMMARY_IDLE_DAYS drifted from the shared rule",
            sharedInt("THREAD_SUMMARY_IDLE_DAYS"),
            THREAD_SUMMARY_IDLE_DAYS,
        )
        assertEquals(
            "THREAD_SUMMARY_IDLE_MIN_MESSAGES drifted from the shared rule",
            sharedInt("THREAD_SUMMARY_IDLE_MIN_MESSAGES"),
            THREAD_SUMMARY_IDLE_MIN_MESSAGES,
        )
    }

    @Test
    fun `the idle window is the days figure, in milliseconds, without overflowing`() {
        // The Int-overflow trap this constant is typed Long to avoid: the
        // product of the four factors must survive being computed, not merely
        // be written down correctly.
        assertEquals(THREAD_SUMMARY_IDLE_DAYS * 86_400_000L, THREAD_SUMMARY_IDLE_MS)
        assertTrue("the idle window went negative", THREAD_SUMMARY_IDLE_MS > 0L)
    }

    @Test
    fun `the section ids and headings are the shipped ones`() {
        // Ids reach the server as data (a line's `section`), so a typo here
        // renders a section that never matches and silently shows nothing.
        THREAD_SUMMARY_SECTIONS.forEach { (id, label) ->
            // The id, where ids live.
            assertTrue(
                "section id '$id' is not in the shared file",
                sharedSource.contains("id: \"$id\""),
            )
            // The heading, where headings live since #228.
            assertTrue(
                "the heading for '$id' has drifted from the catalogue: $label",
                catalogueEnglish.contains("\"$label\""),
            )
        }
        assertEquals("a section was added or dropped", 3, THREAD_SUMMARY_SECTIONS.size)
        assertEquals(
            "the reading order changed",
            listOf("asked", "we_said", "open"),
            THREAD_SUMMARY_SECTIONS.map { it.first },
        )
    }

    @Test
    fun `the attribution line is the shared one, word for word`() {
        assertTrue(
            "the attribution drifted from packages/shared — three clients now " +
                "make three different promises about what a catch-up is",
            catalogueEnglish.contains("\"$THREAD_SUMMARY_ATTRIBUTION\""),
        )
        // The promise the card has to keep. If the words stop saying a line
        // taps through to its message, the tap targets are undocumented and
        // the citation stops being checkable by the reader.
        assertTrue(THREAD_SUMMARY_ATTRIBUTION.contains("Tap any line"))
    }

    // -- the rule itself ------------------------------------------------------

    @Test
    fun `a long thread is worth a catch-up and a shorter one is not`() {
        assertTrue(shouldOfferThreadSummary(THREAD_SUMMARY_MIN_MESSAGES, 0L))
        assertFalse(shouldOfferThreadSummary(THREAD_SUMMARY_MIN_MESSAGES - 1, 0L))
    }

    @Test
    fun `a short thread earns one once it has been forgotten`() {
        assertTrue(
            shouldOfferThreadSummary(THREAD_SUMMARY_IDLE_MIN_MESSAGES, THREAD_SUMMARY_IDLE_MS),
        )
        // One day short of the window: still fresh enough to read.
        assertFalse(
            shouldOfferThreadSummary(
                THREAD_SUMMARY_IDLE_MIN_MESSAGES,
                THREAD_SUMMARY_IDLE_MS - 86_400_000L,
            ),
        )
        // Old, but there is nothing in it worth summarising.
        assertFalse(
            shouldOfferThreadSummary(THREAD_SUMMARY_IDLE_MIN_MESSAGES - 1, THREAD_SUMMARY_IDLE_MS * 10),
        )
    }

    // -- deriving the rule's inputs from a loaded thread ----------------------

    private var seq = 0

    private fun message(
        direction: String = MessageDirection.INBOUND,
        body: String = "hello",
        createdAt: String = "2026-08-01T12:00:00Z",
    ) = Message(
        id = "m${seq++}",
        conversation_id = "c1",
        direction = direction,
        body = body,
        created_at = createdAt,
    )

    /** 2026-08-01T12:00:00Z, so "now" in these cases is a fixed instant. */
    private val nowMs = java.time.Instant.parse("2026-08-01T12:00:00Z").toEpochMilli()

    @Test
    fun `internal notes are not counted toward the length`() {
        // THE load-bearing case. A crew that talks to itself on a thread must
        // not be offered a catch-up on eleven texts, and — far worse — a
        // summary must never be offered on the strength of content that by
        // design never reaches the prompt.
        val messages = List(THREAD_SUMMARY_MIN_MESSAGES - 1) { message() } +
            List(5) { message(direction = MessageDirection.NOTE) }
        assertEquals(THREAD_SUMMARY_MIN_MESSAGES - 1, countSummarisableMessages(messages))
        assertFalse(shouldOfferThreadSummaryFor(messages, nowMs))
    }

    @Test
    fun `a message with no words contributes nothing`() {
        // An attachment with an empty body is a real row and has nothing a
        // summary could quote.
        val messages = List(THREAD_SUMMARY_MIN_MESSAGES) { message(body = "  ") }
        assertEquals(0, countSummarisableMessages(messages))
        assertFalse(shouldOfferThreadSummaryFor(messages, nowMs))
    }

    @Test
    fun `idleness is measured from the customer, not from a note posted today`() {
        // The bug this helper exists to prevent. Measuring from the
        // conversation's last_message_at (or from any note) would judge a
        // thread the customer went quiet on a month ago as touched this
        // morning — withholding the catch-up from exactly the thread #247 is
        // about.
        val month = "2026-07-01T12:00:00Z"
        val quietThread = List(THREAD_SUMMARY_IDLE_MIN_MESSAGES) { message(createdAt = month) }
        assertTrue(shouldOfferThreadSummaryFor(quietThread, nowMs))

        val withTodaysNote = quietThread + message(
            direction = MessageDirection.NOTE,
            createdAt = "2026-08-01T11:59:00Z",
        )
        assertTrue(
            "a note posted today made a month-old thread look fresh",
            shouldOfferThreadSummaryFor(withTodaysNote, nowMs),
        )
    }

    @Test
    fun `idleness is measured from the newest message, not the oldest`() {
        // The first version of this asserted that reversing the loaded page
        // gave the same answer — which min and max BOTH satisfy, so it could
        // never have caught the mistake it was named after. This asserts the
        // property itself: an old thread somebody replied to an hour ago is
        // not a forgotten thread, however long its history runs.
        val messages = List(THREAD_SUMMARY_IDLE_MIN_MESSAGES - 1) {
            message(createdAt = "2026-07-01T12:00:00Z")
        } + message(createdAt = "2026-08-01T11:00:00Z")
        assertFalse(
            "a thread answered an hour ago was offered a catch-up because the " +
                "rule read its OLDEST message",
            shouldOfferThreadSummaryFor(messages, nowMs),
        )
    }

    @Test
    fun `an unparseable timestamp cannot force a catch-up onto a short thread`() {
        val messages = List(THREAD_SUMMARY_IDLE_MIN_MESSAGES) { message(createdAt = "not a date") }
        // Idle resolves to 0, so the short thread stays unoffered rather than
        // reading as infinitely old.
        assertFalse(shouldOfferThreadSummaryFor(messages, nowMs))
    }

    @Test
    fun `a message stamped in the future is not a forgotten thread`() {
        // Device clocks drift and servers stamp ahead. The tempting repair is
        // to take the absolute gap, which would turn "six months early" into
        // "six months old" and offer a catch-up on a thread from this morning.
        val future = List(THREAD_SUMMARY_IDLE_MIN_MESSAGES) {
            message(createdAt = "2027-01-01T12:00:00Z")
        }
        assertFalse(shouldOfferThreadSummaryFor(future, nowMs))
    }

    @Test
    fun `an empty thread is never offered a catch-up`() {
        assertFalse(shouldOfferThreadSummaryFor(emptyList(), nowMs))
    }
}
