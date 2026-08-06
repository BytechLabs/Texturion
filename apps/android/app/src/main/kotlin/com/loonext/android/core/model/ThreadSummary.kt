package com.loonext.android.core.model

import kotlinx.serialization.Serializable

/**
 * #247 — the catch-up. Android twin of packages/shared/src/thread-summary.ts.
 *
 * The expensive part of coming back to a busy inbox is not typing, it is
 * READING: reconstructing what was asked, what the crew committed to, and what
 * is still owed. Lou could draft a reply and pull an address out of a sentence,
 * and could not tell anybody what a conversation was ABOUT.
 *
 * HAND-PORTED, which is the risk this file is written around. Shared TypeScript
 * reaches this client by hand, and the failures that have actually happened here
 * were silent ones — a `\b` that means backspace in Kotlin, an Int that wrapped.
 * So the rule below is only integer and Long comparisons: no regex, no date
 * parsing, nothing with a different meaning in another language. The constants
 * are asserted against the shipped TypeScript values in ThreadSummaryRuleTest.
 */

/**
 * Long enough that reading it is genuinely expensive.
 *
 * Twelve customer-visible messages is roughly the point where a thread stops
 * fitting on one screen and a person starts scrolling to answer "what did we
 * say about the price". Below it, reading beats summarising and the summary
 * would be the more expensive of the two — in tokens AND in the reader's time.
 */
const val THREAD_SUMMARY_MIN_MESSAGES = 12

/**
 * A shorter thread still earns a catch-up once enough time has passed, because
 * the cost this feature attacks is not only length — it is having FORGOTTEN.
 * "Call me after the 15th" three weeks ago is six messages nobody remembers.
 */
const val THREAD_SUMMARY_IDLE_DAYS = 7

/**
 * The same figure in milliseconds, so no caller does the arithmetic itself.
 *
 * Long, not Int. 604_800_000 fits in an Int today and the next person to widen
 * the window would find out it stopped fitting by getting a negative number,
 * which is the exact class of silent hand-port failure this file exists to
 * avoid.
 */
const val THREAD_SUMMARY_IDLE_MS: Long = THREAD_SUMMARY_IDLE_DAYS * 24L * 60L * 60L * 1000L

/**
 * Even a forgotten thread needs something in it. Two messages from a month ago
 * are read in four seconds, and a summary of them can only be longer than they
 * are.
 */
const val THREAD_SUMMARY_IDLE_MIN_MESSAGES = 4

/**
 * Is this thread worth a catch-up?
 *
 * Two ways a thread becomes expensive to re-read, and either is enough: it is
 * long, or it is old enough to have been forgotten. Everything else answers no,
 * which costs nothing and is the honest answer.
 *
 * The server enforces this authoritatively before anything is reserved; this
 * copy decides whether the control is even on screen, so a person is never
 * offered something that answers "there was nothing to summarise".
 *
 * @param messageCount customer-visible messages with text in them. NOTES ARE
 *   NOT COUNTED, for the same reason they never enter the prompt: a summary is
 *   about the conversation, and a crew's private note is not part of it. Use
 *   [countSummarisableMessages] rather than counting at the call site.
 * @param idleMs how long since the newest message. Never negative.
 */
fun shouldOfferThreadSummary(messageCount: Int, idleMs: Long): Boolean {
    if (messageCount >= THREAD_SUMMARY_MIN_MESSAGES) return true
    return messageCount >= THREAD_SUMMARY_IDLE_MIN_MESSAGES && idleMs >= THREAD_SUMMARY_IDLE_MS
}

/**
 * The count [shouldOfferThreadSummary] wants, from the messages this client
 * happens to have loaded.
 *
 * Notes are excluded HERE rather than at each call site, because "notes are not
 * counted" is a rule about the feature and not about one screen — and a call
 * site that forgets it does not fail, it just offers a catch-up on a thread of
 * eleven texts and one private note. Blank bodies go too: an attachment with no
 * words contributes nothing a summary could quote.
 */
