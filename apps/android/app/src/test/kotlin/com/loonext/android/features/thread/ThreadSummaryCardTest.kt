package com.loonext.android.features.thread

import com.loonext.android.core.model.OPT_OUT_SOURCE_CARRIER
import com.loonext.android.core.model.OPT_OUT_SOURCE_STOP
import com.loonext.android.core.model.SummaryLine
import com.loonext.android.core.model.SummaryOptOut
import com.loonext.android.core.model.THREAD_SUMMARY_NOT_ALLOWED
import com.loonext.android.core.model.THREAD_SUMMARY_REASONS
import com.loonext.android.core.model.ThreadSummary
import com.loonext.android.core.model.standing
import com.loonext.android.core.model.threadSummaryMessage
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * #247 — the three rules the catch-up card must not break, as assertions.
 *
 * These are not layout tests. Each one holds a product rule with a wrong answer
 * that is invisible in a screenshot: whether the ask comes back after a
 * refusal, whether a STOP can be displaced by something a model wrote, and
 * whether the card can ever be more than a suggestion.
 */
class ThreadSummaryCardTest {

    private fun line(
        section: String = "asked",
        text: String = "Asked for a quote on the water heater",
        messageId: String = "m1",
    ) = SummaryLine(section = section, text = text, message_id = messageId, at = "2026-08-01T12:00:00Z")

    // ---- the ask, and when it comes back -----------------------------------

    @Test
    fun `a thread the rule does not offer shows no control at all`() {
        // Not a disabled button and not an empty card: the cheapest honest
        // answer to "this thread is quicker to read" is nothing on screen.
        assertEquals(
            CatchUpState.Hidden,
            catchUpState(offered = false, reading = false, summary = null),
        )
    }

    @Test
    fun `an eligible thread is offered but nothing is fetched for it`() {
        // The cost mandate as a state: the card's resting state is an OFFER.
        // A state machine that reached Reading without a tap would spend on
        // every thread anybody opened.
        assertEquals(
            CatchUpState.Offered,
            catchUpState(offered = true, reading = false, summary = null),
        )
    }

    @Test
    fun `a retry shows the spinner, not the failure it is retrying`() {
        // The previous refusal is deliberately not cleared when a second ask
        // starts — so this is the one ordering in the state machine that can go
        // wrong. Tapping "try again" and staying on the old error message is
        // indistinguishable from the tap not registering, and the reader's next
        // move is to tap again, which spends twice.
        //
        // The first version of this asserted Reading with a NULL summary, which
        // no plausible reordering could break: it was a test of the happy path
        // wearing the name of a guard.
        val failed = ThreadSummary(reason = "model_error")
        assertEquals(
            CatchUpState.Reading(failed.standing),
            catchUpState(offered = true, reading = true, summary = failed),
        )
        // And a retry over a previous SUCCESS, which is the same hazard with a
        // stale catch-up standing in for the spinner.
        val succeeded = ThreadSummary(lines = listOf(line()))
        assertEquals(
            CatchUpState.Reading(succeeded.standing),
            catchUpState(offered = true, reading = true, summary = succeeded),
        )
        // Reading holds the displaced answer's STANDING and nothing else, and
        // this is the half of that sentence a type can carry: everything keyed
        // on "there is an answer to show" tests for `Answered`, so a spinner
        // state that joined it would put the stale lines and the stale refusal
        // back on screen under a "Reading the thread…" label.
        assertFalse(
            "Reading became an Answered state — the displaced answer is now " +
                "reachable by every branch that renders lines or a refusal",
            catchUpState(true, true, succeeded) is CatchUpState.Answered,
        )
    }

    @Test
    fun `what a re-ask holds is the standing, not the answer it arrived on`() {
        // Two answers with nothing in common except the customer's standing: a
        // catch-up full of lines, and a refusal with none. Pressing the control
        // over either must leave the card in the SAME state, because the only
        // thing either one is still authoritative about a request later is the
        // `opt_outs` read the server did.
        //
        // This is the assertion that fails if `Reading` is widened back to the
        // whole ThreadSummary. It was a comment before ("carried for the carrier
        // note and read for nothing else"), which is a rule nothing enforces:
        // the lines were one field access away from every branch, and the
        // failure would have been a three-week-old catch-up under a spinner.
        val stop = SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z")
        val withLines = ThreadSummary(lines = listOf(line()), truncated = true, opt_out = stop)
        val withNone = ThreadSummary(reason = "model_error", opt_out = stop)
        assertEquals(
            "the state held across the press can tell a catch-up from a refusal, " +
                "which means it is holding more than the carrier fact — and " +
                "whatever it can tell apart, a branch can render",
            catchUpState(true, true, withLines),
            catchUpState(true, true, withNone),
        )
    }

