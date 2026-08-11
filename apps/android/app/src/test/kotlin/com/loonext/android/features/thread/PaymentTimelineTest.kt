package com.loonext.android.features.thread

import com.loonext.android.core.model.ConversationEvent
import java.io.File
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #607 A3 — one conversation, one history, on all three screens.
 *
 * ## The defect this exists to end
 *
 * The same `payment_paid` row rendered THREE DIFFERENT WAYS. Web narrated
 * nothing at all (`eventSentence` fell through and `SystemLine` returned null).
 * Android and iOS fell through to the generic arm and rendered `"Payment
 * paid"` — the type name with its underscore combed out, which is this
 * client's fallback for a row from a NEWER SERVER IT HAS NEVER HEARD OF. So a
 * crew comparing the phone against the laptop read two different histories of
 * one job, and the phone's version named no figure while claiming to be a line
 * about money.
 *
 * The answer, decided once across the three clients: NARRATE, with the amount.
 * The five types were added by `20260813040000_the_timeline_can_talk_about_money.sql`
 * precisely so a crew could see a refund WHERE THE JOB IS, and the payloads
 * carry `amount_cents`, `currency` and `description` for a reader that did not
 * exist until now.
 *
 * ## What these tests can and cannot tell
 *
 * A test that only asserted five sentences would pass forever while the server
 * grew a sixth payment type that fell straight back through to its own name —
 * which is the #607 A3 defect arriving again by a different door. So the
 * vocabulary is held to `ConversationEventType` in
 * `apps/api/src/routes/core/events.ts` by SET EQUALITY IN BOTH DIRECTIONS, and
 * the "is it narrated" question is asked as "is it NOT the generic fallback"
 * rather than by comparing against a second copy of the sentence.
 */
class PaymentTimelineTest {

    // --- The vocabulary is the server's, not ours -------------------------------

