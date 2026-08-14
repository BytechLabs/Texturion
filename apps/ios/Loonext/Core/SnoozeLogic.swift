import Foundation

/// #293 — when "later" is.
///
/// A hand-port of packages/shared/src/snooze.ts, mirrored again in
/// android/core/snooze/SnoozeLogic.kt. A snooze set on this phone has to mean
/// the same instant as the identical tap on a laptop, so what is shared is the
/// SPEC: which presets exist, what hour each lands on, the order they are
/// offered in, the wording, and the rule that decides when one is not offered.
///
/// The calendar arithmetic is deliberately NOT ported. It uses Foundation here
/// and java.time on Android because only a real calendar gets DST right —
/// "tomorrow at 8" the night the clocks go forward is not "now plus 24 hours",
/// and a hand-rolled offset would be wrong twice a year in a way nobody reports
/// as a bug, only as the app being odd.
///
/// Resolved in the DEVICE's zone, which is the user's zone (#292): the client
/// sends an absolute instant, so the server never guesses a timezone it was not
/// told, and somebody working away from home gets the morning they are in.
enum SnoozeTiming {
    /// The hours a deferral lands on, in the user's own clock.
    static let morningHour = 8
    static let afternoonHour = 15
    static let eveningHour = 18

    /// A preset resolving nearer than this is not offered. At 14:55 "This
    /// afternoon" is five minutes away — the thread would blink out and come
    /// straight back, which reads as a broken feature rather than a badly
    /// chosen time.
    static let minLead: TimeInterval = 10 * 60

    /// Snoozing further out than this is neither offered nor accepted.
    static let maxDays: Double = 365

    /// The reason a person leaves on a deferral, in characters. This is the
    /// `char_length(note) <= 120` CHECK on conversation_snoozes, so the picker
    /// stops taking characters exactly where the database stops accepting them
    /// rather than turning a thoughtful note into an error on Snooze.
    static let noteMax = 120
}

enum SnoozePresetID: String, Sendable, CaseIterable {
    case laterToday
    case thisEvening
    case tomorrow
    case nextWeek

    /// The wording, one place, so three clients cannot drift apart on it.
    var label: String { localisedLabel() }

    /// The same wording, in the reader's language. A distinct name rather than
    /// an overload of `label` — see the note in `Model/Calls.swift`.
    func localisedLabel(_ locale: String? = nil) -> String {
        switch self {
        case .laterToday: return AppStrings.translate(locale, "domain.snoozePresetAfternoon")
        case .thisEvening: return AppStrings.translate(locale, "domain.snoozePresetEvening")
        case .tomorrow: return AppStrings.translate(locale, "domain.snoozePresetTomorrow")
        case .nextWeek: return AppStrings.translate(locale, "domain.snoozePresetNextWeek")
        }
    }
}

struct SnoozePreset: Sendable, Identifiable {
    let id: SnoozePresetID
    let label: String
    /// The absolute instant it resolves to.
    let at: Date
}

/// Days from `date` forward to the next Monday — never 0, always next week.
func daysUntilNextMonday(_ date: Date, calendar: Calendar = .current) -> Int {
    // Calendar's weekday is 1 = Sunday … 7 = Saturday, which is NOT the same
    // numbering as java.time's DayOfWeek or JavaScript's getDay(). Converting
    // to a Monday-is-1 index first keeps this arithmetic identical to the other
    // two clients rather than merely similar.
    let weekday = calendar.component(.weekday, from: date)
    let mondayBased = weekday == 1 ? 7 : weekday - 1  // Mon = 1 … Sun = 7
    // Monday itself lands seven days out: "next week" on a Monday is not today.
    return mondayBased == 7 ? 1 : 8 - mondayBased
}

