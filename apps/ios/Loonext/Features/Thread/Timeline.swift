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
struct PendingSend: Identifiable, Equatable, Sendable {
    let localId: String
    let body: String
    let mediaCount: Int
    let createdAt: String
    let idempotencyKey: String

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
    case MessageStatus.failed:
        message.error_code == carrierOptOutErrorCode
            ? "This customer opted out"
            : "Not delivered"
    default: nil
    }
}

// MARK: - System event lines

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
    case "quiet_hours_confirmed": return "\(actor) confirmed sending during quiet hours"
    case "spam_marked": return "\(actor) marked this as spam"
    case "spam_unmarked": return "\(actor) marked this as not spam"
    case "message_done": return "\(actor) marked a message done"
    case "message_undone": return "\(actor) reopened a message"
    case "task_created": return "\(actor) created a task"
    case "task_assigned": return "\(actor) assigned a task"
    case "task_due_set": return "\(actor) set a task due date"
    case "task_deleted": return "\(actor) deleted a task"
    case "note_attachment_added": return "\(actor) attached a file to a note"
    case "note_attachment_removed": return "\(actor) removed a file from a note"
    case "task_attachment_added": return "\(actor) attached a file to a task"
    case "task_attachment_removed": return "\(actor) removed a file from a task"
    case "missed_call": return "Missed call from \(contactName)"
    case "call_completed": return "Call with \(contactName) ended"
    case "auto_reply_sent": return "Away auto-reply sent"
    default:
        let plain = event.type.replacingOccurrences(of: "_", with: " ")
        return plain.prefix(1).uppercased() + plain.dropFirst()
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
