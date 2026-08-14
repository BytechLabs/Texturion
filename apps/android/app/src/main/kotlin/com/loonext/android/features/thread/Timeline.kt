package com.loonext.android.features.thread

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.ConversationEvent
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.features.settings.BillingCurrency
import com.loonext.android.features.settings.billingCurrencyOrNull
import com.loonext.android.features.settings.formatMoney
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import com.loonext.android.features.calls.formatCallDuration

/**
 * Pure thread-timeline assembly: messages + optimistic pending sends + audit
 * events interleaved newest-first (the LazyColumn renders with
 * `reverseLayout = true`, so index 0 is the bottom of the screen) with day
 * dividers appended after each day's oldest item so they paint ABOVE the day.
 */

/** The in-thread Messages · Notes · Events toggles; the last one can't turn off. */
data class ThreadFilter(
    val messages: Boolean = true,
    val notes: Boolean = true,
    val events: Boolean = true,
) {
    val enabledCount: Int get() = listOf(messages, notes, events).count { it }

    fun toggledMessages(): ThreadFilter =
        if (messages && enabledCount == 1) this else copy(messages = !messages)

    fun toggledNotes(): ThreadFilter =
        if (notes && enabledCount == 1) this else copy(notes = !notes)

    fun toggledEvents(): ThreadFilter =
        if (events && enabledCount == 1) this else copy(events = !events)
}

/**
 * A locally-queued outbound send awaiting the server's queued row.
 *
 * #234 gave this row two more lives. It used to mean only "in flight, waiting
 * for the server" — and a send that could not REACH the server dropped the row
 * entirely, restored the draft and showed a toast, which is how a message
 * typed in a basement went nowhere while the person believed it had gone.
 *
 * The three states are deliberately one type rather than three, because they
 * are one message at different moments and the timeline has to keep its place
 * in the thread throughout.
 */
data class PendingSend(
    val localId: String,
    val body: String,
    val mediaCount: Int,
    val createdAt: String,
    val idempotencyKey: String,
    /**
     * #234: written to the durable outbox and waiting for signal, rather than
     * in flight right now. It MUST read differently from "Sending…" — a
     * queued message presented as on-its-way is the failure this exists to
     * prevent.
     */
    val queued: Boolean = false,
    /**
     * #234: the server answered NO at flush (a STOP arrived while this sat
     * queued, the cap was reached, registration lapsed). Not retried
     * automatically — an answer is not an outage — so the row waits for the
     * person and says why.
     */
    val blockedReason: String? = null,
)

sealed interface TimelineItem {
    val key: String
    val createdAt: String

    data class MessageItem(val message: Message) : TimelineItem {
        override val key: String get() = "m:${message.id}"
        override val createdAt: String get() = message.created_at
    }

    data class PendingItem(val pending: PendingSend) : TimelineItem {
        override val key: String get() = "p:${pending.localId}"
        override val createdAt: String get() = pending.createdAt
    }

    data class EventItem(val event: ConversationEvent) : TimelineItem {
        override val key: String get() = "e:${event.id}"
        override val createdAt: String get() = event.created_at
    }

    data class DayDivider(val label: String, val isoDay: String) : TimelineItem {
        override val key: String get() = "d:$isoDay"
        override val createdAt: String get() = isoDay
    }
}

private fun matchesFilter(message: Message, filter: ThreadFilter): Boolean =
    if (message.direction == MessageDirection.NOTE) filter.notes else filter.messages

/**
 * Events older than the oldest loaded message would interleave at the wrong
 * place, so they stay hidden until the message history is at least that deep
 * (the web applies the same rule). Once all messages are loaded, everything
 * shows.
 */
fun visibleEvents(
    events: List<ConversationEvent>,
    oldestLoadedMessageAt: String?,
    allMessagesLoaded: Boolean,
): List<ConversationEvent> = when {
    allMessagesLoaded -> events
    oldestLoadedMessageAt == null -> emptyList()
    else -> events.filter { it.created_at >= oldestLoadedMessageAt }
}

