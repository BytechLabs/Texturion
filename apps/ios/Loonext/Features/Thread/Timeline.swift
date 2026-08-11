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
    now: Date
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
                label: dayLabel(previous, now: now, calendar: calendar),
                isoDay: isoDayString(previous, calendar: calendar)
            ))
        }
        currentDay = day
        out.append(item)
    }
    if let currentDay {
        out.append(.dayDivider(
            label: dayLabel(currentDay, now: now, calendar: calendar),
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
func dayLabel(_ day: Date, now: Date, calendar: Calendar) -> String {
    let today = calendar.startOfDay(for: now)
    if day == today { return "Today" }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: today), day == yesterday {
        return "Yesterday"
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
func deliveryLabel(_ message: Message) -> String? {
    switch message.status {
    case MessageStatus.queued: "Sending…"
    case MessageStatus.sent: "Sent ✓"
    case MessageStatus.delivered: "Delivered ✓✓"
    case MessageStatus.failed: sendFailureMessage(message.error_code)
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

/// Human line for an audit event. Unknown types fall back to a plain reading
/// of the type name so a lagging app build never renders raw snake_case.
func eventLine(
    _ event: ConversationEvent,
    memberNames: [String: String],
    contactName: String
) -> String {
    let actor = event.actor_user_id.flatMap { memberNames[$0] } ?? "Someone"
    let system = event.actor_user_id == nil
    switch event.type {
    case "status_changed":
        if let to = event.payload["to"]?.stringValue {
            return "\(actor) moved this to \(statusLabel(to))"
        }
        return "\(actor) changed the status"

    case "assigned":
        if let to = event.payload["to"]?.stringValue {
            return "\(actor) assigned this to \(memberNames[to] ?? "a teammate")"
        }
        return "\(actor) unassigned this conversation"

    case "tag_added":
        if let name = event.payload["name"]?.stringValue {
            return "\(actor) added the tag \"\(name)\""
        }
        return "\(actor) added a tag"

    case "tag_removed": return "\(actor) removed a tag"
    case "opted_out":
        return system ? "\(contactName) opted out of texts" : "\(actor) opted \(contactName) out"
    case "opt_out_revoked":
        return system ? "\(contactName) opted back in" : "\(actor) removed the opt-out"
    case "consent_attested": return "\(actor) attested consent to text \(contactName)"
    // #225: names the FACT (a send landed in the customer's quiet window), not an
    // attestation. With the confirmation switched off the same event is written
    // and nobody confirmed anything, so "confirmed" would be a lie — and web has
    // always said it this way, so this is parity too.
    case "quiet_hours_confirmed": return "\(actor) sent during this customer's quiet hours"
    // #237: the actor is the CUSTOMER, who has no user row, so this line
    // carries no name. "Sam confirmed the appointment" would credit the crew
    // with the customer's answer.
    case "appointment_confirmed": return "They confirmed the appointment"
    // #313: the customer again, so no name. The SCORE is the whole line.
    case "job_rated":
        return "They rated the job \(event.payload["score"]?.intValue.map(String.init) ?? "?") out of 5"
    case "spam_marked": return "\(actor) marked this as spam"
    case "spam_unmarked": return "\(actor) marked this as not spam"
    case "message_done": return "\(actor) marked a message done"
    case "message_undone": return "\(actor) reopened a message"
    case "task_created": return "\(actor) created a task"
    case "task_assigned": return "\(actor) assigned a task"
    case "task_due_set": return "\(actor) set a task due date"
    case "task_deleted": return "\(actor) deleted a task"
    // #317 — a file this customer sent that we would not store. Same copy as
    // web (system-line.tsx) and Android (Timeline.kt), word for word: a crew
    // comparing the phone and the laptop must not read two different histories
    // for one conversation.
    case "media_refused": return mediaRefusedLine(event)
    case "note_attachment_added": return "\(actor) attached a file to a note"
    case "note_attachment_removed": return "\(actor) removed a file from a note"
    case "task_attachment_added": return "\(actor) attached a file to a task"
    case "task_attachment_removed": return "\(actor) removed a file from a task"
    case "missed_call": return "Missed call from \(contactName)"
    // #273: the server puts direction, outcome, forward_seconds and a transfer
    // pair on this payload, and this arm read ONE of them. Every shape that was
    // not a voicemail collapsed to "Call with X ended", so a 4:32 outbound call,
    // a missed call and a transfer were indistinguishable on the phone while web
    // showed all three — one conversation with two different histories.
    case "call_completed":
        return callCompletedLine(event, memberNames: memberNames)
    case "auto_reply_sent": return "Away auto-reply sent"
    default:
        let plain = event.type.replacingOccurrences(of: "_", with: " ")
        return plain.prefix(1).uppercased() + plain.dropFirst()
    }
}

/**
 The #317 refused-attachment line.

 There is no attachment row to render — that is the point — so this stands in its
 place. Without it the crew sees a text with no picture and concludes the customer
 forgot to attach one. Every arm ends in what to DO about it, which is the only
 part they can act on between jobs. Word-for-word identical to web
 (system-line.tsx) and Android (Timeline.kt).
 */
func mediaRefusedLine(_ event: ConversationEvent) -> String {
    switch event.payload["reason"]?.stringValue {
    case "too_large":
        return "A file this customer sent was too big to save — ask them to send a smaller one"
    case "empty":
        return "A file this customer sent arrived empty — ask them to send it again"
    case "type_mismatch":
        return "A file this customer sent wasn't the kind of file it claimed to be, so it wasn't saved"
    // #317: the file WAS the type it claimed and the type is allowed — what is
    // inside it is the problem. One line, one action: which of a macro project,
    // a packed program or an auto-running script it turned out to be changes
    // nothing the crew can do about it.
    case "unsafe_content":
        return "A file this customer sent had something unsafe inside it, so it wasn't saved — ask them for a photo or a plain PDF"
    case "unreadable":
        return "A file this customer sent couldn't be checked, so it wasn't saved — ask them to send it again"
    case "too_many_items":
        // #270: this is a JSON NUMBER — read through intValue, never stringValue.
        let kept = event.payload["index"]?.intValue ?? 0
        return kept > 0
            ? "This message came with more files than we can save — the first \(kept) were kept"
            : "This message came with more files than we can save"
    default:
        // unsupported_type, and anything a later server adds: the honest general
        // case, still ending in the thing that works.
        return "A file this customer sent can't be shown here — ask them to send a photo or a PDF"
    }
}

func statusLabel(_ status: String) -> String {
    switch status {
    case "new": "New"
    case "open": "Open"
    case "waiting": "Waiting"
    case "closed": "Closed"
    default: status.prefix(1).uppercased() + status.dropFirst()
    }
}

/// display_name lookup for event lines + assignee UI.
func memberNames(_ members: [Member]) -> [String: String] {
    var names: [String: String] = [:]
    for member in members {
        names[member.user_id] = member.display_name.isBlank ? "Teammate" : member.display_name
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
    memberNames: [String: String]
) -> String {
    let outcome = event.payload["outcome"]?.stringValue
    // #270: these are JSON NUMBERS — read through intValue, never stringValue.
    let seconds = event.payload["forward_seconds"]?.intValue ?? 0

    // D38: an outbound bridge call speaks from the crew's side.
    if event.payload["direction"]?.stringValue == "outbound" {
        if outcome == "missed" { return "Called, no answer" }
        return seconds > 0
            ? "You called · \(formatCallDuration(seconds))"
            : "You called"
    }

    // D43 phase 3: who handed the call to whom. A transfer that never ended was
    // previously described as a call that did.
    if event.payload["kind"]?.stringValue == "transferred" {
        let to = event.payload["to_user_id"]?.stringValue.flatMap { memberNames[$0] }
        let from = event.payload["from_user_id"]?.stringValue.flatMap { memberNames[$0] }
        if let to, let from { return "\(from) transferred the call to \(to)" }
        return to.map { "Call transferred to \($0)" } ?? "Call transferred"
    }

    // D43: the voicemail line carries the MESSAGE duration, not the call's.
    if event.payload["kind"]?.stringValue == "voicemail" {
        let vmSeconds = event.payload["voicemail_seconds"]?.intValue ?? 0
        return vmSeconds > 0
            ? "Left a voicemail · \(formatCallDuration(vmSeconds))"
            : "Left a voicemail"
    }

    if outcome == "voicemail" { return "Call went to voicemail" }
    if outcome == "missed" { return "Missed call" }
    // #517: WHO picked up. On a crew, "Call answered" leaves out the one thing
    // the rest of them wanted to know. Falls back to the bare line when the
    // answerer is unknown (a call answered before the server started reporting
    // it) or has left the roster — "Call answered by " with nothing after it
    // would be worse than the line it replaced.
    let answeredBy = event.payload["answered_by_user_id"]?.stringValue
        .flatMap { memberNames[$0] }
    let answered = answeredBy.map { "Call answered by \($0)" } ?? "Call answered"
    return seconds > 0
        ? "\(answered) · \(formatCallDuration(seconds))"
        : answered
}
