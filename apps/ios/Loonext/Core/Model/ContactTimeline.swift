import Foundation

/// #324 — one chronology of everything done for a customer.
///
/// D7 threads by recency, so a customer who returns after 31 days starts a NEW
/// conversation: a homeowner serviced once a year for six years is six threads.
/// That is the right call for an annual furnace service, and it is why "what
/// have we done for this customer?" had no answer surface — the
/// prior-conversations list (G6) and the per-contact call history (#205) both
/// existed as separate blocks, with jobs nowhere.
///
/// Hand-port of the Kotlin `ContactTimelineLogic.kt`; the display strings are
/// deliberately identical rather than re-voiced.
struct TimelineEntry: Decodable, Identifiable, Equatable, Sendable {
    let kind: String
    let id: String
    let occurred_at: String
    /// Where tapping goes. Nil only for a call that never threaded.
    let conversation_id: String?
    /// Conversation status, or call outcome. Nil on a job.
    let status: String?
    /// Job title, or the caller's name. Nil on a conversation.
    let detail: String?
    /// Talk time on a call: the forward leg's seconds, never ring time.
    let talk_seconds: Int?
    let due_at: String?
    let done: Bool?

    /// The two source tables have independent id spaces, so a conversation and
    /// a job could share an id. Dedup on both or one silently vanishes.
    var dedupeKey: String { "\(kind):\(id)" }
}

struct ContactTimelinePage: Decodable, Sendable {
    let entries: [TimelineEntry]
    /// Nil at the end of the history, which is how the client knows to stop.
    let next_before: String?
}

/// The headline for a row: what happened.
func timelineTitle(_ entry: TimelineEntry) -> String {
    switch entry.kind {
    case "task":
        return entry.detail ?? "Job"
    case "call":
        switch entry.status {
        case "answered": return "Call answered"
        case "voicemail": return "Voicemail"
        default: return "Missed call"
        }
    default:
        return "Conversation"
    }
}

/// The second line: the one detail worth carrying at a glance.
func timelineDetail(_ entry: TimelineEntry) -> String {
    switch entry.kind {
    case "task":
        if entry.done == true { return "Done" }
        if let due = entry.due_at { return "Due \(timelineDueLabel(due))" }
        return "Open"
    case "call":
        // Talk time only, and only when there was any: "0s" on a missed call
        // reads as a fault rather than as an absence.
        let seconds = entry.talk_seconds ?? 0
        return seconds > 0 ? "Talked for \(timelineTalkTime(seconds))" : "No answer"
    default:
        return entry.status == "closed" ? "Closed" : "Open"
    }
}

func timelineTalkTime(_ seconds: Int) -> String {
    let minutes = seconds / 60
    let rest = seconds % 60
    return minutes > 0 ? "\(minutes)m \(rest)s" : "\(rest)s"
}

private func timelineDueLabel(_ iso: String) -> String {
    guard let date = ISO8601DateFormatter.timelineParser.date(from: iso) else { return "soon" }
    return date.formatted(.dateTime.day().month(.abbreviated))
}

extension ISO8601DateFormatter {
    /// Fractional seconds are optional on the wire (Postgres emits them, the
    /// fixtures often do not), and a parser that handles only one shape returns
    /// nil for the other — which would show every row as "soon".
    static let timelineParser: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

/// Parse an entry's timestamp, tolerating both wire shapes.
func timelineDate(_ iso: String) -> Date? {
    if let withFraction = ISO8601DateFormatter.timelineParser.date(from: iso) {
        return withFraction
    }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: iso)
}

/// One day's worth of the history.
struct TimelineDayGroup: Identifiable, Equatable {
    let id: String
    let label: String
    let entries: [TimelineEntry]
}

/// Day buckets, newest first; the entries already arrive in that order.
///
/// Grouped in the LOCAL calendar, not on the timestamp's UTC prefix: an evening
/// call in Vancouver falls on the next UTC day, so a UTC grouping would file it
/// under a date the crew does not remember it happening on.
func groupTimelineByDay(
    _ entries: [TimelineEntry],
    calendar: Calendar = .current,
    now: Date = Date()
) -> [TimelineDayGroup] {
    var order: [Date] = []
    var buckets: [Date: [TimelineEntry]] = [:]
    for entry in entries {
        guard let date = timelineDate(entry.occurred_at) else { continue }
        let day = calendar.startOfDay(for: date)
        if buckets[day] == nil {
            buckets[day] = []
            order.append(day)
        }
        buckets[day]?.append(entry)
    }
    return order.map { day in
        TimelineDayGroup(
            id: ISO8601DateFormatter().string(from: day),
            label: timelineDayLabel(day, calendar: calendar, now: now),
            entries: buckets[day] ?? []
        )
    }
}

func timelineDayLabel(
    _ day: Date,
    calendar: Calendar = .current,
    now: Date = Date()
) -> String {
    if calendar.isDateInToday(day) { return "Today" }
    if calendar.isDateInYesterday(day) { return "Yesterday" }
    return day.formatted(.dateTime.day().month(.abbreviated).year())
}

/// Merge a fresh first page over the already-loaded tail, so a silent
/// revalidate never collapses what the user paged to.
func mergeTimelineFirstPage(
    cached: [TimelineEntry],
    page: [TimelineEntry]
) -> [TimelineEntry] {
    guard cached.count > page.count else { return page }
    let fresh = Set(page.map(\.dedupeKey))
    return page + cached.filter { !fresh.contains($0.dedupeKey) }
}

/// Append a later page, keeping order and dropping repeats.
func appendTimelinePage(
    current: [TimelineEntry],
    page: [TimelineEntry]
) -> [TimelineEntry] {
    let seen = Set(current.map(\.dedupeKey))
    return current + page.filter { !seen.contains($0.dedupeKey) }
}