/**
 * Build the newest-first item list. [messages] and [events] arrive in server
 * DESC order; [pending] rows always render newest (they were typed just now).
 */
fun buildTimeline(
    messages: List<Message>,
    events: List<ConversationEvent>,
    pending: List<PendingSend>,
    filter: ThreadFilter,
    allMessagesLoaded: Boolean,
    zone: ZoneId,
    today: LocalDate,
    /**
     * #228: the reader's language, for the day dividers this builds. Defaults to
     * English so the pure callers — and the tests that pin the divider text —
     * read exactly as they did; the screen passes `LocalAppLocale.current`.
     */
    locale: String? = null,
): List<TimelineItem> {
    val oldestMessageAt = messages.lastOrNull()?.created_at
    val shownEvents =
        if (filter.events) visibleEvents(events, oldestMessageAt, allMessagesLoaded)
        else emptyList()
    val shownMessages = messages.filter { matchesFilter(it, filter) }

    // Merge two DESC streams by (created_at, id) DESC.
    val merged = ArrayList<TimelineItem>(shownMessages.size + shownEvents.size)
    var mi = 0
    var ei = 0
    while (mi < shownMessages.size || ei < shownEvents.size) {
        val m = shownMessages.getOrNull(mi)
        val e = shownEvents.getOrNull(ei)
        val takeMessage = when {
            m == null -> false
            e == null -> true
            m.created_at != e.created_at -> m.created_at > e.created_at
            else -> m.id >= e.id
        }
        if (takeMessage) {
            merged.add(TimelineItem.MessageItem(m!!))
            mi++
        } else {
            merged.add(TimelineItem.EventItem(e!!))
            ei++
        }
    }

    // Pending sends sit at the very bottom (newest) — newest pending first.
    val withPending = ArrayList<TimelineItem>(merged.size + pending.size + 8)
    pending.sortedByDescending { it.createdAt }.forEach {
        withPending.add(TimelineItem.PendingItem(it))
    }
    withPending.addAll(merged)

    // Day dividers: in a newest-first list a day's divider must come AFTER the
    // day's oldest item so it renders above the day with reverseLayout.
    val out = ArrayList<TimelineItem>(withPending.size + 8)
    var currentDay: LocalDate? = null
    for (item in withPending) {
        val day = localDayOf(item.createdAt, zone) ?: continue
        if (currentDay != null && day != currentDay) {
            out.add(
                TimelineItem.DayDivider(
                    dayLabel(currentDay, today, locale),
                    currentDay.toString(),
                ),
            )
        }
        currentDay = day
        out.add(item)
    }
    if (currentDay != null) {
        out.add(
            TimelineItem.DayDivider(
                dayLabel(currentDay, today, locale),
                currentDay.toString(),
            ),
        )
    }
    return out
}

fun localDayOf(iso: String, zone: ZoneId): LocalDate? =
    runCatching { Instant.parse(iso).atZone(zone).toLocalDate() }.getOrNull()

private val SAME_YEAR_DAY = DateTimeFormatter.ofPattern("EEE, MMM d")
private val OTHER_YEAR_DAY = DateTimeFormatter.ofPattern("MMM d, yyyy")

fun dayLabel(day: LocalDate, today: LocalDate, locale: String? = null): String = when {
    day == today -> AppStrings.translate(locale, "thread.dayToday")
    day == today.minusDays(1) -> AppStrings.translate(locale, "thread.dayYesterday")
    day.year == today.year -> day.format(SAME_YEAR_DAY)
    else -> day.format(OTHER_YEAR_DAY)
}

// ---------------------------------------------------------------------------
// System event lines
// ---------------------------------------------------------------------------

/**
 * A string off the payload, or null when there isn't one.
 *
 * `contentOrNull`, NOT `content`: a JSON null is itself a `JsonPrimitive` and
 * `.content` answers the four-letter string `"null"` for it. Every caller here
 * treats a non-null answer as something worth putting on screen, so the careless
 * read renders the word "null" to a crew — proved by
 * `PaymentTimelineTest.a JSON null amount is absent, not the string null`, where
 * a null `description` printed "They paid — null". `PaymentRealtime.kt` states
 * the same rule for the realtime frame; this is the timeline's half of it.
 */