    @Test
    fun `reasons a repeat ask cannot fix do not offer to try again`() {
        // A "try again" that cannot change the answer is a button that lies,
        // and each press would spend another unit of a ceiling the whole
        // workspace shares.
        //
        // THREAD_SUMMARY_NOT_ALLOWED is the shipped constant, not the word: it
        // is the reader's ROLE, which is the one entry here that no amount of
        // waiting or retrying moves, and which they cannot change themselves.
        val unfixable = listOf(
            "disabled",
            "spam",
            "over_cap",
            "too_short",
            THREAD_SUMMARY_NOT_ALLOWED,
        )
        for (reason in unfixable) {
            val summary = ThreadSummary(reason = reason)
            assertEquals(
                "$reason should not invite a repeat ask",
                CatchUpState.Refused(summary, askAgain = false),
                catchUpState(false, false, summary),
            )
        }
    }

    @Test
    fun `a transient failure keeps the ask`() {
        for (reason in listOf("model_error", "unavailable", "rate_limited", "unusable_output")) {
            val summary = ThreadSummary(reason = reason)
            assertEquals(
                "$reason is transient and should still offer the ask",
                CatchUpState.Refused(summary, askAgain = true),
                catchUpState(false, false, summary),
            )
        }
    }

    @Test
    fun `lines outrank a reason that arrived with them`() {
        // The server sends `dropped` alongside a partial success. A card that
        // read any reason-shaped field as a refusal would throw away lines it
        // was given.
        val summary = ThreadSummary(lines = listOf(line()), reason = null)
        assertEquals(CatchUpState.Ready(summary), catchUpState(true, false, summary))
    }

    // ---- carrier truth ------------------------------------------------------

    @Test
    fun `a customer STOP is named as the carrier block it is`() {
        for (source in listOf(OPT_OUT_SOURCE_STOP, OPT_OUT_SOURCE_CARRIER)) {
            val note = summaryCarrierNote(SummaryOptOut(source, "2026-08-01T12:00:00Z"), null)
            assertTrue("no carrier note for source '$source'", note != null)
            assertTrue(
                "a carrier-enforced opt-out must say only the customer can undo it",
                note!!.contains("Only they can undo it"),
            )
        }
    }

    @Test
    fun `a hand-recorded opt-out is told apart from a STOP`() {
        val note = summaryCarrierNote(SummaryOptOut("manual", "2026-08-01T12:00:00Z"), null)
        assertNotNull(note)
        // Different sentence, because there is a different thing to do about
        // it — this one comes off in a tap on the contact.
        assertFalse(
            "a hand-recorded opt-out was described as a carrier block only the " +
                "customer can lift, which tells the crew a reversible thing is final",
            note!!.contains("Only they can undo it"),
        )
    }

