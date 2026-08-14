import Foundation

/// Pure thread-timeline assembly: messages + optimistic pending sends + audit
/// events interleaved newest-first (the flipped scroll view renders index 0 at
/// the bottom of the screen) with day dividers appended after each day's
/// oldest item so they paint ABOVE the day — a 1:1 port of the Android
/// Timeline.kt twin.

/// The in-thread Messages · Notes · Events toggles; the last one can't turn off.
struct ThreadFilter: Equatable, Sendable {
    var messages = true
    var notes = true
    var events = true

    var enabledCount: Int {
        [messages, notes, events].filter { $0 }.count
    }

    func toggledMessages() -> ThreadFilter {
        if messages && enabledCount == 1 { return self }
        var next = self
        next.messages.toggle()
        return next
    }

    func toggledNotes() -> ThreadFilter {
        if notes && enabledCount == 1 { return self }
        var next = self
        next.notes.toggle()
        return next
    }

    func toggledEvents() -> ThreadFilter {
        if events && enabledCount == 1 { return self }
        var next = self
        next.events.toggle()
        return next
    }
}

/// A locally-queued outbound send awaiting the server's queued row.
///
/// #234 gave this row two more lives. It used to mean only "in flight,
/// waiting for the server" — and a send that could not REACH the server
/// dropped the row entirely, restored the draft and showed a toast, which is
/// how a message typed in a basement went nowhere while the person believed
/// it had gone.
///
/// The three states are deliberately one type rather than three, because they
/// are one message at different moments and the timeline has to keep its place
/// in the thread throughout.
struct PendingSend: Identifiable, Equatable, Sendable {
    let localId: String
    let body: String
    let mediaCount: Int
    let createdAt: String
    let idempotencyKey: String
    /// #234: written to the durable outbox and waiting for signal, rather than
    /// in flight right now. It MUST read differently from "Sending…" — a
    /// queued message presented as on-its-way is the failure this prevents.
    var queued: Bool = false
    /// #234: the server answered NO at flush (a STOP arrived while this sat
    /// queued, the cap was reached, registration lapsed). Not retried
    /// automatically — an answer is not an outage — so the row waits for the
    /// person and says why.
    var blockedReason: String? = nil

    var id: String { localId }
}

enum TimelineItem: Identifiable {
    case message(Message)
    case pending(PendingSend)
    case event(ConversationEvent)
    case dayDivider(label: String, isoDay: String)

    var key: String {
        switch self {
        case .message(let message): "m:\(message.id)"
        case .pending(let pending): "p:\(pending.localId)"
        case .event(let event): "e:\(event.id)"
        case .dayDivider(_, let isoDay): "d:\(isoDay)"
        }
    }

    var id: String { key }

    var createdAt: String {
        switch self {
        case .message(let message): message.created_at
        case .pending(let pending): pending.createdAt
        case .event(let event): event.created_at
        case .dayDivider(_, let isoDay): isoDay
        }
    }
}

private func matchesFilter(_ message: Message, _ filter: ThreadFilter) -> Bool {
    message.direction == MessageDirection.note ? filter.notes : filter.messages
}

/// Events older than the oldest loaded message would interleave at the wrong
/// place, so they stay hidden until the message history is at least that deep
/// (the web applies the same rule). Once all messages are loaded, everything
/// shows.
func visibleEvents(
    _ events: [ConversationEvent],
    oldestLoadedMessageAt: String?,
    allMessagesLoaded: Bool
) -> [ConversationEvent] {
    if allMessagesLoaded { return events }
    guard let oldestLoadedMessageAt else { return [] }
    return events.filter { $0.created_at >= oldestLoadedMessageAt }
}

