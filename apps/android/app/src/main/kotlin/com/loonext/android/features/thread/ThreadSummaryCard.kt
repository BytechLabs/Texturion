package com.loonext.android.features.thread

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CarrierStanding
import com.loonext.android.core.model.SummaryOptOut
import com.loonext.android.core.model.THREAD_SUMMARY_ATTRIBUTION
import com.loonext.android.core.model.THREAD_SUMMARY_NOT_ALLOWED
import com.loonext.android.core.model.THREAD_SUMMARY_SECTIONS
import com.loonext.android.core.model.ThreadSummary
import com.loonext.android.core.model.isCarrierEnforcedOptOut
import com.loonext.android.core.model.standing
import com.loonext.android.core.model.threadSummaryMessage
import com.loonext.android.ui.common.AiOrb
import com.loonext.android.ui.common.AiOrbState
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.theme.BrandColor

/**
 * #247 — the catch-up strip, above the thread and below the other banners.
 *
 * A tech comes off a roof at 4pm to a thread nobody has read since Tuesday.
 * This offers three short sections — what they asked, what we said, what is
 * still open — each line carrying the message it came from.
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS THIS SURFACE MUST NEVER DO, and how the layout enforces
 * each one. These are not styling notes; they are the design.
 *
 * 1. NEVER PRESENT AN INVENTED FACT. The server drops any line the model could
 *    not point at, so every line that arrives here is grounded in one real
 *    message. This card makes that checkable rather than merely true: every
 *    line is a TAP TARGET onto its own message, with a chevron and the age of
 *    the claim beside it. That is why the lines are rows and not a paragraph —
 *    a paragraph cannot be tapped back to its source, and a summary a person
 *    cannot check is one they have to take on faith.
 *    *Applying: Meaningful Highlights & Context — never just show the data.*
 *
 *    It is also why each line shows how OLD it is. The honest weakness of a
 *    cited summary is staleness, not fabrication: "we'll get someone out
 *    Tuesday" can be quoted perfectly and superseded two messages later, and a
 *    receipt makes a crew trust it MORE. The server sorts by that timestamp so
 *    the later word reads last; showing the age is this client's half of it.
 *    It does not close the hole, and nothing here pretends otherwise.
 *
 * 2. NEVER BURY AN OPT-OUT. Carrier truth renders ABOVE the sections and
 *    OUTSIDE the branch that chooses between them, from the server's
 *    deterministic `opt_outs` read — never from anything a model wrote. The
 *    composer banner further down says the same thing about SENDING; this says
 *    it about READING, which is a different hazard: the whole risk of a tidy
 *    card is that a hurried person reads it INSTEAD of the thread, and a STOP
 *    is the one fact that must survive that.
 *
 *    "Outside the branch" is not a style note. The first version of this card
 *    drew the note inside the `Ready` arm, so a workspace that had been STOPped
 *    was told nothing about it on any refusal — and a refusal is exactly when a
 *    reader falls back on skimming, which is the moment the warning was for.
 *    The fix is structural rather than a second copy of the render:
 *    [CatchUpState.Answered] is every state that holds a server answer, it
 *    carries the whole [ThreadSummary] rather than fields picked out of it, and
 *    [catchUpCarrierNote] is asked once before anything below it branches.
 *
 *    THE RE-ASK IS THE SAME DEFECT WEARING A SPINNER, and it outlived the
 *    first fix. [CatchUpState.Reading] is matched FIRST in [catchUpState], so
 *    the instant somebody pressed "try again" the state stopped being an
 *    answer and the warning came off the card — the STOP vanished at exactly
 *    the press it was meant to survive, and stayed gone for as long as the
 *    request took. A row in `opt_outs` does not stop being true while a request
 *    is in flight, so `Reading` now carries the [CarrierStanding] of the answer
 *    it displaced: that fact and nothing else about it.
 *
 *    AND THE THIRD TIME, WHICH IS THE PRESS THAT FAILS. The two refusals this
 *    client writes itself — `not_allowed` from a 403, `model_error` from a
 *    socket that never answered — have no body behind them, so they used to
 *    arrive with both carrier fields empty and REPLACE the answer that had
 *    them. The warning survived the spinner and then died on the answer, which
 *    is worse than dying at the press: it is a card that has settled. So the
 *    same standing is carried one step further, by `threadSummaryRefusal` in
 *    MessagingData.kt, and the same rule holds it — the last standing the
 *    SERVER stated, superseded by the next answer that states one.
 *
 *    What that DOES NOT do, since a comment claiming more than the code is the
 *    worse failure: the note is drawn from an `opt_outs` read the SERVER sent,
 *    so a card that has never been given one has nothing to draw. It is silent
 *    while the thread is only an offer, for the whole of a FIRST ask, and after
 *    a first ask that failed — none of those has ever been handed a read to
 *    carry. A first ask that LANDS draws the note from its own answer, like any
 *    other. The composer's own banner covers the stretch before that, from the
 *    conversation the screen already loaded.
 *
 * 3. A SUMMARY IS NOT A DECISION. Nothing here reorders the inbox, badges a
 *    row, hides a thread or scores anything. It appears on a thread the person
 *    already chose to open, and it is offered rather than taken: the card
 *    costs one row until somebody asks. That is also the cost mandate — a
 *    catch-up is the largest input this product sends, so it is never
 *    speculative, and the control only appears at all when the shared rule
 *    says the thread is long enough to be worth it.
 *
 * ---------------------------------------------------------------------------
 * There is deliberately NO re-roll. Reply drafting refuses one for the same
 * reason: every ask is a real AI call, and a button that invites a second
 * opinion on the same unchanged thread spends a workspace's month teaching
 * people to shop for a nicer answer. When the thread changes, the ask is there
 * again and the server's cache falls away on its own.
 *
 * Styled as a sibling of PinnedBanner — same radius, same insets, same cream
 * fill — because it belongs to that stack of strips and a new visual language
 * for one more strip is how a screen stops reading as one screen.
 * *Applying: The 'Safety' Principle & Relationship Strength.*
 */

