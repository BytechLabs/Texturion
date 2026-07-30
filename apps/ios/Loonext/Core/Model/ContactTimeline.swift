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
    /// The shared opaque cursor (SPEC §7/D10), encoding the full
    /// `(occurred_at, id)` sort key. Nil at the end of the history.
    ///
    /// Opaque and base64url, which is not incidental here: the first cut sent a
    /// raw Postgres timestamptz, and its literal `+` is NOT escaped by
    /// `URLComponents.queryItems` while Hono decodes a raw `+` as a space — so
    /// every "Show earlier" on iOS came back 422 and the empty catch hid it.
    let next_cursor: String?
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

private func timelineDueLabel(_ iso: String, calendar: Calendar = .current) -> String {
    guard let date = parseWireTimestamp(iso) else { return "soon" }
    return timelineShortDate(date, calendar: calendar, format: "MMM d")
}

/// The app's established date formatting: a LOCAL DateFormatter with the posix
/// locale and an explicit pattern (Format.swift's monthDayString/absoluteTime).
///
/// Not `.formatted(.dateTime...)`: that API appears nowhere else in this app, so
/// it is unproven here, and Swift only compiles in CI. Not a cached formatter
/// either — the class is not Sendable, so a `static let` is a build error.
func timelineShortDate(_ date: Date, calendar: Calendar, format: String) -> String {
    let formatter = DateFormatter()
    // Format.swift's `posixLocale` is file-private, so it is spelled out here
    // rather than reached for. A fixed pattern needs a fixed locale, or the
    // device's regional settings reorder it.
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = format
    return formatter.string(from: date)
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
        guard let date = parseWireTimestamp(entry.occurred_at) else { continue }
        let day = calendar.startOfDay(for: date)
        if buckets[day] == nil {
            buckets[day] = []
            order.append(day)
        }
        buckets[day]?.append(entry)
    }
    return order.map { day in
        TimelineDayGroup(
            // A stable, unique key per day. `formatted(.iso8601)` rather than
            // an ISO8601DateFormatter instance, for the Sendable reason above.
            id: day.formatted(.iso8601),
            label: timelineDayLabel(day, calendar: calendar, now: now),
            entries: buckets[day] ?? []
        )
    }
}

/// Today / Yesterday / a date.
///
/// Compared against the INJECTED `now` rather than `calendar.isDateInToday`,
/// which reads the system clock — with that, the clock threaded through
/// `groupTimelineByDay` was dead and the test pinned nothing. Formatted through
/// the injected calendar's timezone too, so a startOfDay instant cannot be
/// rendered as the neighbouring day on a device in another zone.
func timelineDayLabel(
    _ day: Date,
    calendar: Calendar = .current,
    now: Date = Date()
) -> String {
    if calendar.isDate(day, inSameDayAs: now) { return "Today" }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
       calendar.isDate(day, inSameDayAs: yesterday) {
        return "Yesterday"
    }
    return timelineShortDate(day, calendar: calendar, format: "MMM d yyyy")
}

/// The accumulated history plus the cursor that continues it.
struct TimelineLog: Equatable {
    let entries: [TimelineEntry]
    /// Nil at the end of the history.
    let nextCursor: String?
}

/// Merge a fresh first page over the already-loaded tail, so a silent
/// revalidate never collapses what the user paged to.
///
/// The CURSOR travels with the entries, which is the part that is easy to get
/// wrong: when the tail is kept, the fresh first page's `next_cursor` points at
/// the end of page ONE, and adopting it would make the next "Show earlier"
/// re-request rows already on screen — the button appearing to do nothing.
/// Mirrors the Kotlin `mergeTimelineFirstPage`.
func mergeTimelineFirstPage(
    cached: TimelineLog?,
    page: ContactTimelinePage
) -> TimelineLog {
    guard let cached, cached.entries.count > page.entries.count else {
        return TimelineLog(entries: page.entries, nextCursor: page.next_cursor)
    }
    let fresh = Set(page.entries.map(\.dedupeKey))
    return TimelineLog(
        entries: page.entries + cached.entries.filter { !fresh.contains($0.dedupeKey) },
        nextCursor: cached.nextCursor
    )
}

/// Append a later page, keeping order and dropping repeats.
func appendTimelinePage(
    current: TimelineLog,
    page: ContactTimelinePage
) -> TimelineLog {
    let seen = Set(current.entries.map(\.dedupeKey))
    return TimelineLog(
        entries: current.entries + page.entries.filter { !seen.contains($0.dedupeKey) },
        nextCursor: page.next_cursor
    )
}
