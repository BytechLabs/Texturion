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
    /// #517: who picked the call up. Nil on a job, a conversation, an
    /// unanswered call, and on any call answered before the server started
    /// reporting it — so the row falls back to the bare label rather than
    /// carrying a name-shaped hole.
    let answered_by_user_id: String?

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
///
/// #517: `memberNames` resolves an answered call's picker-upper, so this page
/// and the thread describe one call the same way. Defaulted empty because the
/// name is a decoration on a line that already reads correctly without it.
func timelineTitle(
    _ entry: TimelineEntry,
    memberNames: [String: String] = [:],
    locale: String = MessageLocale.en
) -> String {
    switch entry.kind {
    case "task":
        return entry.detail ?? AppStrings.translate(locale, "contactsTasks.timelineJob")
    case "call":
        switch entry.status {
        case "answered":
            guard let who = entry.answered_by_user_id.flatMap({ memberNames[$0] })
            else {
                return AppStrings.translate(locale, "contactsTasks.timelineCallAnswered")
            }
            return AppStrings.translate(
                locale,
                "contactsTasks.timelineCallAnsweredBy",
                ["name": who]
            )
        case "voicemail":
            return AppStrings.translate(locale, "contactsTasks.timelineVoicemail")
        default:
            return AppStrings.translate(locale, "contactsTasks.timelineMissedCall")
        }
    default:
        return AppStrings.translate(locale, "contactsTasks.timelineConversation")
    }
}

/// The second line: the one detail worth carrying at a glance.
func timelineDetail(
    _ entry: TimelineEntry,
    locale: String = MessageLocale.en
) -> String {
    switch entry.kind {
    case "task":
        if entry.done == true {
            return AppStrings.translate(locale, "contactsTasks.timelineDone")
        }
        if let due = entry.due_at {
            return AppStrings.translate(
                locale,
                "contactsTasks.timelineDue",
                ["date": timelineDueLabel(due, locale: locale)]
            )
        }
        return AppStrings.translate(locale, "contactsTasks.timelineOpen")
    case "call":
        // Talk time only, and only when there was any: "0s" on a missed call
        // reads as a fault rather than as an absence.
        let seconds = entry.talk_seconds ?? 0
        return seconds > 0
            ? AppStrings.translate(
                locale,
                "contactsTasks.timelineTalkedFor",
                ["duration": timelineTalkTime(seconds, locale: locale)]
            )
            : AppStrings.translate(locale, "contactsTasks.timelineNoAnswer")
    default:
        return AppStrings.translate(
            locale,
            entry.status == "closed"
                ? "contactsTasks.timelineClosed"
                : "contactsTasks.timelineOpen"
        )
    }
}

func timelineTalkTime(
    _ seconds: Int,
    locale: String = MessageLocale.en
) -> String {
    let minutes = seconds / 60
    let rest = seconds % 60
    return AppStrings.translate(
        locale,
        minutes > 0
            ? "contactsTasks.timelineDurationMinutes"
            : "contactsTasks.timelineDurationSeconds",
        ["minutes": String(minutes), "seconds": String(rest)]
    )
}

private func timelineDueLabel(
    _ iso: String,
    calendar: Calendar = .current,
    locale: String = MessageLocale.en
) -> String {
    guard let date = parseWireTimestamp(iso) else {
        return AppStrings.translate(locale, "contactsTasks.timelineSoon")
    }
    return timelineShortDate(date, calendar: calendar, template: "MMMd", locale: locale)
}

/// The app's established date formatting: a LOCAL DateFormatter with the posix
/// locale and an explicit pattern (Format.swift's monthDayString/absoluteTime).
///
/// Not `.formatted(.dateTime...)`: that API appears nowhere else in this app, so
/// it is unproven here, and Swift only compiles in CI. Not a cached formatter
/// either — the class is not Sendable, so a `static let` is a build error.
func timelineShortDate(
    _ date: Date,
    calendar: Calendar,
    template: String,
    locale: String = MessageLocale.en
) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: locale == MessageLocale.frCA ? "fr_CA" : "en_CA")
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.setLocalizedDateFormatFromTemplate(template)
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
    now: Date = Date(),
    locale: String = MessageLocale.en
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
            label: timelineDayLabel(day, calendar: calendar, now: now, locale: locale),
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
    now: Date = Date(),
    locale: String = MessageLocale.en
) -> String {
    if calendar.isDate(day, inSameDayAs: now) {
        return AppStrings.translate(locale, "contactsTasks.today")
    }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
       calendar.isDate(day, inSameDayAs: yesterday) {
        return AppStrings.translate(locale, "contactsTasks.timelineYesterday")
    }
    return timelineShortDate(
        day,
        calendar: calendar,
        template: "MMMdyyyy",
        locale: locale
    )
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