fun countSummarisableMessages(messages: List<Message>): Int = messages.count(::isSummarisable)

private fun isSummarisable(message: Message): Boolean =
    (message.direction == MessageDirection.INBOUND ||
        message.direction == MessageDirection.OUTBOUND) &&
        message.body.isNotBlank()

/**
 * The offer rule applied to the messages this screen has loaded — the only form
 * a caller should use.
 *
 * Both inputs come from the SAME filtered list, which is the point. Counting
 * customer-visible messages but measuring idleness from the conversation's
 * `last_message_at` would answer with two different threads: a crew member
 * posting an internal note keeps `last_message_at` fresh, and a thread the
 * customer went quiet on three weeks ago would be judged as touched this
 * morning — silently withholding the catch-up from the exact thread this
 * feature exists for.
 *
 * The client's list is a page (50) and the threshold is 12, so a thread long
 * enough to qualify always has enough loaded to know it.
 *
 * @param nowMs injected rather than read, so a test can hold time still.
 */
fun shouldOfferThreadSummaryFor(messages: List<Message>, nowMs: Long): Boolean {
    val visible = messages.filter(::isSummarisable)
    // maxOrNull, not minOrNull and not first()/last(): idleness is a question
    // about the NEWEST message, and the loaded list's order is a pagination
    // detail no rule should depend on.
    val newestMs = visible.mapNotNull { parseIsoMs(it.created_at) }.maxOrNull()
    // coerceAtLeast upholds the ported interface's "never negative" contract
    // and nothing more — a future timestamp already fails the `>=` below, so it
    // changes no answer today. It is here so the next thing to read idleMs
    // inherits the contract rather than a surprise. What DOES matter is that
    // the repair for a drifting clock is never abs(): that would read "stamped
    // six months early" as "six months forgotten".
    val idleMs = if (newestMs == null) 0L else (nowMs - newestMs).coerceAtLeast(0L)
    return shouldOfferThreadSummary(visible.size, idleMs)
}

/**
 * Epoch millis for an ISO-8601 instant, or null if it will not parse.
 *
 * Unparseable reads as "no idea how old this is" and contributes nothing,
 * rather than defaulting to now (which would suppress the offer) or to zero
 * (which would force it on every thread with one bad row).
 */
private fun parseIsoMs(iso: String): Long? =
    runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull()

/** The three sections, in the order a person reads them. */
object ThreadSummarySection {
    const val ASKED = "asked"
    const val WE_SAID = "we_said"
    const val OPEN = "open"
}

/**
 * The fixed heading for each section, written once for all three clients.
 *
 * Ordered: what THEY wanted, what WE said back, what is still owed. That order
 * is the order the question is asked in when somebody opens a thread cold, and
 * "open" is last because it is the part a person acts on.
 *
 * #437 found the same claim written sixteen different ways because nothing
 * owned the words; three clients each inventing a heading for "what we
 * committed to" is that failure waiting to happen again.
 */
val THREAD_SUMMARY_SECTIONS: List<Pair<String, String>> = listOf(
    ThreadSummarySection.ASKED to "What they asked",
    ThreadSummarySection.WE_SAID to "What we said",
    // Not "action items". A loop is open because nobody closed it, which is a
    // statement about the conversation; an action item is an instruction, and
    // this surface does not get to give the crew instructions.
    ThreadSummarySection.OPEN to "Still open",
)

/**
 * The line shown beside the catch-up, in one place.
 *
 * A summary is Lou's reading of the thread, not a record of it. #247 is explicit
 * that a wrong summary is worse than none, because a crew ACTS on it — so the
 * surface has to say whose reading it is and that the thread is still the
 * arbiter. Every line taps through to the message it came from, which is what
 * makes that sentence true rather than a disclaimer.
 */