/** What the strip is showing. Pure and closed, so the rule is unit-testable. */
sealed interface CatchUpState {
    /**
     * Every state that holds a [ThreadSummary] — an answer, whatever it said.
     *
     * Its existence is the fix for the defect described in (2) above. The route
     * puts `opt_out` and `opt_out_hint_at` on every response it sends, the
     * successes and the cache hits and all eight of its refusals alike, so the
     * thing that decides whether to draw the warning has to be able to see the
     * answer whatever shape it took. Sub-interface rather than a duplicated
     * field, so a third answered state inherits the warning instead of having
     * to remember it.
     *
     * The whole [ThreadSummary], because this is the answer being SHOWN: every
     * field on it describes the thing on screen right now, a field added to the
     * response reaches this card without anyone widening a constructor, and the
     * failure that would go unnoticed is one silently not carried through.
     *
     * That argument stops at the edge of this interface. [Reading] holds a
     * [CarrierStanding] instead, because it is holding a fact ACROSS a request
     * rather than displaying an answer — see there.
     */
    sealed interface Answered : CatchUpState {
        val summary: ThreadSummary
    }

    /** The thread is too short or too fresh to be worth it — no control at all. */
    data object Hidden : CatchUpState

    /** One row: "Catch me up". Nothing has been spent. */
    data object Offered : CatchUpState

    /**
     * Asked, waiting.
     *
     * [standing] is the carrier standing of the answer this ask is REPLACING —
     * whatever was on the card when somebody pressed the button, narrowed to
     * the part of it that is still true a request later. Null on a first ask,
     * which has displaced nothing. See (2) in the header and
     * [catchUpCarrierNote].
     *
     * THE TWO FIELDS RATHER THAN THE ANSWER, WHICH IS A REVERSAL. This state
     * used to hold the whole [ThreadSummary], on the argument that a field
     * added to the response would then reach the card without anyone widening a
     * constructor. That is a sound argument about an answer being displayed and
     * the wrong one about a value being HELD: the fields worth adding to this
     * response are fields describing THIS answer, and the failure to design
     * against is one of them being read a request later as though it were
     * current. "Carried for the carrier note and read for nothing else" was a
     * comment, and a comment is not a rule. A type with nothing else in it is.
     *
     * So nothing may render lines or a reason from here, and now nothing can.
     * That restriction is the whole content of "a retry shows the spinner, not
     * the failure it is retrying": a stale catch-up left under a spinner cannot
     * be told from a fresh one, and the refusal it replaced is the sentence the
     * reader just asked to be rid of. A STOP is different in kind from both —
     * not Lou's reading of anything, a row in `opt_outs` that the server read,
     * still true while a request is in flight.
     *
     * Not an [Answered], for that reason. Everything keyed on "there is an
     * answer to show" must keep skipping this state.
     */
    data class Reading(val standing: CarrierStanding?) : CatchUpState

    /** Lines came back. */
    data class Ready(override val summary: ThreadSummary) : Answered

    /**
     * No lines, and why. [askAgain] is false when repeating the ask cannot
     * change the answer — a toggle that is off, a thread marked spam, a month
     * that is spent, a role that may not spend it. Offering "try again" there
     * is a button that lies.
     */
    data class Refused(
        override val summary: ThreadSummary,
        val askAgain: Boolean,
    ) : Answered {
        /** Why there are no lines. See `threadSummaryMessage`. */
        val reason: String? get() = summary.reason
    }
}