/// The presets to offer right now, in order, already resolved.
///
/// Anything at or before `now + minLead` is dropped rather than disabled: at
/// 4pm there is no "this afternoon" to offer, and a shorter list is a better
/// answer than a greyed-out button.
/// #228: `locale` is LAST and DEFAULTED, so `SnoozeLogicTests` — which pins the
/// ids and the instants and passes nothing — keeps compiling and keeps reading
/// the English, while the sheet that knows its reader passes `appLocale`.
func snoozePresets(
    now: Date = Date(),
    calendar: Calendar = .current,
    locale: String? = nil
) -> [SnoozePreset] {
    let floor = now.addingTimeInterval(SnoozeTiming.minLead)

    func at(addDays: Int, hour: Int) -> Date? {
        guard let day = calendar.date(byAdding: .day, value: addDays, to: now) else {
            return nil
        }
        return calendar.date(
            bySettingHour: hour, minute: 0, second: 0, of: day, matchingPolicy: .nextTime
        )
    }

    let candidates: [(SnoozePresetID, Date?)] = [
        (.laterToday, at(addDays: 0, hour: SnoozeTiming.afternoonHour)),
        (.thisEvening, at(addDays: 0, hour: SnoozeTiming.eveningHour)),
        (.tomorrow, at(addDays: 1, hour: SnoozeTiming.morningHour)),
        (
            .nextWeek,
            at(
                addDays: daysUntilNextMonday(now, calendar: calendar),
                hour: SnoozeTiming.morningHour
            )
        ),
    ]

    return candidates.compactMap { id, date in
        guard let date, date > floor else { return nil }
        return SnoozePreset(id: id, label: id.localisedLabel(locale), at: date)
    }
}

/// How a deferral comes back: quietly, or as something to chase.
/// Identifiable so a SwiftUI `.sheet(item:)` can carry WHICH ladder opened it —
/// one optional instead of a bool plus a second piece of state that can drift
/// out of step with it.
enum DeferralKind: String, Sendable, Identifiable {
    case snooze
    case followUp = "follow_up"

    var id: String { rawValue }
}

enum FollowUpPresetID: String, Sendable, CaseIterable {
    case threeDays
    case nextWeek
    case twoWeeks

    var label: String { localisedLabel() }

    /// The same wording, in the reader's language.
    func localisedLabel(_ locale: String? = nil) -> String {
        switch self {
        case .threeDays: return AppStrings.translate(locale, "domain.followUpPresetThreeDays")
        // The same KEY the snooze ladder uses for this rung: one sentence for a
        // translator to get right rather than two identical ones.
        case .nextWeek: return AppStrings.translate(locale, "domain.snoozePresetNextWeek")
        case .twoWeeks: return AppStrings.translate(locale, "domain.followUpPresetTwoWeeks")
        }
    }
}

struct FollowUpPreset: Sendable, Identifiable {
    let id: FollowUpPresetID
    let label: String
    let at: Date
}

/// When to chase.
///
/// A SEPARATE ladder from `snoozePresets`, and that is the point rather than
/// duplication: "this afternoon" is a meaningful time to pick a thread back up
/// and a meaningless time to chase a quote. Deferring your own next action and
/// waiting on somebody else's answer run on different clocks, so one ladder for
/// both would put three useless options in front of whichever job you were
/// actually doing.
///
/// All three land on the morning hour, in the user's own clock: a reminder that
/// fires at 11pm is read the next day anyway.
func followUpPresets(
    now: Date = Date(),
    calendar: Calendar = .current,
    // #228: LAST and DEFAULTED, for the same reason `snoozePresets` takes it so.
    locale: String? = nil
) -> [FollowUpPreset] {
    let floor = now.addingTimeInterval(SnoozeTiming.minLead)

    func at(addDays: Int) -> Date? {
        guard let day = calendar.date(byAdding: .day, value: addDays, to: now) else {
            return nil
        }
        return calendar.date(
            bySettingHour: SnoozeTiming.morningHour, minute: 0, second: 0,
            of: day, matchingPolicy: .nextTime
        )
    }

    let candidates: [(FollowUpPresetID, Date?)] = [
        (.threeDays, at(addDays: 3)),
        (.nextWeek, at(addDays: daysUntilNextMonday(now, calendar: calendar))),
        (.twoWeeks, at(addDays: 14)),
    ]

    // Every rung here is days out, so the floor cannot bite — but it stays,
    // because the day this gains a "this evening" is the day somebody discovers
    // it silently could.
    return candidates.compactMap { id, date in
        guard let date, date > floor else { return nil }
        return FollowUpPreset(id: id, label: id.localisedLabel(locale), at: date)
    }
}

/// Is a custom instant one the API will accept?
///
/// Mirrors the route's two gates so the picker can say so before the round trip
/// instead of rendering an error the user could have been spared.
func isSnoozeTargetValid(_ target: Date, now: Date = Date()) -> Bool {
    let delta = target.timeIntervalSince(now)
    return delta > 0 && delta <= SnoozeTiming.maxDays * 86_400
}

/// The SHAPE of a return-time label. Only the shape is decided here; the
/// formatting is the platform's, because a hand-rolled month table is how a
/// product ends up saying "Aug" to somebody whose phone is in French.
enum SnoozeReturnShape: Sendable {
    case today
    case tomorrow
    case weekday
    case date
}