const val THREAD_SUMMARY_ATTRIBUTION =
    "Lou read this thread. Tap any line to see the message it came from."

/**
 * One line of the catch-up, and the citation is the point.
 *
 * [message_id] is not decoration and not a nicety: the server drops any line the
 * model could not point at, so a line that exists here is one that survived
 * being checked against a real message in the window. The card makes every line
 * tap through to that message, which is what makes the attribution true.
 */
@Serializable
data class SummaryLine(
    val section: String,
    val text: String,
    /** The message this line is grounded in. Always one the server fed the model. */
    val message_id: String,
    /** That message's timestamp, so the reader can see how old the claim is. */
    val at: String,
)

/**
 * A standing STOP on this thread's contact, as a FACT — read from `opt_outs`,
 * never inferred and never model output.
 *
 * One of these is always a read the SERVER performed. It is not always a read
 * performed for the answer carrying it: see `threadSummaryRefusal`, which puts
 * the last one the server stated onto a refusal this client had to write itself.
 */
@Serializable
data class SummaryOptOut(val source: String, val at: String)

/**
 * POST /v1/conversations/:id/summary.
 *
 * An empty [lines] is the normal "nothing to offer" answer (toggle off, spam,
 * too short to bother, over the monthly cap, model unavailable, or output that
 * failed the citation rules). A busy inbox gets silence, never an error box.
 *
 * [opt_out] and [opt_out_hint_at] ride on EVERY shape the ROUTE sends, including
 * all of its refusals, because carrier truth outranks a tidy card — see
 * ThreadSummaryCard for why they are rendered above the sections rather than
 * beside them. The one shape the route did not send is the refusal this client
 * makes up when it never got an answer at all, and `threadSummaryRefusal` states
 * exactly what those two fields mean there.
 */
@Serializable
data class ThreadSummary(
    val lines: List<SummaryLine> = emptyList(),
    /** Why the list is empty; absent on success. See [threadSummaryMessage]. */
    val reason: String? = null,
    /** Served from the cache against an unchanged thread — nothing was spent. */
    val cached: Boolean = false,
    /** The thread is longer than the window Lou was given. */
    val truncated: Boolean = false,
    val opt_out: SummaryOptOut? = null,
    val opt_out_hint_at: String? = null,
)

/**
 * The two carrier facts on their own — the part of an answer that OUTLIVES it.
 *
 * Every other field on a [ThreadSummary] describes one particular answer: the
 * lines Lou wrote, why there were none, whether the window reached the start of
 * the thread. All of them stop being current the moment somebody asks again. A
 * row in `opt_outs` does not — the customer's carrier is blocking the crew's
 * texts while a request is in flight, and it is still blocking them if that
 * request never comes back at all.
 *
 * So this is the whole of what a client may keep once the answer it arrived on
 * is gone. Two places keep it: a re-ask in flight (`CatchUpState.Reading`) and a
 * re-ask the server never answered (`threadSummaryRefusal`, which is what a 403
 * or a dead socket comes out of).
 *
 * NARROW ON PURPOSE, and that is why it is a type rather than a habit. Nothing
 * Lou wrote may be held across a request, because held model output is a stale
 * reading of a thread presented as a current one — and there is no field here to
 * hold it in.
 *
 * Built by [standing] rather than by hand: a caller that picks two fields out of
 * a response itself is a caller that can pick the wrong two.
 */
data class CarrierStanding(val optOut: SummaryOptOut?, val optOutHintAt: String?)

/**
 * What this answer stated about the contact's standing.
 *
 * Never null. An answer carrying no `opt_outs` row is stating that nothing is
 * standing, which is a fact rather than the absence of one — that distinction is
 * exactly what lets a lifted STOP clear the warning, since the answer saying so
 * replaces the held standing with its own silence.
 */
val ThreadSummary.standing: CarrierStanding
    get() = CarrierStanding(opt_out, opt_out_hint_at)