    @Test
    fun `a standing STOP outranks a plain-English hint`() {
        val both = summaryCarrierNote(
            SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z"),
            "2026-08-02T12:00:00Z",
        )
        assertEquals(
            "the hint displaced the binding block",
            summaryCarrierNote(SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z"), null),
            both,
        )
    }

    @Test
    fun `nothing a model wrote can manufacture or silence the carrier line`() {
        // THE guard for "never bury an opt-out". The note is derived from the
        // server's deterministic opt_outs read and from nothing else, so a
        // thread full of lines about stopping produces no warning...
        val talksAboutStopping = ThreadSummary(
            lines = listOf(
                line(text = "They said stop calling about the invoice"),
                line(section = "open", text = "STOP"),
            ),
        )
        assertNull(
            "model text produced a carrier warning that no opt_outs row supports",
            summaryCarrierNote(talksAboutStopping.opt_out, talksAboutStopping.opt_out_hint_at),
        )

        // ...and a real standing STOP produces one even when Lou never
        // mentioned it, which is the direction that actually loses somebody
        // their carrier standing.
        val silentAboutIt = ThreadSummary(
            lines = listOf(line(text = "Asked us to come back Tuesday")),
            opt_out = SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z"),
        )
        assertNotNull(summaryCarrierNote(silentAboutIt.opt_out, silentAboutIt.opt_out_hint_at))
    }

    @Test
    fun `a clean thread carries no warning`() {
        assertNull(summaryCarrierNote(null, null))
    }

    // ---- carrier truth on EVERY answer, not only the good one ---------------

    /**
     * THE DEFECT THIS SECTION EXISTS FOR, in one sentence: the note was drawn
     * inside the `Ready` arm, so a workspace whose customer had texted STOP was
     * told nothing about it on any refusal — and a refusal is precisely when a
     * reader gives up on the card and goes back to skimming the thread, which
     * is the moment the warning was for.
     *
     * The three assertions below fail for three different reasons: the note
     * function not knowing about refusals, the state dropping the fields on the
     * way in, and the composable not drawing it.
     */
    @Test
    fun `every refusal shape this card can hold still carries the STOP`() {
        val stop = SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z")
        // Anchored to the shipped reason list rather than to reasons typed
        // here, so a tenth refusal cannot arrive without a warning on it.
        //
        // Every reason is paired with an opt-out, including `not_allowed`,
        // which the route cannot in fact send a body for. That is deliberate:
        // the property being pinned is the CARD's — a summary carrying carrier
        // truth draws it whatever the reason says — and pinning it per reason
        // is what stops the next refusal from being special-cased out.
        for (reason in THREAD_SUMMARY_REASONS) {
            val state = catchUpState(
                offered = true,
                reading = false,
                summary = ThreadSummary(reason = reason, opt_out = stop),
            )
            assertNotNull(
                "a '$reason' refusal buried the customer's STOP — the one fact " +
                    "on this card that a hurried reader must not miss",
                catchUpCarrierNote(state),
            )
        }
    }

    @Test
    fun `a refusal says exactly what a success would say about the block`() {
        // Not merely "something is shown". A second wording for the same fact
        // is how #437 happened, and a weaker sentence on the refusal would be
        // the same failure wearing a warning's clothes.
        val stop = SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z")
        val ready = CatchUpState.Ready(ThreadSummary(lines = listOf(line()), opt_out = stop))
        val refused = catchUpState(false, false, ThreadSummary(reason = "over_cap", opt_out = stop))
        assertNotNull("the success shape lost its own warning", catchUpCarrierNote(ready))
        assertEquals(catchUpCarrierNote(ready), catchUpCarrierNote(refused))
    }

    @Test
    fun `the states that have not been answered warn about nothing`() {
        // The opt-out arrives WITH the summary, so a card that has not asked
        // yet has been told nothing about this contact. A warning drawn there
        // would be invention, which is the failure this whole feature is
        // written around. The composer's own banner covers that stretch.
        assertNull(catchUpCarrierNote(CatchUpState.Hidden))
        assertNull(catchUpCarrierNote(CatchUpState.Offered))
        // A FIRST ask, which is the only Reading with nothing behind it. The
        // one below is the other kind.
        assertNull(catchUpCarrierNote(CatchUpState.Reading(null)))
    }

    /**
     * THE SECOND HALF OF THE SAME DEFECT: the warning came off the card at the
     * press.
     *
     * `Reading` is matched first in [catchUpState] and used to be a bare state,
     * so a workspace whose customer had texted STOP was told so on the refusal,
     * told nothing for as long as the retry took, and told again only if the
     * next answer happened to carry a body. The STOP blinked off at exactly the
     * moment somebody was acting on the card — and a warning that disappears
     * when you touch something is one a person concludes they imagined.
     *
     * Nothing here is a prediction. The held fact is the server's own last
     * `opt_outs` read, and it stays held only until an answer replaces it.
     */
    @Test
    fun `a STOP survives the re-ask that clears the refusal under it`() {
        val stop = SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z")
        // The whole sequence, in the order a person lives it. `model_error`
        // because it is a reason the header actually invites a second press on
        // — an `over_cap` card offers no retry, so it could never reach the
        // window this guard is about.
        val refusal = ThreadSummary(reason = "model_error", opt_out = stop)
        val refused = catchUpState(offered = true, reading = false, summary = refusal)
        val note = catchUpCarrierNote(refused)
        assertNotNull("the refusal itself lost the STOP", note)

        // ...and the press. `summary` is deliberately NOT cleared by the
        // controller, so the state machine is handed the same answer with
        // `reading` true — which is the whole window this guard is about.
        val reading = catchUpState(offered = true, reading = true, summary = refusal)
        assertEquals(
            "the customer's STOP came off the card the instant somebody pressed " +
                "'try again' and stayed off for the length of the request — the " +
                "one fact on this card that a hurried reader must not miss, " +
                "missing at the one moment they are acting on it",
            note,
            catchUpCarrierNote(reading),
        )
    }

    @Test
    fun `a re-ask holds the carrier fact whatever the displaced answer was`() {
        // Not only the refusal path. Anchored to the shipped reason list plus
        // the success shape, so a tenth refusal cannot arrive as the one that
        // drops the warning mid-request.
        val stop = SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z")
        val displaced = THREAD_SUMMARY_REASONS.map { ThreadSummary(reason = it, opt_out = stop) } +
            ThreadSummary(lines = listOf(line()), opt_out = stop)
        for (answer in displaced) {
            assertNotNull(
                "a re-ask over '${answer.reason ?: "a success"}' dropped the STOP " +
                    "while the request was in flight",
                catchUpCarrierNote(catchUpState(true, true, answer)),
            )
        }
    }

    @Test
    fun `a re-ask cannot manufacture a warning nobody was shown`() {
        // The other direction, and the one that would turn a held fact into an
        // invented one: holding across the press must carry the answer's own
        // SILENCE as faithfully as it carries its STOP.
        //
        // The break this is the only guard against is not a design decision, it
        // is a keystroke: `answer.opt_out_hint_at ?: ""` in catchUpCarrierNote,
        // an idle nullable-tidy that reads as harmless and turns every clean
        // thread into "someone asked to be left alone" the moment somebody
        // presses the control. Passing null through IS the meaning here.
        val clean = ThreadSummary(lines = listOf(line(text = "Asked us to come back Tuesday")))
        assertNull(
            "a clean thread grew a carrier warning out of the act of asking again",
            catchUpCarrierNote(catchUpState(true, true, clean)),
        )
    }

    /**
     * ...AND THE COMPOSABLE ACTUALLY DRAWS IT.
     *
     * A source scan, because this suite cannot render Compose — and the reason
     * it is here at all is that the pure assertions above are exactly what the
     * first version of this file had, and deleting the whole render block left
     * every one of them green. A guard for "the note reaches the screen" that
     * only calls a function is a guard for something else.
     *
     * It says nothing about what is painted. It says the call is made once, at
     * the card's own level rather than inside a state arm, and that the block
     * around it puts the string into a Text.
     */
    @Test
    fun `the carrier note is drawn outside the branch that picks a body`() {
        val body = readMainSource("features/thread/ThreadSummaryCard.kt")
            .replace("\r\n", "\n")
            .substringAfter("fun ThreadSummaryCard(")
        // The OPENING of the call, not the whole argument list. This pinned
        // `catchUpCarrierNote(state)` and #228 broke it by threading the
        // reader's language through as a second argument — which is nothing
        // this guard has an opinion about. Both things it actually asserts
        // survive the loosening: the call is still counted (exactly one), and
        // it is still located against the dispatching `when`.
        val call = "catchUpCarrierNote(state"

        // The dispatching `when`, identified by starting its own line at the
        // Column's indentation — `AiOrb(state = when (state) {` and the label's
        // AnimatedContent both contain the same words mid-line, and a guard
        // that cannot see WHICH occurrence it found is a spelling check.
        val dispatch = body.indexOf("\n        when (state) {")
        assertTrue(
            "the card's state dispatch was renamed or re-indented — point this " +
                "guard at it rather than deleting it",
            dispatch >= 0,
        )

        val at = body.indexOf(call)
        assertTrue(
            "ThreadSummaryCard never asks $call. Carrier truth is the one thing " +
                "on this card no model wrote and the one a hurried reader must " +
                "not miss; without this call it reaches nobody",
            at >= 0,
        )
        assertEquals(
            "$call must be asked exactly once. Two calls means one of them is " +
                "inside a branch, which is the shape of the original defect",
            1,
            body.split(call).size - 1,
        )
        assertTrue(
            "$call is inside the state branch. That is the defect verbatim: " +
                "the note then renders on whichever shape the branch it landed " +
                "in draws, and on none of the others",
            at < dispatch,
        )
        assertFalse(
            "the composable calls summaryCarrierNote directly. That is the " +
                "two-fields-picked-out-of-the-summary form the state-shaped one " +
                "replaced, and it can only be reached from inside a branch",
            body.contains("summaryCarrierNote("),
        )

        val block = body.substring(at, dispatch)
        assertTrue(
            "the carrier block does not put the note into a Text — it is " +
                "computed and thrown away. Block was: $block",
            block.contains("Text(") && block.contains("note,"),
        )
    }

    // ---- the failure copy ---------------------------------------------------

    @Test
    fun `every reason this card can show has copy of its own`() {
        val fallback = threadSummaryMessage("something nobody has written yet")
        for (reason in THREAD_SUMMARY_REASONS) {
            assertNotEquals(
                "'$reason' falls through to the generic shrug, which is how real " +
                    "breakage hides behind what looks like nothing to say",
                fallback,
                threadSummaryMessage(reason),
            )
        }
    }

    @Test
    fun `two reasons share copy only when they mean the same thing to the reader`() {
        // `unavailable` (no binding, or the kill switch) and `model_error` (the
        // model was reached and fell over) are different events and the SAME
        // sentence on purpose: from the reader's side both are "Lou is not
        // answering, try again", and inviting a crew to tell them apart would
        // be asking them to care about our infrastructure.
        //
        // Every other collision is accidental, and this is what catches the
        // next one — a new reason quietly copy-pasted onto an old sentence
        // tells the reader nothing about what happened.
        val deliberate = setOf(setOf("unavailable", "model_error"))
        val byCopy = THREAD_SUMMARY_REASONS.groupBy { threadSummaryMessage(it) }
        for ((copy, reasons) in byCopy) {
            if (reasons.size == 1) continue
            assertTrue(
                "${reasons.joinToString(", ")} all say \"$copy\" — if that is " +
                    "deliberate, say so here; if it is not, they cannot be " +
                    "telling the reader what happened",
                reasons.toSet() in deliberate,
            )
        }
    }

    @Test
    fun `the gate's own failures are the four the gate can return`() {
        // Anchored to apps/api/src/ai/run.ts rather than to a list typed here:
        // a fifth failure added to the single AI gate must not reach this card
        // as an unexplained shrug.
        var dir: File? = File("").absoluteFile
        var source: String? = null
        while (dir != null && source == null) {
            val candidate = File(dir, "apps/api/src/ai/run.ts")
            if (candidate.exists()) source = candidate.readText()
            dir = dir.parentFile
        }
        val union = Regex("export type AiRunFailure =([^;]+);")
            .find(requireNotNull(source) { "apps/api/src/ai/run.ts not found" })
            ?.groupValues?.get(1)
            ?: throw AssertionError("AiRunFailure is no longer declared in apps/api/src/ai/run.ts")
        val reasons = Regex("\"(\\w+)\"").findAll(union).map { it.groupValues[1] }.toList()
        assertTrue("no reasons parsed out of AiRunFailure", reasons.isNotEmpty())
        for (reason in reasons) {
            assertTrue(
                "the AI gate can answer '$reason' and this client has never heard of it",
                reason in THREAD_SUMMARY_REASONS,
            )
        }
    }

    @Test
    fun `an unknown reason still says something rather than nothing`() {
        // Degrading to silence is the rule for the LINES, never for the
        // explanation: a card with no lines and no sentence is a dead control.
        assertTrue(threadSummaryMessage(null).isNotBlank())
        assertTrue(threadSummaryMessage("brand_new_reason").isNotBlank())
    }

    @Test
    fun `the role refusal blames a role and offers no retry`() {
        val copy = threadSummaryMessage(THREAD_SUMMARY_NOT_ALLOWED)
        assertFalse(
            "'try again' at somebody whose ROLE is the refusal is a button that " +
                "lies, and it is the sentence this reason exists to stop being " +
                "shown: $copy",
            copy.contains("Try again"),
        )
        assertTrue(
            "the refusal must name who can change it — a reader who cannot act " +
                "on a sentence reads it as the app being broken: $copy",
            copy.contains("owner or admin"),
        )
    }

    // ---- reading the shipped source ------------------------------------------

    /**
     * A file from this app's own `main` source set, from wherever Gradle
     * started.
     *
     * FAILS rather than skips when it is not there. A guard that quietly passes
     * because it could not find the file it checks reads as protection and
     * provides none.
     */
    private fun readMainSource(relative: String): String {
        listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        ).forEach { base ->
            val f = File(base, relative)
            if (f.exists()) return f.readText()
        }
        fail("source not found: $relative (cwd=${File(".").absolutePath})")
        error("unreachable")
    }
}