func snoozeReturnShape(
    until: Date,
    now: Date = Date(),
    calendar: Calendar = .current
) -> SnoozeReturnShape {
    // Day boundaries, not elapsed hours: 11pm to 1am is "tomorrow", and 1am to
    // 11pm is "today", however few or many hours that is.
    let days = calendar.dateComponents(
        [.day],
        from: calendar.startOfDay(for: now),
        to: calendar.startOfDay(for: until)
    ).day ?? 0

    if days <= 0 { return .today }
    if days == 1 { return .tomorrow }
    // Inside a week a weekday name is unambiguous and shorter than a date; past
    // that "Thursday" could be any of several, so it has to be a date.
    if days < 7 { return .weekday }
    return .date
}

/// ISO-8601 → Date, or nil when it is not a timestamp we understand.
///
/// Two formatters because PostgREST renders timestamptz with a fractional part
/// only sometimes, and ISO8601DateFormatter matches its options EXACTLY — a
/// single formatter silently returns nil for the other shape, which would have
/// made real snoozes look already-elapsed.
func parseSnoozeInstant(_ iso: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFraction.date(from: iso) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: iso)
}

/// Is this row currently deferred by the caller?
///
/// Computed from the return time rather than the field's presence, matching the
/// server exactly: a snooze whose moment has passed is simply over, with no
/// sweep to run late. An unparseable timestamp counts as NOT deferred — hiding
/// a live thread because a date failed to parse is the one direction this must
/// never fail in.
func isSnoozed(_ snoozedUntil: String?, now: Date = Date()) -> Bool {
    guard let snoozedUntil, let until = parseSnoozeInstant(snoozedUntil) else {
        return false
    }
    return until > now
}

/// "Back at 3:00 PM" / "Back tomorrow, 8:00 AM" / "Back Thursday, 8:00 AM" /
/// "Back 12 Aug".
///
/// The SHAPE comes from `snoozeReturnShape`; the words come from Foundation
/// with the device's locale, so a phone set to French says août rather than
/// whatever a hand-rolled month table would have said.
func snoozeReturnLabel(
    _ untilISO: String,
    now: Date = Date(),
    calendar: Calendar = .current,
    locale: String? = nil
) -> String {
    guard let until = parseSnoozeInstant(untilISO) else {
        return AppStrings.translate(locale, "domain.snoozeFallback")
    }
    return snoozeReturnLabel(until, now: now, calendar: calendar, locale: locale)
}

func snoozeReturnLabel(
    _ until: Date,
    now: Date = Date(),
    calendar: Calendar = .current,
    locale: String? = nil
) -> String {
    let time = DateFormatter()
    time.calendar = calendar
    time.locale = .autoupdatingCurrent
    time.timeZone = calendar.timeZone
    time.dateFormat = DateFormatter.dateFormat(
        fromTemplate: "jmm", options: 0, locale: .autoupdatingCurrent
    )
    let clock = time.string(from: until)

    // #228: whole sentences with the clock interpolated in. The day name and
    // the month still come from Foundation with the DEVICE's locale, for the
    // reason the doc above gives — a hand-rolled month table is how a product
    // ends up saying "Aug" to somebody whose phone is in French.
    switch snoozeReturnShape(until: until, now: now, calendar: calendar) {
    case .today:
        return AppStrings.translate(locale, "domain.snoozeBackAt", ["time": clock])
    case .tomorrow:
        return AppStrings.translate(
            locale, "domain.snoozeBackTomorrow", ["time": clock]
        )
    case .weekday:
        let weekday = DateFormatter()
        weekday.calendar = calendar
        weekday.locale = .autoupdatingCurrent
        weekday.timeZone = calendar.timeZone
        weekday.dateFormat = "EEEE"
        return AppStrings.translate(
            locale,
            "domain.snoozeBackWeekday",
            ["day": weekday.string(from: until), "time": clock]
        )
    case .date:
        let day = DateFormatter()
        day.calendar = calendar
        day.locale = .autoupdatingCurrent
        day.timeZone = calendar.timeZone
        day.dateFormat = DateFormatter.dateFormat(
            fromTemplate: "dMMM", options: 0, locale: .autoupdatingCurrent
        )
        return AppStrings.translate(
            locale, "domain.snoozeBackDate", ["date": day.string(from: until)]
        )
    }
}

/// The instant a client sends. Always UTC ISO-8601 without fractional seconds,
/// which is what the route's `z.iso.datetime({ offset: true })` accepts.
func snoozeInstantISO(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
}