/**
 * Reasons no repeat of the ask can fix. Everything else keeps the ask row,
 * including `model_error`: the model was reached and fell over, and the next
 * one may not.
 *
 * `too_short` is here as a backstop rather than an expectation — the client
 * applies the same offer rule the server does, so a person should never see it.
 *
 * `not_allowed` is the reader's ROLE, which no number of presses changes and
 * which they cannot change themselves. It is also the reason this set had to be
 * got right rather than left as a nicety: the row would otherwise read "Try the
 * catch-up again" at somebody who will be refused identically every time.
 */
private val UNFIXABLE_BY_ASKING =
    setOf("disabled", "spam", "over_cap", "too_short", THREAD_SUMMARY_NOT_ALLOWED)

/**
 * What the strip should show, given the thread and what has happened so far.
 *
 * Split from the composable on purpose: "does the ask row come back after a
 * refusal" is a product rule with a wrong answer that is invisible in a
 * screenshot, and this is the half a test can hold.
 */
fun catchUpState(
    /** The shared offer rule's answer for this thread. */
    offered: Boolean,
    reading: Boolean,
    summary: ThreadSummary?,
): CatchUpState = when {
    // FIRST, and the ordering is load-bearing against the RETRY: a second ask
    // leaves the previous refusal in state (it is never cleared, so a failed
    // catch-up keeps saying why until a new one replaces it). If the summary
    // branches came first, tapping "try again" would sit on the old failure
    // message with no sign anything was happening.
    //
    // And it is HANDED the displaced answer's standing rather than dropping it,
    // which is the only reason the carrier note survives the press. Coming
    // first is what made this arm the place the STOP went missing; carrying the
    // standing is what stops it going missing here. `standing`, not `summary`:
    // what crosses the press is the server's `opt_outs` read and none of Lou's
    // reading of the thread.
    reading -> CatchUpState.Reading(summary?.standing)
    summary != null && summary.lines.isNotEmpty() -> CatchUpState.Ready(summary)
    // The WHOLE summary, not `summary.reason`: the refusal is also carrying the
    // opt-out state the card has to warn about, and picking one field out of it
    // here is precisely how that warning went missing.
    summary != null -> CatchUpState.Refused(
        summary,
        askAgain = summary.reason !in UNFIXABLE_BY_ASKING,
    )
    offered -> CatchUpState.Offered
    else -> CatchUpState.Hidden
}

/**
 * Carrier truth for the top of the card, or null when there is none.
 *
 * Precedence matches the composer banner's, and for its reason: a STOP the
 * customer sent is a carrier block only they can lift, an opt-out somebody
 * recorded by hand comes off in a tap, and a plain-English hint is a judgement
 * left with the reader. Three different things to do about it, so three
 * different sentences.
 *
 * Takes the SERVER's fields. Nothing a model produced can reach this string —
 * that is the whole point of the function existing separately.
 */
fun summaryCarrierNote(optOut: SummaryOptOut?, optOutHintAt: String?): String? = when {
    optOut != null && isCarrierEnforcedOptOut(optOut.source) ->
        "They texted STOP, so their carrier is blocking your texts. Only they can undo it."
    optOut != null ->
        "Someone marked this customer opted out, so texts are blocked. Internal notes still work."
    optOutHintAt != null ->
        "Someone on this thread asked to be left alone. That request is binding " +
            "however it's worded."
    else -> null
}

/**
 * The same note, asked of the STATE rather than of two fields — the form the
 * card actually uses, and the only one it should.
 *
 * Every state holding an answer is ASKED, which is the fix for the defect in
 * (2): [CatchUpState.Refused] is most of the shapes this card renders and it
 * used to be skipped. Whether an answer produces a warning is still
 * [summaryCarrierNote]'s decision on the fields the server sent, and a refusal
 * the server never sent a body for has none — see (2) for what that leaves
 * uncovered and what covers it instead.
 *
 * [CatchUpState.Reading] is asked about the standing it is HOLDING, which is the
 * second half of the same fix. The alternative is a warning that blinks off
 * every time somebody presses the control, which is both a lie for the length
 * of the request and the exact moment a reader is least likely to notice it
 * went. The fact being held is the server's last `opt_outs` read, not a
 * prediction of the next one — and on the answered states it is that response's
 * own, which is why an answer stating the block is lifted clears the line rather
 * than being outvoted by what came before it.
 *
 * What is left returns null because there is nothing to derive a note from: the
 * opt-out arrives WITH a summary, so a [CatchUpState.Offered] card, and a
 * [CatchUpState.Reading] on a first ask, have been told nothing about this
 * contact — and a warning drawn there would be invention, the one thing this
 * whole feature is built not to do.
 */