/// Build the newest-first item list. `messages` and `events` arrive in server
/// DESC order; `pending` rows always render newest (they were typed just now).
func buildTimeline(
    messages: [Message],
    events: [ConversationEvent],
    pending: [PendingSend],
    filter: ThreadFilter,
    allMessagesLoaded: Bool,
    calendar: Calendar,
    now: Date,
    /// #228: the reader's language, for the day dividers this builds. Defaults
    /// to English so the pure callers — and the tests that pin the divider text
    /// — read exactly as they did; the screen passes `\.appLocale`. The Android
    /// twin takes it in the same place, for the same reason.
    locale: String? = nil
) -> [TimelineItem] {
    let oldestMessageAt = messages.last?.created_at
    let shownEvents = filter.events
        ? visibleEvents(events, oldestLoadedMessageAt: oldestMessageAt, allMessagesLoaded: allMessagesLoaded)
        : []
    let shownMessages = messages.filter { matchesFilter($0, filter) }

    // Merge two DESC streams by (created_at, id) DESC.
    var merged: [TimelineItem] = []
    merged.reserveCapacity(shownMessages.count + shownEvents.count)
    var mi = 0
    var ei = 0
    while mi < shownMessages.count || ei < shownEvents.count {
        let message = mi < shownMessages.count ? shownMessages[mi] : nil
        let event = ei < shownEvents.count ? shownEvents[ei] : nil
        let takeMessage: Bool
        switch (message, event) {
        case (nil, _):
            takeMessage = false
        case (_, nil):
            takeMessage = true
        case (let m?, let e?):
            takeMessage = m.created_at != e.created_at
                ? m.created_at > e.created_at
                : m.id >= e.id
        }
        if takeMessage, let message {
            merged.append(.message(message))
            mi += 1
        } else if let event {
            merged.append(.event(event))
            ei += 1
        }
    }

    // Pending sends sit at the very bottom (newest) — newest pending first.
    var withPending: [TimelineItem] = []
    withPending.reserveCapacity(merged.count + pending.count + 8)
    for row in pending.sorted(by: { $0.createdAt > $1.createdAt }) {
        withPending.append(.pending(row))
    }
    withPending.append(contentsOf: merged)

    // Day dividers: in a newest-first list a day's divider must come AFTER the
    // day's oldest item so it renders above the day in the flipped layout.
    var out: [TimelineItem] = []
    out.reserveCapacity(withPending.count + 8)
    var currentDay: Date?
    for item in withPending {
        guard let day = localDayOf(item.createdAt, calendar: calendar) else { continue }
        if let previous = currentDay, day != previous {
            out.append(.dayDivider(
                label: dayLabel(
                    previous, now: now, calendar: calendar, locale: locale
                ),
                isoDay: isoDayString(previous, calendar: calendar)
            ))
        }
        currentDay = day
        out.append(item)
    }
    if let currentDay {
        out.append(.dayDivider(
            label: dayLabel(
                currentDay, now: now, calendar: calendar, locale: locale
            ),
            isoDay: isoDayString(currentDay, calendar: calendar)
        ))
    }
    return out
}

/// The local calendar day (start-of-day Date) of a wire timestamp, or nil.
func localDayOf(_ iso: String, calendar: Calendar) -> Date? {
    guard let date = parseWireTimestamp(iso) else { return nil }
    return calendar.startOfDay(for: date)
}

/// "2026-07-15" — the stable divider key for one local day.
func isoDayString(_ day: Date, calendar: Calendar) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: day)
}

/// "Today" / "Yesterday" / "Tue, Jul 14" / "Jul 14, 2025".
///
/// #228: only the two relative words are ours to translate. The dated arms are
/// a `DateFormatter`'s, and reformatting them from a catalogue would be a second
/// date implementation to keep in step with the system's.
func dayLabel(
    _ day: Date,
    now: Date,
    calendar: Calendar,
    locale: String? = nil
) -> String {
    let today = calendar.startOfDay(for: now)
    if day == today { return AppStrings.translate(locale, "thread.dayToday") }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: today), day == yesterday {
        return AppStrings.translate(locale, "thread.dayYesterday")
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    let sameYear = calendar.component(.year, from: day) == calendar.component(.year, from: now)
    formatter.dateFormat = sameYear ? "EEE, MMM d" : "MMM d, yyyy"
    return formatter.string(from: day)
}

