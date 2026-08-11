package com.loonext.android.features.thread

import com.loonext.android.core.realtime.RealtimeEvent
import java.io.File
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #607 — the client half of the payment broadcast contract.
 *
 * Two different kinds of wrong live in one small function, so the file has two
 * kinds of test.
 *
 * THE NAME CAN BE WRONG WITHOUT ANYTHING FAILING. A listener for an event no
 * trigger publishes compiles, runs, and renders a screen that is simply out of
 * date — which is indistinguishable from the bug #607 was filed about. This
 * client has shipped that exact defect once already (`task.updated` for what the
 * database calls `task.changed`), so the wire name is asserted against the
 * migration that publishes it rather than against a second copy of the string.
 *
 * THE RULE CAN BE WRONG IN THREE DIRECTIONS. Too narrow and a chargeback never
 * reaches the crew; too wide and every inbound text costs a payments round trip
 * on a feature most workspaces never switch on; wrong about which thread it
 * names and the reader watches the wrong conversation refresh.
 */
class PaymentRealtimeTest {

    // --- The name and the key are the database's, not ours ----------------------

    /**
     * Every migration that DEFINES the trigger function, in the order Postgres
     * applies them.
     *
     * Walks UP to the repo root, exactly as
     * [com.loonext.android.features.payments.PaymentsVectorsTest] does: Gradle
     * runs unit tests from `apps/android/app`, but that is a detail of the
     * runner rather than a promise.
     *
     * Found by CONTENT rather than by filename, so squashing or renaming a
     * migration cannot turn this guard into a spurious failure — or, worse,
     * into a skip.
     *
     * COMMENTS ARE STRIPPED FIRST, for the reason `check-conversation-events.mjs`
     * strips them: these migrations argue about the function at length in prose
     * above the statement that changes it, and a file merely DISCUSSING
     * `create or replace function public.broadcast_payment_change` would
     * otherwise be counted as defining it — and, being later, would shadow the
     * definition that actually runs.
     */
    private fun definingMigrations(): List<Pair<File, String>> {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val migrations = File(dir, "supabase/migrations")
            if (migrations.isDirectory) {
                return (migrations.listFiles { f -> f.extension == "sql" } ?: emptyArray())
                    .sortedBy { it.name }
                    .map { it to it.readText().replace(SQL_COMMENT, "") }
                    .filter { (_, sql) -> DEFINES_TRIGGER.containsMatchIn(sql) }
            }
            dir = dir.parentFile
        }
        throw AssertionError(
            "supabase/migrations not found walking up from ${File("").absolutePath}",
        )
    }

    /**
     * The definition that is RUNNING — the last one applied.
     *
     * This used to assert there was EXACTLY ONE, which was a time bomb with a
     * date already on it. Rule 5 of this repo makes a second `create or replace`
     * migration the only legal way to amend a shipped function, so the guard was
     * built to fail the day somebody did the right thing; #607 round two did it,
     * and `Gate / Android` would have gone red on a correct change. A guard
     * whose passing condition is "nobody has amended this yet" is watching the
     * calendar, not the contract.
     *
     * Migrations apply in filename order and `create or replace` swaps the body
     * underneath the trigger, so the LAST definition is the one in production.
     * Taking the FIRST — which is what iOS's `migrationDefining(_:)` does — is
     * the same bug inverted and silent: it passes for as long as the superseded
     * copy happens to still agree, and pins the client to a definition that
     * stopped running.
     */
    private fun runningDefinition(): Pair<File, String> {
        val defining = definingMigrations()
        assertTrue(
            "no migration defines $TRIGGER_FUNCTION — every assertion below " +
                "pins a wire name against it, so this FAILS rather than " +
                "quietly having nothing to check",
            defining.isNotEmpty(),
        )
        return defining.last()
    }

    private fun triggerDefinitionThatRuns(): String = runningDefinition().second

    @Test
    fun `the definition pinned against is the last one the database applies`() {
        val names = definingMigrations().map { it.first.name }
        assertTrue("no migration defines $TRIGGER_FUNCTION", names.isNotEmpty())

        // Deliberately asks [runningDefinition] itself rather than re-deriving
        // the answer: a test that recomputed "last" beside the helper would
        // agree with any mutation the helper grew.
        val running = runningDefinition().first.name
        assertEquals(
            "the client is pinned against a definition that is not the one " +
                "Postgres ends up running",
            names.max(),
            running,
        )
        if (names.size > 1) {
            // The assertion above is satisfied by a one-element list no matter
            // how it was chosen, so it cannot tell "last" from "first" on its
            // own — and "first" is a shipped defect on the other client. This
            // arm is the one that can, and it only exists once a second
            // `create or replace` does.
            assertNotEquals(
                "reading the FIRST definition pins this client to superseded " +
                    "SQL: ${names.first()} was replaced by ${names.last()}",
                names.first(),
                running,
            )
        }
    }

    @Test
    fun `the event this client listens for is the one the database publishes`() {
        val sql = triggerDefinitionThatRuns()

        // Anchored on the CALL rather than on any quoted string in the file: the
        // migration's prose mentions `message.created` and three other event
        // names, and a guard that matched those would pass while the published
        // name drifted. Nothing but the broadcast passes an event name followed
        // by the company id.
        val published = Regex("""'([a-z]+\.[a-z]+)',\s*new\.company_id""").find(sql)
        assertNotNull(
            "could not find the broadcast call in the migration — if it was " +
                "reformatted, re-anchor this guard rather than deleting it",
            published,
        )
        assertEquals(
            "this client listens for an event the database does not publish",
            published!!.groupValues[1],
            PAYMENT_UPDATED,
        )
    }

    @Test
    fun `the payload key this client routes on is the one the database sends`() {
        val sql = triggerDefinitionThatRuns()
        assertTrue(
            "the migration no longer puts $PAYMENT_CONVERSATION_ID on the payload " +
                "from new.conversation_id — every frame would route as 'not this thread'",
            Regex("""'$PAYMENT_CONVERSATION_ID',\s*new\.conversation_id""").containsMatchIn(sql),
        )
    }

    // --- The rule ---------------------------------------------------------------

    @Test
    fun `a payment on this thread is ours to act on`() {
        assertTrue(paymentMovedOnThread(frame(conversationId = THREAD), THREAD))
    }

    @Test
    fun `every admitted type refreshes, not just the happy one`() {
        // The trigger admits three, and two of them are money going the wrong
        // way. Narrowing to `payment_paid` is the tempting "optimisation" that
        // would leave a crew unwarned about a chargeback — the one failure the
        // strip exists to prevent.
        for (type in listOf("payment_paid", "payment_refunded", "payment_disputed")) {
            assertTrue(
                "a $type frame must reach the strip",
                paymentMovedOnThread(frame(conversationId = THREAD, type = type), THREAD),
            )
        }
        // And a frame carrying no discriminator at all still counts: the answer
        // comes from the API, so the type is news we do not read.
        assertTrue(paymentMovedOnThread(frame(conversationId = THREAD, type = null), THREAD))
    }

    @Test
    fun `a payment on another thread leaves this one alone`() {
        assertFalse(paymentMovedOnThread(frame(conversationId = "conv-other"), THREAD))
    }

    @Test
    fun `an ordinary text does not cost a payments round trip`() {
        // The strip is absent on almost every thread in the product. Reacting to
        // the events that DO fire on every thread would put a request for
        // payment rows behind every inbound message in the workspace.
        for (other in listOf("message.created", "conversation.updated", "task.changed")) {
            assertFalse(
                "$other must not refresh the payment strip",
                paymentMovedOnThread(
                    RealtimeEvent(other, buildJsonObject { put("conversation_id", THREAD) }),
                    THREAD,
                ),
            )
        }
    }

    @Test
    fun `a frame that names no thread is not this thread`() {
        assertFalse(paymentMovedOnThread(RealtimeEvent(PAYMENT_UPDATED, JsonObject(emptyMap())), THREAD))
        // A JSON null is itself a JsonPrimitive whose `.content` is the string
        // "null" — the read this uses must answer "absent", or a thread that
        // happened to be called "null" would match one.
        assertFalse(
            paymentMovedOnThread(
                RealtimeEvent(PAYMENT_UPDATED, buildJsonObject { put("conversation_id", JsonNull) }),
                "null",
            ),
        )
    }

    // --- Fixtures ---------------------------------------------------------------

    /** The frame as the migration builds it: two ids and a discriminator. */
    private fun frame(
        conversationId: String,
        type: String? = "payment_paid",
        paymentRequestId: String? = "pr-1",
    ) = RealtimeEvent(
        PAYMENT_UPDATED,
        buildJsonObject {
            put("conversation_id", conversationId)
            put("payment_request_id", paymentRequestId?.let { JsonPrimitive(it) } ?: JsonNull)
            if (type != null) put("type", type)
        },
    )

    private companion object {
        private const val THREAD = "conv-1"

        /** The migration is found by the function it defines. */
        private const val TRIGGER_FUNCTION = "broadcast_payment_change"

        /**
         * A DEFINITION, not a mention. Rule 5 forbids drop-and-create, so
         * `create or replace function` is the only shape this can take.
         */
        private val DEFINES_TRIGGER = Regex(
            """create\s+or\s+replace\s+function\s+(?:public\.)?$TRIGGER_FUNCTION\s*\(""",
            RegexOption.IGNORE_CASE,
        )

        /** Line comments and block comments, so prose cannot pose as SQL. */
        private val SQL_COMMENT = Regex("""--[^\n]*|/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL)
    }
}