fun catchUpCarrierNote(state: CatchUpState): String? {
    val standing = when (state) {
        is CatchUpState.Answered -> state.summary.standing
        is CatchUpState.Reading -> state.standing
        else -> null
    } ?: return null
    return summaryCarrierNote(standing.optOut, standing.optOutHintAt)
}

@Composable
fun ThreadSummaryCard(
    state: CatchUpState,
    onAsk: () -> Unit,
    /** Jump the thread to a cited message. The proof behind every line. */
    onOpenMessage: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (state is CatchUpState.Hidden) return

    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 5.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(
                if (isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHigh
                else BrandColor.Cream,
            ),
    ) {
        // The header row. Tappable ONLY while it is an offer or a retry: once
        // lines are on screen the row is a label, and a header that still
        // responds to a tap invites the re-roll this surface does not have.
        val askable = state is CatchUpState.Offered ||
            (state is CatchUpState.Refused && state.askAgain)
        Row(
            Modifier
                .fillMaxWidth()
                .then(if (askable) Modifier.clickable(onClick = onAsk) else Modifier)
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AiOrb(
                state = when (state) {
                    is CatchUpState.Reading -> AiOrbState.Thinking
                    is CatchUpState.Ready -> AiOrbState.Done
                    else -> AiOrbState.Idle
                },
                size = 14.dp,
            )
            Spacer(Modifier.width(8.dp))
            // The label swaps with a quiet fade rather than a jump, so asking
            // reads as one continuous act. *Applying: the 'Excitement'
            // Principle — a micro-interaction inside a safe structure.*
            AnimatedContent(
                targetState = when (state) {
                    is CatchUpState.Reading -> "Reading the thread…"
                    is CatchUpState.Ready -> "Lou's catch-up"
                    is CatchUpState.Refused ->
                        if (state.askAgain) "Try the catch-up again" else "Catch me up"
                    else -> "Catch me up"
                },
                transitionSpec = {
                    fadeIn(tween(durationMillis = 180)) togetherWith
                        fadeOut(tween(durationMillis = 120))
                },
                label = "catch-up-label",
                modifier = Modifier.weight(1f),
            ) { label ->
                Text(
                    label,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (askable) {
                Icon(
                    Icons.Filled.ChevronRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
            }
        }

        // CARRIER TRUTH, AND IT IS OUTSIDE THE `when` BELOW ON PURPOSE.
        //
        // See (2) in the header. This used to live inside the `Ready` arm,
        // which meant it appeared on the one shape where a reader has a summary
        // to read and on none of the shapes where they are about to go back to
        // skimming the thread. Here it sits above everything Lou wrote — and
        // above everything Lou could not write — for every answer that carried
        // an opt-out, whatever that answer was.
        catchUpCarrierNote(state)?.let { note ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 14.dp, end = 14.dp, bottom = 8.dp),
            ) {
                Icon(
                    Icons.Outlined.Block,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        when (state) {
            is CatchUpState.Refused -> {
                // Says what happened and whether asking again helps — the same
                // discipline as the drafting copy, because one blanket shrug
                // hid real breakage behind what looked like a shrug.
                Text(
                    threadSummaryMessage(state.reason),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 10.dp),
                )
            }

            is CatchUpState.Ready -> {
                val summary = state.summary

                // Fixed order, from the shared list, and a section with nothing
                // in it is absent rather than empty: an empty "Still open"
                // reads as "nothing is outstanding", which is a claim Lou did
                // not make and may not be true.
                THREAD_SUMMARY_SECTIONS.forEach { (id, label) ->
                    val lines = summary.lines.filter { it.section == id }
                    if (lines.isEmpty()) return@forEach
                    Text(
                        label,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(start = 14.dp, top = 4.dp, bottom = 2.dp),
                    )
                    lines.forEach { line ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onOpenMessage(line.message_id) }
                                .padding(horizontal = 16.dp, vertical = 8.dp)
                                .semantics {
                                    contentDescription =
                                        "${line.text}. Open the message this came from."
                                },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                line.text,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f),
                            )
                            Spacer(Modifier.width(8.dp))
                            // How old the quoted message is. See (1): the
                            // failure a citation does NOT prevent is a line
                            // that was true on Tuesday.
                            Text(
                                relativeTime(line.at),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Icon(
                                Icons.Filled.ChevronRight,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(14.dp),
                            )
                        }
                    }
                }

                if (summary.truncated) {
                    // The window is not the thread. Without this the card reads
                    // as covering everything, and "there was nothing else" is
                    // exactly the invented fact this feature must not produce.
                    Text(
                        "The thread is longer than this — Lou read the most recent part.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 2.dp),
                    )
                }

                Text(
                    THREAD_SUMMARY_ATTRIBUTION,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .padding(start = 14.dp, end = 14.dp, top = 6.dp, bottom = 10.dp),
                )
            }

            else -> Spacer(Modifier.height(2.dp))
        }
    }
}