    /**
     * Walk UP to the repo root, exactly as the other cross-language guards here
     * do: Gradle runs unit tests from `apps/android/app`, but that is a detail
     * of the runner rather than a promise.
     *
     * These files are declared inputs of the test task (see the `#607 A4` block
     * in `app/build.gradle.kts`) — without that, editing one of them leaves
     * `:app:testDebugUnitTest` UP-TO-DATE and this whole file reports the
     * previous run's answer.
     */
    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.isFile) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found walking up from ${File("").absolutePath}")
    }

    /** Every source file under a directory, concatenated. */
    private fun repoDir(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.isDirectory) {
                val text = candidate.walkTopDown()
                    .filter { it.isFile && it.extension in SOURCE_EXTENSIONS }
                    .joinToString("\n") { it.readText() }
                // An empty read would make every assertion below vacuously
                // false and the failure would blame the other client for this
                // test's own broken path.
                assertTrue("$relative holds no source files", text.isNotBlank())
                return text
            }
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found walking up from ${File("").absolutePath}")
    }

    /** Every `payment_*` member of the server's `ConversationEventType` union. */
    private fun paymentTypesTheServerCanWrite(): Set<String> {
        val source = repoFile(EVENTS_UNION)
        // Anchored on the union's own `| "…"` shape, so the prose above it —
        // which names all five in a comment — cannot supply the answer.
        val types = Regex("""\|\s*"(payment_[a-z_]+)"""")
            .findAll(source)
            .map { it.groupValues[1] }
            .toSet()
        assertTrue(
            "no payment_* members found in $EVENTS_UNION — if the union was " +
                "reformatted, re-anchor this rather than deleting it: an empty " +
                "expected set makes the equality below vacuously true",
            types.isNotEmpty(),
        )
        return types
    }

    @Test
    fun `every payment type the server can write has a line of its own`() {
        // BOTH DIRECTIONS. A missing member is a row that silently renders its
        // own type name — the A3 defect. An extra member is an arm for a row
        // the server cannot write, which is a sentence nobody will ever read
        // and a wire name nobody is checking.
        assertEquals(
            "the payment types this timeline narrates and the ones the server " +
                "can write have drifted",
            paymentTypesTheServerCanWrite(),
            PAYMENT_EVENT_TYPES,
        )
    }

    @Test
    fun `no payment type falls through to the generic reading of its own name`() {
        for (type in PAYMENT_EVENT_TYPES) {
            val fallback = type.replace('_', ' ').replaceFirstChar { it.uppercase() }
            val line = eventLine(paymentEvent(type), NAMES, CONTACT)
            assertFalse(
                "$type renders \"$line\", which is the generic fallback for an " +
                    "event type this build has never heard of — the very row " +
                    "#607 A3 was filed about",
                line == fallback,
            )
            assertTrue("$type renders an empty line", line.isNotBlank())
        }
    }

    // --- The five lines ---------------------------------------------------------

    @Test
    fun `each payment line is the shared wording, with the amount in it`() {
        assertEquals("Dana asked for \$250 — Deposit", line("payment_requested"))
        assertEquals("They paid \$250 — Deposit", line("payment_paid"))
        assertEquals("Dana called off the \$250 request — Deposit", line("payment_cancelled"))
        assertEquals("\$250 went back to them — Deposit", line("payment_refunded"))
        assertEquals("Their bank pulled back \$250 — Deposit", line("payment_disputed"))
    }

    @Test
    fun `a description nobody typed leaves no dangling dash`() {
        // `payment_cancelled` carries no description at all today, and the ask
        // sheet does not require one — so the empty string is the ordinary
        // case, not an edge case. An unconditional suffix renders "They paid
        // $250 — " with the sentence trailing off.
        assertEquals("They paid \$250", line("payment_paid", description = ""))
        assertEquals("They paid \$250", line("payment_paid", description = "   "))
        assertEquals("Dana called off the \$250 request", line("payment_cancelled", description = null))
    }

    @Test
    fun `the customer's three lines never put a crew member's name on them`() {
        // The Connect webhook writes these with `actor_user_id` null precisely
        // so nobody is credited with somebody else's action. A line reading
        // "Dana paid $250" tells a crew that Dana paid the customer's invoice.
        for (type in listOf("payment_paid", "payment_refunded", "payment_disputed")) {
            val withActor = paymentEvent(type).copy(actor_user_id = "u1")
            assertFalse(
                "$type named a crew member: \"${eventLine(withActor, NAMES, CONTACT)}\"",
                eventLine(withActor, NAMES, CONTACT).contains("Dana"),
            )
            // "Someone" is the same failure wearing the system actor's clothes.
            assertFalse(
                "$type read as an anonymous crew action",
                eventLine(paymentEvent(type), NAMES, CONTACT).contains("Someone"),
            )
        }
    }

    @Test
    fun `a refund names what actually went back, not what was charged`() {
        // A PARTIAL refund is a real event, and this is the one line that can
        // tell the crew about it. Reading `amount_cents` here would report the
        // whole deposit going back when half of it did — which is a crew
        // promising a customer money that is still theirs.
        assertEquals(
            "\$120 went back to them",
            eventLine(
                paymentEvent(
                    "payment_refunded",
                    description = null,
                    extra = { put("amount_refunded_cents", 12_000) },
                ),
                NAMES,
                CONTACT,
            ),
        )
    }

    @Test
    fun `a payload carrying no amount still reads as a sentence`() {
        // Older rows, and any payload shape a later server changes. The line
        // must lose the figure rather than gain a wrong one — and must never
        // leak the JSON through: a "null" or a bare "$" on a money line is
        // worse than the fallback it replaced.
        for (type in PAYMENT_EVENT_TYPES) {
            val line = eventLine(paymentEvent(type, cents = null, description = null), NAMES, CONTACT)
            assertFalse("$type leaked a null: \"$line\"", line.contains("null"))
            assertFalse("$type printed a bare currency sign: \"$line\"", line.contains("\$"))
            assertFalse("$type fell back to its own name: \"$line\"", line.contains("_"))
            assertTrue("$type rendered nothing", line.isNotBlank())
        }
        assertEquals("Dana asked for a payment", line("payment_requested", cents = null, description = null))
        assertEquals("They paid", line("payment_paid", cents = null, description = null))
        assertEquals("Dana called off the request", line("payment_cancelled", cents = null, description = null))
        assertEquals(
            "The money went back to them",
            line("payment_refunded", cents = null, description = null),
        )
        assertEquals(
            "Their bank pulled this payment back",
            line("payment_disputed", cents = null, description = null),
        )
    }

    @Test
    fun `the amount is read as a JSON number and quoted through the formatter`() {
        // #270: `amount_cents` is a NUMBER. A string-shaped payload is refused
        // rather than half-read, so the reader loses the figure instead of
        // being shown one nobody wrote.
        val quoted = paymentEvent("payment_paid", description = null, extra = {
            put("amount_cents", "25000")
        })
        assertEquals("They paid", eventLine(quoted, NAMES, CONTACT))

        // #522: the figure is in the STRIPE ACCOUNT's currency. A CAD account
        // must not render the same glyph a USD one does with no qualifier —
        // and this is the assertion that would have caught a typed "$".
        assertEquals(
            "They paid \$250",
            line("payment_paid", currency = "cad", description = null),
        )
        assertEquals(
            "They paid \$1,000.50",
            eventLine(
                paymentEvent("payment_paid", cents = 100_050, description = null),
                NAMES,
                CONTACT,
            ),
        )
    }

    @Test
    fun `a JSON null amount is absent, not the string null`() {
        // A JSON null is itself a JsonPrimitive whose `.content` is the
        // four-letter string "null". Read carelessly it parses to nothing here,
        // but the same carelessness on `currency` would hand the formatter
        // "null" — so both are asserted.
        val nulled = ConversationEvent(
            id = "p-null",
            conversation_id = "c1",
            actor_user_id = null,
            type = "payment_paid",
            payload = buildJsonObject {
                put("amount_cents", JsonNull)
                put("currency", JsonNull)
                put("description", JsonNull)
            },
            created_at = CREATED,
        )
        assertEquals("They paid", eventLine(nulled, NAMES, CONTACT))
    }

    @Test
    fun `an empty payload is still a payment line and never the fallback`() {
        for (type in PAYMENT_EVENT_TYPES) {
            val bare = ConversationEvent(
                id = "p-bare",
                conversation_id = "c1",
                actor_user_id = null,
                type = type,
                payload = JsonObject(emptyMap()),
                created_at = CREATED,
            )
            val line = eventLine(bare, NAMES, CONTACT)
            assertFalse(
                "$type with an empty payload rendered \"$line\"",
                line == type.replace('_', ' ').replaceFirstChar { it.uppercase() },
            )
        }
    }

    // --- The other two clients --------------------------------------------------

    @Test
    fun `web and iOS narrate the same payment types this client does`() {
        // THE WHOLE POINT OF A3. Android narrating five lines while web still
        // renders null is the defect with the sides swapped — a crew comparing
        // the phone against the laptop would still read two histories.
        //
        // Asserted by ARM PRESENCE rather than by re-typing the sentences: the
        // three clients translate, capitalise and interpolate differently, and
        // a guard that demanded byte-identical output would be failed by a
        // correct localisation. What must be identical is that no client leaves
        // one of these on its fallback.
        for ((label, dir) in OTHER_CLIENTS) {
            val source = repoDir(dir)
            for (type in PAYMENT_EVENT_TYPES) {
                assertTrue(
                    "$label has no arm for $type anywhere under $dir, so that " +
                        "row renders its fallback there while this client " +
                        "narrates it — the #607 A3 defect with the sides swapped",
                    Regex("""case\s+"$type"""").containsMatchIn(source),
                )
            }
        }
    }

    // --- Fixtures ---------------------------------------------------------------

    private fun paymentEvent(
        type: String,
        cents: Int? = 25_000,
        currency: String? = "usd",
        description: String? = "Deposit",
        extra: (kotlinx.serialization.json.JsonObjectBuilder.() -> Unit)? = null,
    ) = ConversationEvent(
        id = "p-1",
        conversation_id = "c1",
        // Null is what the WEBHOOK writes. The two crew-authored types are
        // given an actor by the tests that need one.
        actor_user_id = if (type in CREW_TYPES) "u1" else null,
        type = type,
        payload = buildJsonObject {
            if (cents != null) put("amount_cents", cents)
            if (currency != null) put("currency", currency)
            if (description != null) put("description", description)
            extra?.invoke(this)
        },
        created_at = CREATED,
    )

    private fun line(
        type: String,
        cents: Int? = 25_000,
        currency: String? = "usd",
        description: String? = "Deposit",
    ): String = eventLine(paymentEvent(type, cents, currency, description), NAMES, CONTACT)

    private companion object {
        private const val CREATED = "2026-08-11T00:00:00Z"
        private const val CONTACT = "Sam"
        private val NAMES = mapOf("u1" to "Dana")

        /** The two a crew member performs, and therefore signs. */
        private val CREW_TYPES = setOf("payment_requested", "payment_cancelled")

        private const val EVENTS_UNION = "apps/api/src/routes/core/events.ts"

        private val SOURCE_EXTENSIONS = setOf("ts", "tsx", "swift")

        /**
         * Both clients switch on the event type with `case "…":`, so one anchor
         * reads both. Named so a failure says WHICH screen disagrees.
         *
         * A DIRECTORY rather than the one file that holds the arms today: web
         * split its payment lines into `payment-line.ts` while this was being
         * written, and a guard pinned to a filename would have failed a correct
         * refactor. What must not change is that the client narrates these
         * somewhere in its timeline; where it keeps them is its own business.
         */
        private val OTHER_CLIENTS = listOf(
            "web" to "apps/web/src/components/thread",
            "iOS" to "apps/ios/Loonext/Features/Thread",
        )
    }
}