/// "3:04 PM" for the quiet line under a bubble.
func bubbleTime(_ iso: String, calendar: Calendar = .current) -> String {
    guard let date = parseWireTimestamp(iso) else { return "" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "h:mm a"
    return formatter.string(from: date)
}

/// Human delivery-state line for an outbound bubble.
///
/// #228: `locale` defaults to English so the pure callers (and their tests) read
/// exactly as they did; every view call site passes the reader's. The FAILED arm
/// is the API's own sentence, which is translated where it is written. The
/// check marks are punctuation rather than words, so they stay outside the
/// catalogue and outside the translator's way.
func deliveryLabel(_ message: Message, locale: String? = nil) -> String? {
    switch message.status {
    case MessageStatus.queued: AppStrings.translate(locale, "thread.sending")
    case MessageStatus.sent: AppStrings.translate(locale, "thread.sent") + " ✓"
    case MessageStatus.delivered:
        AppStrings.translate(locale, "thread.delivered") + " ✓✓"
    // #228: the locale goes on, exactly as it does on Android. Without it this
    // one branch rendered English while "Sending", "Sent" and "Delivered" above
    // it were translated — and it is the branch that says why a text did NOT go.
    case MessageStatus.failed: sendFailureMessage(message.error_code, locale: locale)
    default: nil
    }
}

/// What a voicemail on this timeline line SAYS, when it was transcribed. Nil
/// for every other event, for an older line written before transcription
/// existed, and whenever there was nothing worth writing down.
func voicemailTranscript(of event: ConversationEvent) -> String? {
    guard event.type == "call_completed",
          event.payload["kind"]?.stringValue == "voicemail",
          let text = event.payload["transcript"]?.stringValue,
          !text.isBlank
    else { return nil }
    return text
}

// MARK: - System event lines

/// #465: where a timeline line goes when it is tapped.
///
/// The complaint was that these lines are only ever text: "X created a task"
/// names a task and could not open it, and a done line quotes a message and
/// could not reach it. Only the two that genuinely name a destination are
/// actionable — an assignment or a tag change names nothing to open, and a
/// false affordance is worse than a quiet line.
///
/// `task_deleted` is deliberately absent: the task it names no longer exists.
///
/// Kept pure and here (not in the view) so it is unit-tested directly and
/// stays the single answer web, Android and iOS all give.
enum EventTarget: Equatable {
    case openTask(String)
    case jumpToMessage(String)
}

private let taskEventTypes: Set<String> = [
    "task_created",
    "task_assigned",
    "task_due_set",
    "task_attachment_added",
    "task_attachment_removed",
]

func eventTarget(of event: ConversationEvent) -> EventTarget? {
    if taskEventTypes.contains(event.type) {
        guard let taskId = event.payload["task_id"]?.stringValue else { return nil }
        return .openTask(taskId)
    }
    if event.type == "message_done" || event.type == "message_undone" {
        guard let messageId = event.payload["message_id"]?.stringValue else {
            return nil
        }
        return .jumpToMessage(messageId)
    }
    return nil
}

/// #607 A3 — the `payment_*` types this timeline narrates, and the ONLY list of
/// them on this client.
///
/// A named set rather than five case labels alone, because the set is what a
/// guard can hold against the API's own `ConversationEventType` union in BOTH
/// directions (`PaymentTimelineLineTests`). #548's lesson is that a per-client
/// copy of a shared vocabulary drifts silently, and that an incomplete union is
/// one the next writer routes around; the failure this prevents is a sixth
/// `payment_*` type landing on the server and rendering here as "Payment held"
/// while web renders nothing at all.
///
/// All five, not the three the database broadcasts. The broadcast set is about
/// which changes arrive live; this set is about which facts the history states,
/// and a thread that narrates a refund but not the ask it refunded would be a
/// history with a hole in the middle of it.
let paymentTimelineEventTypes: Set<String> = [
    "payment_requested",
    "payment_paid",
    "payment_cancelled",
    "payment_refunded",
    "payment_disputed",
]

/// An event type read as words — the line for something this build does not
/// narrate.
///
/// Extracted from `eventLine`'s `default` so the payment guards can name the
/// thing they refuse rather than retyping "Payment paid" and pinning a phrase
/// that would still pass if the arm were deleted and the fallback re-appeared
/// spelled the same way.
func humanizedEventType(_ type: String) -> String {
    let plain = type.replacingOccurrences(of: "_", with: " ")
    return plain.prefix(1).uppercased() + plain.dropFirst()
}

/// Human line for an audit event. Unknown types fall back to a plain reading
/// of the type name so a lagging app build never renders raw snake_case.
///
/// #228: every sentence here is Android's `thread.sys…` key with Android's own
/// French — a crew comparing the phone and the laptop must not read two
/// different histories for one conversation, and that argument does not stop at
/// the language boundary. `locale` is defaulted and LAST, so the assertion
/// table and the previews read exactly as they did.
func eventLine(
    _ event: ConversationEvent,
    memberNames: [String: String],
    contactName: String,
    locale: String? = nil
) -> String {
    func say(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(locale, key, vars)
    }
    let actor = event.actor_user_id.flatMap { memberNames[$0] }
        ?? AppStrings.translate(locale, "thread.sysSomeone")
    let system = event.actor_user_id == nil
    switch event.type {
    case "status_changed":
        if let to = event.payload["to"]?.stringValue {
            return say(
                "thread.sysMovedTo",
                ["by": actor, "status": statusLabel(to, locale: locale)]
            )
        }
        return say("thread.sysStatusChanged", ["by": actor])

    case "assigned":
        if let to = event.payload["to"]?.stringValue {
            let name = memberNames[to]
                ?? AppStrings.translate(locale, "thread.sysATeammate")
            return say("thread.sysAssignedTo", ["by": actor, "name": name])
        }
        return say("thread.sysUnassigned", ["by": actor])

    case "tag_added":
        if let name = event.payload["name"]?.stringValue {
            return say("thread.sysTagAdded", ["by": actor, "name": name])
        }
        return say("thread.sysTagAddedGeneric", ["by": actor])

    case "tag_removed": return say("thread.sysTagRemoved", ["by": actor])
    case "opted_out":
        return system
            ? say("thread.sysOptedOutSystem", ["name": contactName])
            : say("thread.sysOptedOutBy", ["by": actor, "name": contactName])
    case "opt_out_revoked":
        return system
            ? say("thread.sysOptedInSystem", ["name": contactName])
            : say("thread.sysOptOutRevoked", ["by": actor])
    case "consent_attested":
        return say("thread.sysConsentAttested", ["by": actor, "name": contactName])
    // #225: names the FACT (a send landed in the customer's quiet window), not an
    // attestation. With the confirmation switched off the same event is written
    // and nobody confirmed anything, so "confirmed" would be a lie — and web has
    // always said it this way, so this is parity too.
    case "quiet_hours_confirmed": return say("thread.sysQuietHours", ["by": actor])
    // #237: the actor is the CUSTOMER, who has no user row, so this line
    // carries no name. "Sam confirmed the appointment" would credit the crew
    // with the customer's answer.
    case "appointment_confirmed": return say("thread.sysAppointmentConfirmed")
    // #313: the customer again, so no name. The SCORE is the whole line.
    case "job_rated":
        return say(
            "thread.sysJobRated",
            ["score": event.payload["score"]?.intValue.map(String.init) ?? "?"]
        )
    case "spam_marked": return say("thread.sysSpamMarked", ["by": actor])
    case "spam_unmarked": return say("thread.sysSpamUnmarked", ["by": actor])
    case "message_done": return say("thread.sysMessageDone", ["by": actor])
    case "message_undone": return say("thread.sysMessageUndone", ["by": actor])
    case "task_created": return say("thread.sysTaskCreated", ["by": actor])
    case "task_assigned": return say("thread.sysTaskAssigned", ["by": actor])
    case "task_due_set": return say("thread.sysTaskDueSet", ["by": actor])
    case "task_deleted": return say("thread.sysTaskDeleted", ["by": actor])
    // #317 — a file this customer sent that we would not store. Same copy as
    // web (system-line.tsx) and Android (Timeline.kt), word for word: a crew
    // comparing the phone and the laptop must not read two different histories
    // for one conversation.
    case "media_refused": return mediaRefusedLine(event, locale: locale)
    case "note_attachment_added":
        return say("thread.sysNoteAttachmentAdded", ["by": actor])
    case "note_attachment_removed":
        return say("thread.sysNoteAttachmentRemoved", ["by": actor])
    case "task_attachment_added":
        return say("thread.sysTaskAttachmentAdded", ["by": actor])
    case "task_attachment_removed":
        return say("thread.sysTaskAttachmentRemoved", ["by": actor])
    case "missed_call":
        return say("thread.sysMissedCallFrom", ["name": contactName])
    // #273: the server puts direction, outcome, forward_seconds and a transfer
    // pair on this payload, and this arm read ONE of them. Every shape that was
    // not a voicemail collapsed to "Call with X ended", so a 4:32 outbound call,
    // a missed call and a transfer were indistinguishable on the phone while web
    // showed all three — one conversation with two different histories.
    case "call_completed":
        return callCompletedLine(event, memberNames: memberNames, locale: locale)
    case "auto_reply_sent": return say("thread.sysAutoReplySent")
    // #607 A3 — money, said out loud. Same five arms and the same words on web
    // (system-line.tsx) and Android (Timeline.kt); see `paymentEventLine`.
    case "payment_requested",
         "payment_paid",
         "payment_cancelled",
         "payment_refunded",
         "payment_disputed":
        return paymentEventLine(event, actor: actor, locale: locale)
    default:
        return humanizedEventType(event.type)
    }
}

/**
 #607 A3 — what a payment did, in the history that outlives the strip.

 ## Why the timeline says this at all

 `ThreadPaymentsPane` is the live surface and it is deliberately short-lived:
 `paymentRequestWorthShowing` keeps a settled request for a week and its own
 comment already states where it goes afterwards — "the request is history and
 the timeline holds it". It did not hold it. All five `payment_*` rows fell
 through to `humanizedEventType`, so the phones showed "Payment refunded" — a
 column value with the underscore taken out, no amount, no context — while web
 narrated nothing at all and rendered no row. One conversation, two histories,
 and the worse of the two on the device the crew actually carries.

 So every fact the server already writes into the payload is read here: the
 amount, what it was for, and for a refund the amount that actually went back.
 Nothing is invented — a field the payload does not carry drops out of the
 sentence rather than being guessed at.

 ## Who each line credits

 `payment_paid`, `payment_refunded` and `payment_disputed` carry
 `actor_user_id: null` because NOBODY IN THE WORKSPACE DID THEM — the customer
 paid, the business refunded from Stripe's own dashboard, the customer's bank
 pulled the money back. So those three name nobody, exactly as
 `appointment_confirmed` and `job_rated` name nobody. The two that a crew member
 really does perform in this app, `payment_requested` and `payment_cancelled`,
 carry their name.

 Every verb here is one this feature already ships: "asked for" is the composer's
 own button, "called off" is what `ThreadPaymentsPane` calls cancelling an ask,
 "went back to them" is the strip's refund line verbatim, and the strip's dispute
 row already says their bank pulled it back.

 Word for word with web and Android, like `mediaRefusedLine` and
 `callCompletedLine` above and for the same reason.
 */
func paymentEventLine(
    _ event: ConversationEvent,
    actor: String,
    locale: String? = nil
) -> String {
    func say(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(locale, key, vars)
    }
    // #270: these are JSON NUMBERS. Read through `intValue`, never
    // `stringValue` — which returns nil for `.number` and would make every
    // amount silently vanish into the no-amount arms below.
    let cents = event.payload["amount_cents"]?.intValue
    let refunded = event.payload["amount_refunded_cents"]?.intValue

    // What the figure is written in, decided exactly as `PaymentRequest.amountLabel`
    // decides it: the CONNECTED account's currency, and the reader is that
    // account. Passing it as both amount and audience is what drops the "US$" /
    // "CA$" qualifier — a business reading its own money in its own thread is
    // not the case #522 exists for. Unknown or absent reads as USD, matching
    // `billingCurrencyOf` on the server: a figure must never fail to render
    // because a field was missing from an older row.
    let currency = BillingCurrency(
        rawValue: (event.payload["currency"]?.stringValue ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    ) ?? .usd

    // Through the formatter, never typed. `check-money-literals.mjs` refuses a
    // signed amount in a phone string literal precisely because a typed price is
    // a price in a currency nobody chose.
    func money(_ amount: Int?) -> String? {
        guard let amount = amount else { return nil }
        return formatMoneyIn(amount, currency, audience: currency)
    }

    let head: String
    switch event.type {
    case "payment_requested":
        head = money(cents)
            .map { say("thread.sysPaymentRequested", ["by": actor, "amount": $0]) }
            ?? say("thread.sysPaymentRequestedGeneric", ["by": actor])

    case "payment_paid":
        head = money(cents).map { say("thread.sysPaymentPaid", ["amount": $0]) }
            ?? say("thread.sysPaymentPaidGeneric")

    case "payment_cancelled":
        head = money(cents)
            .map { say("thread.sysPaymentCancelled", ["by": actor, "amount": $0]) }
            ?? say("thread.sysPaymentCancelledGeneric", ["by": actor])

    case "payment_refunded":
        // THE AMOUNT THAT WENT BACK, not the amount that was charged. A partial
        // refund is the ordinary case — a deposit returned less a call-out fee —
        // and quoting the original here would tell the crew the customer got
        // more back than they did. Zero is treated as absent rather than
        // rendered: `amount_refunded_cents` is nullable and a stored zero means
        // the webhook did not know the figure, never that nothing moved.
        let back = (refunded ?? 0) > 0 ? refunded : cents
        head = money(back).map { say("thread.sysPaymentRefunded", ["amount": $0]) }
            ?? say("thread.sysPaymentRefundedGeneric")

    case "payment_disputed":
        head = money(cents).map { say("thread.sysPaymentDisputed", ["amount": $0]) }
            ?? say("thread.sysPaymentDisputedGeneric")

    default:
        // Unreachable through `eventLine`, which routes only the five above.
        // The fallback rather than an empty string, so a future caller that
        // mis-routes a type gets today's behaviour instead of a blank row — and
        // `PaymentTimelineLineTests` asserts none of the five can reach it.
        return humanizedEventType(event.type)
    }

    // ONE rule for the trailing clause rather than five. `payment_cancelled` is
    // the only payload the API writes without a description, so its arm simply
    // never appends — which is a fact about the writer, not a fourth branch to
    // keep in step across three clients.
    let description = event.payload["description"]?.stringValue ?? ""
    return description.isBlank
        ? head
        : say(
            "thread.sysPaymentWithDescription",
            ["line": head, "description": description]
        )
}

/**
 The #317 refused-attachment line.

 There is no attachment row to render — that is the point — so this stands in its
 place. Without it the crew sees a text with no picture and concludes the customer
 forgot to attach one. Every arm ends in what to DO about it, which is the only
 part they can act on between jobs. Word-for-word identical to web
 (system-line.tsx) and Android (Timeline.kt).
 */
func mediaRefusedLine(_ event: ConversationEvent, locale: String? = nil) -> String {
    switch event.payload["reason"]?.stringValue {
    case "too_large":
        return AppStrings.translate(locale, "thread.sysMediaTooLarge")
    case "empty":
        return AppStrings.translate(locale, "thread.sysMediaEmpty")
    case "type_mismatch":
        return AppStrings.translate(locale, "thread.sysMediaTypeMismatch")
    // #317: the file WAS the type it claimed and the type is allowed — what is
    // inside it is the problem. One line, one action: which of a macro project,
    // a packed program or an auto-running script it turned out to be changes
    // nothing the crew can do about it.
    case "unsafe_content":
        return AppStrings.translate(locale, "thread.sysMediaUnsafe")
    case "unreadable":
        return AppStrings.translate(locale, "thread.sysMediaUnreadable")
    case "too_many_items":
        // #270: this is a JSON NUMBER — read through intValue, never stringValue.
        let kept = event.payload["index"]?.intValue ?? 0
        return kept > 0
            ? AppStrings.translate(
                locale,
                "thread.sysMediaTooManyKept",
                ["kept": String(kept)]
            )
            : AppStrings.translate(locale, "thread.sysMediaTooMany")
    default:
        // unsupported_type, and anything a later server adds: the honest general
        // case, still ending in the thing that works.
        return AppStrings.translate(locale, "thread.sysMediaUnsupported")
    }
}

/// #228: `locale` defaults to English, so `eventLine` and the tests that pin its
/// sentences read exactly as they did while every view passes the reader's. The
/// Android twin takes it the same way.
func statusLabel(_ status: String, locale: String? = nil) -> String {
    switch status {
    case "new": AppStrings.translate(locale, "thread.statusNew")
    case "open": AppStrings.translate(locale, "thread.statusOpen")
    case "waiting": AppStrings.translate(locale, "thread.statusWaiting")
    case "closed": AppStrings.translate(locale, "thread.statusClosed")
    default: status.prefix(1).uppercased() + status.dropFirst()
    }
}

/// display_name lookup for event lines + assignee UI.
///
/// #228: `locale` defaulted and last, for the one word this writes.
func memberNames(_ members: [Member], locale: String? = nil) -> [String: String] {
    let fallback = AppStrings.translate(locale, "thread.teammate")
    var names: [String: String] = [:]
    for member in members {
        names[member.user_id] = member.display_name.isBlank
            ? fallback
            : member.display_name
    }
    return names
}

/// #273 — one call event, six honest readings.
///
/// A direct port of the web arm in `apps/web/src/components/thread/system-line.tsx`
/// so a thread reads identically wherever it is opened. Order is load-bearing: a
/// voicemail carries an `outcome` too, and a transfer carries a `direction`, so
/// testing the generic fields first would swallow the specific shapes.
func callCompletedLine(
    _ event: ConversationEvent,
    memberNames: [String: String],
    locale: String? = nil
) -> String {
    func say(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(locale, key, vars)
    }
    /// "{line} · {duration}", as one catalogue entry rather than a middle dot
    /// glued on here — the separator is punctuation in English and it is
    /// punctuation in French, but which side the duration falls on is not this
    /// file's decision to make.
    func withDuration(_ line: String, _ seconds: Int) -> String {
        say(
            "thread.sysWithDuration",
            ["line": line, "duration": formatCallDuration(seconds)]
        )
    }
    let outcome = event.payload["outcome"]?.stringValue
    // #270: these are JSON NUMBERS — read through intValue, never stringValue.
    let seconds = event.payload["forward_seconds"]?.intValue ?? 0

    // D38: an outbound bridge call speaks from the crew's side.
    if event.payload["direction"]?.stringValue == "outbound" {
        if outcome == "missed" { return say("thread.sysCalledNoAnswer") }
        let youCalled = say("thread.sysYouCalled")
        return seconds > 0 ? withDuration(youCalled, seconds) : youCalled
    }

    // D43 phase 3: who handed the call to whom. A transfer that never ended was
    // previously described as a call that did.
    if event.payload["kind"]?.stringValue == "transferred" {
        let to = event.payload["to_user_id"]?.stringValue.flatMap { memberNames[$0] }
        let from = event.payload["from_user_id"]?.stringValue.flatMap { memberNames[$0] }
        if let to, let from {
            return say("thread.sysTransferredBy", ["from": from, "to": to])
        }
        return to.map { say("thread.sysTransferredTo", ["to": $0]) }
            ?? say("thread.sysTransferred")
    }

    // D43: the voicemail line carries the MESSAGE duration, not the call's.
    if event.payload["kind"]?.stringValue == "voicemail" {
        let vmSeconds = event.payload["voicemail_seconds"]?.intValue ?? 0
        let left = say("thread.sysLeftVoicemail")
        return vmSeconds > 0 ? withDuration(left, vmSeconds) : left
    }

    if outcome == "voicemail" { return say("thread.sysWentToVoicemail") }
    if outcome == "missed" { return say("thread.sysMissedCall") }
    // #517: WHO picked up. On a crew, "Call answered" leaves out the one thing
    // the rest of them wanted to know. Falls back to the bare line when the
    // answerer is unknown (a call answered before the server started reporting
    // it) or has left the roster — "Call answered by " with nothing after it
    // would be worse than the line it replaced.
    let answeredBy = event.payload["answered_by_user_id"]?.stringValue
        .flatMap { memberNames[$0] }
    let answered = answeredBy.map { say("thread.sysAnsweredBy", ["name": $0]) }
        ?? say("thread.sysAnswered")
    return seconds > 0 ? withDuration(answered, seconds) : answered
}