/**
 * A refusal this client makes up rather than reads: the route answered 403
 * `forbidden`, so there was no summary body to carry a reason in.
 *
 * `POST /v1/conversations/:id/summary` is gated on the `conversations.note`
 * capability, which `read_only` and `bookkeeper` do not hold — a catch-up
 * spends from a ceiling the whole workspace shares, so an observer does not get
 * to spend it. That refusal arrives as an HTTP status and never as one of the
 * eight reasons below, and the client used to fold it in with every other
 * exception and say "couldn't reach Lou". Two things wrong with that: it blames
 * our infrastructure for the reader's role, and it invites a retry that will be
 * refused identically for as long as the role stands.
 *
 * Named for the fact rather than for the role, because the gate is a capability
 * and the set of roles that fail it is free to change.
 */
const val THREAD_SUMMARY_NOT_ALLOWED = "not_allowed"

/**
 * Every reason this card can show, whether it was read or derived.
 *
 * Eight come back in the response body: four from the AI gate itself
 * (`AiRunFailure` in apps/api/src/ai/run.ts: unavailable, disabled, over_cap,
 * model_error) and four are the route's own refusals before or after the model.
 * The ninth is [THREAD_SUMMARY_NOT_ALLOWED], which no body ever carries — see
 * `MessagingRepository.threadSummary`, which is the only thing that produces it.
 *
 * Written down so exhaustiveness is testable: the failure this guards is a
 * reason arriving with no copy for it, which shows a person the generic
 * fallback and hides real breakage behind what looks like a shrug — the precise
 * mistake the drafting copy was rewritten to fix.
 */
val THREAD_SUMMARY_REASONS: List<String> = listOf(
    "unavailable",
    "disabled",
    "over_cap",
    "model_error",
    "spam",
    "too_short",
    "rate_limited",
    "unusable_output",
    THREAD_SUMMARY_NOT_ALLOWED,
)

/**
 * Plain-language copy for an empty result, mirroring replyDraftMessage.
 *
 * One blanket "nothing to summarise" hid real breakage behind what looked like
 * a shrug, so each reason says what happened and whether trying again will
 * help. The words differ from the drafting copy on purpose: "try again" means
 * something different when the last attempt cost an AI unit that a workspace
 * only gets 500 of.
 *
 * (This doc used to sit two declarations further up, above the reason list,
 * where it read as documentation for that list. Moved onto the function it
 * describes.)
 */
fun threadSummaryMessage(reason: String?): String = when (reason) {
    "disabled" -> "Catch-ups are turned off for this workspace. Settings, AI turns them back on."
    // #250: a thread somebody marked as spam never spends AI budget.
    "spam" -> "This thread is marked as spam, so Lou skips it. Unmark it to catch up."
    // The pre-filter, and the honest phrasing of it: nothing went wrong, the
    // thread is just quicker to read than a summary of it would be.
    "too_short" -> "This thread is short enough to read. Lou saves catch-ups for the long ones."
    "over_cap" -> "This month's catch-ups are used up. They start again next month."
    "rate_limited" -> "That was a lot of catch-ups at once. Try again in a moment."
    "model_error", "unavailable" -> "Couldn't reach Lou just now. Try again."
    // The reader's ROLE, not our weather — so it never says "try again", and
    // the header does not offer one either (UNFIXABLE_BY_ASKING). Names the one
    // person who can change it, in the words the composer's read-only banner
    // already uses, because a view-only member meets both in the same thread.
    THREAD_SUMMARY_NOT_ALLOWED ->
        "You can read this thread but not ask Lou to catch you up. " +
            "An owner or admin can change your access."
    // The model answered and nothing it wrote could be traced to a message.
    // Deliberately says what the rule IS: a person who reads this learns that
    // every line is quoted, which is the thing that makes the card trustworthy.
    "unusable_output" ->
        "Nothing came back that Lou could point at in the thread, so there's nothing to show."
    else -> "No catch-up this time. Try again."
}