private fun ConversationEvent.payloadString(key: String): String? =
    (payload[key] as? JsonPrimitive)?.contentOrNull

/**
 * A JSON NUMBER off the payload — `amount_cents` and its refund twin.
 *
 * `isString` is checked because #270 is exactly this read done carelessly: the
 * server writes these as numbers, and a quoted `"25000"` would be a payload
 * shape nobody designed. Refusing it yields the no-amount line, which says less
 * and nothing false. Absent, JSON null (whose `.content` is the four-letter
 * string "null") and anything non-numeric answer null the same way — there is
 * no figure it would be safe to guess.
 */
private fun ConversationEvent.payloadCents(key: String): Int? =
    (payload[key] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull

/**
 * What a voicemail on this timeline line SAYS, when it was transcribed. Null
 * for every other event, for an older line written before transcription
 * existed, and whenever there was nothing worth writing down.
 */
fun voicemailTranscriptOf(event: ConversationEvent): String? {
    if (event.type != "call_completed") return null
    if (event.payloadString("kind") != "voicemail") return null
    return event.payloadString("transcript")?.takeIf { it.isNotBlank() }
}

/**
 * #465: where a timeline line goes when it is tapped.
 *
 * The complaint was that these lines are only ever text: "X created a task"
 * names a task and could not open it, and a done line quotes a message and
 * could not reach it. Only the two that genuinely name a destination are
 * actionable — an assignment or a tag change names nothing to open, and a
 * false affordance is worse than a quiet line.
 *
 * `task_deleted` is deliberately absent: the task it names no longer exists.
 *
 * Kept pure and here (not in the composable) so it is unit-tested directly and
 * stays the single answer web, Android and iOS all give.
 */
sealed interface EventTarget {
    data class OpenTask(val taskId: String) : EventTarget
    data class JumpToMessage(val messageId: String) : EventTarget
}

private val TASK_EVENT_TYPES = setOf(
    "task_created",
    "task_assigned",
    "task_due_set",
    "task_attachment_added",
    "task_attachment_removed",
)

fun eventTargetOf(event: ConversationEvent): EventTarget? {
    if (event.type in TASK_EVENT_TYPES) {
        val taskId = event.payloadString("task_id")
        return if (taskId != null) EventTarget.OpenTask(taskId) else null
    }
    if (event.type == "message_done" || event.type == "message_undone") {
        val messageId = event.payloadString("message_id")
        return if (messageId != null) EventTarget.JumpToMessage(messageId) else null
    }
    return null
}

/**
 * Human line for an audit event. Unknown types fall back to a plain reading of
 * the type name so a lagging app build never renders raw snake_case.
 *
 * #228: [locale] defaults to English so the pure callers — and the tests that
 * pin these sentences — read exactly as they did; the screen passes
 * `LocalAppLocale.current`. Every actor is INTERPOLATED into the catalogue
 * sentence rather than concatenated in front of it, for the reason web's own
 * catalogue states: the subject does not sit at the front in every language.
 */
fun eventLine(
    event: ConversationEvent,
    memberNames: Map<String, String>,
    contactName: String,
    locale: String? = null,
): String {
    fun say(key: String, vararg vars: Pair<String, String>): String =
        AppStrings.translate(locale, key, vars.toMap())

    val actor = event.actor_user_id?.let { memberNames[it] }
        ?: say("thread.sysSomeone")
    val system = event.actor_user_id == null
    return when (event.type) {
        "status_changed" -> {
            val to = event.payloadString("to")
            if (to != null) {
                say("thread.sysMovedTo", "by" to actor, "status" to statusLabel(to, locale))
            } else {
                say("thread.sysStatusChanged", "by" to actor)
            }
        }

        "assigned" -> {
            val to = event.payloadString("to")
            when {
                to == null -> say("thread.sysUnassigned", "by" to actor)
                else -> say(
                    "thread.sysAssignedTo",
                    "by" to actor,
                    "name" to (memberNames[to] ?: say("thread.sysATeammate")),
                )
            }
        }

        "tag_added" -> {
            val name = event.payloadString("name")
            if (name != null) say("thread.sysTagAdded", "by" to actor, "name" to name)
            else say("thread.sysTagAddedGeneric", "by" to actor)
        }

        "tag_removed" -> say("thread.sysTagRemoved", "by" to actor)
        "opted_out" ->
            if (system) say("thread.sysOptedOutSystem", "name" to contactName)
            else say("thread.sysOptedOutBy", "by" to actor, "name" to contactName)

        "opt_out_revoked" ->
            if (system) say("thread.sysOptedInSystem", "name" to contactName)
            else say("thread.sysOptOutRevoked", "by" to actor)

        "consent_attested" ->
            say("thread.sysConsentAttested", "by" to actor, "name" to contactName)
        // #225: names the FACT (a send landed in the customer's quiet window), not
        // an attestation. With the confirmation switched off the same event is
        // written and nobody confirmed anything, so "confirmed" would be a lie —
        // and web has always said it this way, so this is parity too.
        "quiet_hours_confirmed" -> say("thread.sysQuietHours", "by" to actor)
        // #237: the actor is the CUSTOMER, who has no user row, so this line
        // carries no name. "Sam confirmed the appointment" would credit the
        // crew with the customer's answer.
        "appointment_confirmed" -> say("thread.sysAppointmentConfirmed")
        // #313: the customer again, so no name. The SCORE is the whole line.
        "job_rated" ->
            say("thread.sysJobRated", "score" to (event.payloadString("score") ?: "?"))
        "spam_marked" -> say("thread.sysSpamMarked", "by" to actor)
        "spam_unmarked" -> say("thread.sysSpamUnmarked", "by" to actor)
        "message_done" -> say("thread.sysMessageDone", "by" to actor)
        "message_undone" -> say("thread.sysMessageUndone", "by" to actor)
        "task_created" -> say("thread.sysTaskCreated", "by" to actor)
        "task_assigned" -> say("thread.sysTaskAssigned", "by" to actor)
        "task_due_set" -> say("thread.sysTaskDueSet", "by" to actor)
        "task_deleted" -> say("thread.sysTaskDeleted", "by" to actor)
        // #317 — a file this customer sent that we would not store. Same copy
        // as web (system-line.tsx) and iOS (Timeline.swift), word for word: a
        // crew comparing the phone and the laptop must not read two different
        // histories for one conversation. The sentences themselves now live in
        // `core/i18n/ThreadStrings.kt`, which is where the parity guard reads
        // them — the same move web made when its copy left `system-line.tsx`.
        "media_refused" -> mediaRefusedLine(event, locale)
        "note_attachment_added" -> say("thread.sysNoteAttachmentAdded", "by" to actor)
        "note_attachment_removed" -> say("thread.sysNoteAttachmentRemoved", "by" to actor)
        "task_attachment_added" -> say("thread.sysTaskAttachmentAdded", "by" to actor)
        "task_attachment_removed" -> say("thread.sysTaskAttachmentRemoved", "by" to actor)
        "missed_call" -> say("thread.sysMissedCallFrom", "name" to contactName)
        // #273: the server puts direction, outcome, forward_seconds and a
        // transfer pair on this payload, and this arm read ONE of them. Every
        // shape that was not a voicemail collapsed to "Call with X ended", so a
        // 4:32 outbound call, a missed call and a transfer were indistinguishable
        // on the phone while web showed all three. A crew comparing web and
        // mobile saw two different histories for one conversation.
        //
        // Branch order matters and mirrors web exactly (system-line.tsx): a
        // voicemail is also an inbound call with an outcome, so the specific
        // shapes have to be tested before the generic ones.
        "call_completed" -> callCompletedLine(event, memberNames, locale)
        "auto_reply_sent" -> say("thread.sysAutoReplySent")
        // #607/#224 — money. See `paymentLine`: these five had no arm, so they
        // fell through to the generic reading below and the transcript said
        // "Payment paid" where web said nothing at all.
        in PAYMENT_EVENT_TYPES -> paymentLine(event, actor, locale)
        else -> event.type.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }
}

/**
 * #607 A3 — the five timeline types text-to-pay writes, narrated.
 *
 * ## Why they are narrated at all, on every client
 *
 * Because `20260813040000_the_timeline_can_talk_about_money.sql` says so, in the
 * prose it shipped with: refunded and disputed are events rather than statuses
 * "because they are the two events a crew most needs to see WHERE THE JOB IS —
 * a refund discussed in Stripe and invisible in the thread is how two people end
 * up telling a customer different things". `apps/api/src/routes/core/events.ts`
 * repeats the commitment. Rows are written, with the amount on them, for the
 * express purpose of being read here.
 *
 * Three clients disagreed about that. Web narrated nothing — `eventSentence`
 * returned falsy and `SystemLine` rendered null. Both phones fell through to the
 * generic arm and rendered `"Payment paid"`: the type name with its underscore
 * combed out, which is the fallback for a row from a NEWER SERVER THIS BUILD HAS
 * NEVER HEARD OF. It was neither the designed line nor silence, it named no
 * figure, and a crew comparing a phone against a laptop read two different
 * histories of one conversation.
 *
 * ## Why with the amount
 *
 * The amount is the whole content of the event — "Payment paid" answers a
 * question nobody asked, while "They paid $250" is the line somebody scrolls
 * back for. `amount_cents`, `currency` and `description` are on every one of
 * these payloads already (payments.ts and stripe-connect.ts both write them),
 * so this costs no fetch.
 *
 * The strip above the composer shows the same figures for as long as the
 * request is live; this is where they go afterwards. `Payments.kt`'s own window
 * comment has said so since #224 — "After it, the request is history and the
 * timeline holds it" — and until now the timeline did not.
 *
 * ## The words are not this client's to choose
 *
 * Every line below is the shared #607 A3 wording, decided once and implemented
 * identically on web, iOS and here. `PaymentTimelineTest` asserts each type has
 * an arm on all three clients, because a line that is right on one screen and
 * absent on another is the defect, not the fix.
 */
private fun paymentLine(
    event: ConversationEvent,
    actor: String,
    locale: String?,
): String {
    fun say(key: String, vararg vars: Pair<String, String>): String =
        AppStrings.translate(locale, key, vars.toMap())

    // Through the money formatter, never typed, at the PAYLOAD's currency as
    // both amount and audience — the same rule PaymentStrip states: this figure
    // is in the STRIPE ACCOUNT's currency, which need not be the one the
    // workspace is billed in, and a bare "$" at the wrong reader is #522 with a
    // new figure.
    val money = billingCurrencyOrNull(event.payloadString("currency")) ?: BillingCurrency.USD
    val cents = event.payloadCents("amount_cents")
    val amount = cents?.let { formatMoney(it, money) }

    val head = when (event.type) {
        // The crew, who have a user row, so these two carry their name.
        "payment_requested" ->
            if (amount != null) {
                say("thread.sysPaymentRequested", "by" to actor, "amount" to amount)
            } else {
                say("thread.sysPaymentRequestedGeneric", "by" to actor)
            }

        "payment_cancelled" ->
            if (amount != null) {
                say("thread.sysPaymentCancelled", "by" to actor, "amount" to amount)
            } else {
                say("thread.sysPaymentCancelledGeneric", "by" to actor)
            }

        // The customer, and then their bank. `actor_user_id` is null on all
        // three of these — the Connect webhook writes them, and stamping a crew
        // member would put a name against somebody else's action — so they name
        // nobody, the way `appointment_confirmed` and `job_rated` already do.
        "payment_paid" ->
            if (amount != null) say("thread.sysPaymentPaid", "amount" to amount)
            else say("thread.sysPaymentPaidGeneric")

        "payment_refunded" -> {
            // What actually went back, when the webhook recorded it: a PARTIAL
            // refund is a real event, and the figure that moved is the one the
            // crew needs. Falls back to the charge for a payload that recorded
            // no refund figure, which is the shared decision's rule across all
            // three clients.
            val back = event.payloadCents("amount_refunded_cents")?.takeIf { it > 0 } ?: cents
            if (back != null) {
                say("thread.sysPaymentRefunded", "amount" to formatMoney(back, money))
            } else {
                say("thread.sysPaymentRefundedGeneric")
            }
        }

        // Same words as `payments.disputedNote` on the strip, which says "Their
        // bank has pulled this back": one event, one vocabulary.
        "payment_disputed" ->
            if (amount != null) say("thread.sysPaymentDisputed", "amount" to amount)
            else say("thread.sysPaymentDisputedGeneric")

        // Unreachable — `PAYMENT_EVENT_TYPES` is the set of arms above and
        // `PaymentTimelineTest` holds the two to each other in both directions.
        // Falls back to the generic reading rather than throwing, because a
        // crash is a worse answer than a plain one on a screen that is only
        // being read.
        else -> event.type.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }

    // WHAT IT WAS FOR, when the crew typed one. `payment_cancelled` carries no
    // description today, so its arm simply never appends — that is a fact about
    // the payload rather than a rule about the line, which is why this is one
    // shared suffix and not five branches that would drift the moment the
    // cancel route started writing it.
    val description = event.payloadString("description")?.takeIf { it.isNotBlank() }
    return if (description != null) {
        say("thread.sysPaymentWithDescription", "line" to head, "description" to description)
    } else {
        head
    }
}

/**
 * The payment types this timeline narrates.
 *
 * Public, and matched against rather than re-listed at the `when`, so
 * `PaymentTimelineTest` can hold it to `ConversationEventType` in
 * `apps/api/src/routes/core/events.ts` — SET EQUALITY, both directions. A
 * missing member is a row that silently falls back to its own type name (the
 * #607 A3 defect); an extra member is an arm for a row the server cannot write.
 */
val PAYMENT_EVENT_TYPES = setOf(
    "payment_requested",
    "payment_paid",
    "payment_cancelled",
    "payment_refunded",
    "payment_disputed",
)

/**
 * The #317 refused-attachment line.
 *
 * There is no attachment row to render — that is the point — so this stands in
 * its place. Without it the crew sees a text with no picture and concludes the
 * customer forgot to attach one. Every arm ends in what to DO about it, which is
 * the only part they can act on between jobs.
 */
private fun mediaRefusedLine(event: ConversationEvent, locale: String?): String =
    when (event.payloadString("reason")) {
        "too_large" -> AppStrings.translate(locale, "thread.sysMediaTooLarge")

        "empty" -> AppStrings.translate(locale, "thread.sysMediaEmpty")

        "type_mismatch" -> AppStrings.translate(locale, "thread.sysMediaTypeMismatch")

        // #317: the file WAS the type it claimed and the type is allowed —
        // what is inside it is the problem. One line, one action: which of a
        // macro project, a packed program or an auto-running script it turned
        // out to be changes nothing the crew can do about it.
        "unsafe_content" -> AppStrings.translate(locale, "thread.sysMediaUnsafe")

        "unreadable" -> AppStrings.translate(locale, "thread.sysMediaUnreadable")

        "too_many_items" -> {
            val kept = event.payloadString("index")?.toIntOrNull() ?: 0
            if (kept > 0) {
                AppStrings.translate(
                    locale,
                    "thread.sysMediaTooManyKept",
                    mapOf("kept" to kept.toString()),
                )
            } else {
                AppStrings.translate(locale, "thread.sysMediaTooMany")
            }
        }
        // unsupported_type, and anything a later server adds: the honest general
        // case, still ending in the thing that works.
        else -> AppStrings.translate(locale, "thread.sysMediaUnsupported")
    }

fun statusLabel(status: String, locale: String? = null): String = when (status) {
    "new" -> AppStrings.translate(locale, "thread.statusNew")
    "open" -> AppStrings.translate(locale, "thread.statusOpen")
    "waiting" -> AppStrings.translate(locale, "thread.statusWaiting")
    "closed" -> AppStrings.translate(locale, "thread.statusClosed")
    else -> status.replaceFirstChar { it.uppercase() }
}

/**
 * display_name lookup for event lines + assignee UI.
 *
 * [unnamed] is what somebody with a blank display name is called. Passed in
 * rather than looked up, because this is a pure function and the word is the
 * reader's; it defaults to English so the existing callers are unchanged.
 */
fun memberNames(
    members: List<Member>,
    unnamed: String = "Teammate",
): Map<String, String> =
    members.associate { member ->
        member.user_id to member.display_name.ifBlank { unnamed }
    }

/**
 * #273 — one call event, six honest readings.
 *
 * A direct port of the web arm in `apps/web/src/components/thread/system-line.tsx`
 * so a thread reads identically wherever it is opened. Order is load-bearing:
 * a voicemail carries an `outcome` too, and a transfer carries a `direction`,
 * so testing the generic fields first would swallow the specific shapes.
 */
private fun callCompletedLine(
    event: ConversationEvent,
    memberNames: Map<String, String>,
    locale: String?,
): String {
    fun say(key: String, vararg vars: Pair<String, String>): String =
        AppStrings.translate(locale, key, vars.toMap())

    // The line and how long it lasted, joined. One rule for every call shape,
    // kept as its own key so a language that punctuates it differently can say
    // so — the same split web's `sysWithDuration` makes.
    fun withDuration(line: String, forSeconds: Int): String =
        if (forSeconds > 0) {
            say(
                "thread.sysWithDuration",
                "line" to line,
                "duration" to formatCallDuration(forSeconds),
            )
        } else {
            line
        }

    val outcome = event.payloadString("outcome")
    val seconds = event.payloadString("forward_seconds")?.toIntOrNull() ?: 0

    // D38: an outbound bridge call speaks from the crew's side.
    if (event.payloadString("direction") == "outbound") {
        if (outcome == "missed") return say("thread.sysCalledNoAnswer")
        return withDuration(say("thread.sysYouCalled"), seconds)
    }

    // D43 phase 3: who handed the call to whom. A transfer that never ended
    // was previously described as a call that did.
    if (event.payloadString("kind") == "transferred") {
        val to = event.payloadString("to_user_id")?.let { memberNames[it] }
        val from = event.payloadString("from_user_id")?.let { memberNames[it] }
        if (to != null && from != null) {
            return say("thread.sysTransferredBy", "from" to from, "to" to to)
        }
        return if (to != null) say("thread.sysTransferredTo", "to" to to)
        else say("thread.sysTransferred")
    }

    // D43: the voicemail line carries the MESSAGE duration, not the call's.
    if (event.payloadString("kind") == "voicemail") {
        val vmSeconds = event.payloadString("voicemail_seconds")?.toIntOrNull() ?: 0
        return withDuration(say("thread.sysLeftVoicemail"), vmSeconds)
    }

    if (outcome == "voicemail") return say("thread.sysWentToVoicemail")
    if (outcome == "missed") return say("thread.sysMissedCall")
    // #517: WHO picked up. On a crew, "Call answered" leaves out the one thing
    // the rest of them wanted to know. Falls back to the bare line when the
    // answerer is unknown (a call answered before the server started reporting
    // it) or has left the roster — "Call answered by " with nothing after it
    // would be worse than the line it replaced.
    val answeredBy = event.payloadString("answered_by_user_id")?.let { memberNames[it] }
    val answered = if (answeredBy != null) {
        say("thread.sysAnsweredBy", "name" to answeredBy)
    } else {
        say("thread.sysAnswered")
    }
    return withDuration(answered, seconds)
}
