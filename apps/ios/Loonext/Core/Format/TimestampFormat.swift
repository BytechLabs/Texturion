import Foundation

/// #720: which words a date or time is shown in. Hand-port of
/// `packages/shared/src/timestamp-shape.ts`; `TimestampShapeTests` runs it against
/// `packages/shared/vectors/timestamp-shape.json`.
///
/// Calendar days are counted in the reader's zone, so a text from 11 PM last night is
/// "yesterday" even when it was four hours ago.
enum TimestampBucket: String {
    case now
    case minutesAgo
    case today
    case yesterday
    case tomorrow
    case thisWeek
    case thisYear
    case older
}

struct TimestampShape: Equatable {
    let bucket: TimestampBucket
    /// Whole minutes ago; set only for `.minutesAgo`, 0 otherwise.
    let minutes: Int
}

func timestampShape(atMs: Int64, nowMs: Int64, timeZone: TimeZone) -> TimestampShape {
    let ago = nowMs - atMs
    if abs(ago) < 60_000 { return TimestampShape(bucket: .now, minutes: 0) }
    if ago > 0 && ago < 3_600_000 {
        return TimestampShape(bucket: .minutesAgo, minutes: Int(ago / 60_000))
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let at = Date(timeIntervalSince1970: Double(atMs) / 1000)
    let now = Date(timeIntervalSince1970: Double(nowMs) / 1000)
    let daysAgo = calendar.dateComponents(
        [.day],
        from: calendar.startOfDay(for: at),
        to: calendar.startOfDay(for: now)
    ).day ?? 0
    let bucket: TimestampBucket
    if daysAgo == 0 {
        bucket = .today
    } else if daysAgo == 1 {
        bucket = .yesterday
    } else if daysAgo == -1 {
        bucket = .tomorrow
    } else if abs(daysAgo) < 7 {
        bucket = .thisWeek
    } else if calendar.component(.year, from: at) == calendar.component(.year, from: now) {
        bucket = .thisYear
    } else {
        bucket = .older
    }
    return TimestampShape(bucket: bucket, minutes: 0)
}

/// #720: the ONE place this app draws a date or a time a person reads.
///
/// The label comes from `timestampShape` ("now", "12m", "3:42 PM", "Yesterday", "Sat",
/// "Sep 9", "Sep 9, 2025"); `exact` is the full moment with its zone
/// ("Tue, Nov 10, 2026, 3:42 PM EST") for a long-press and for VoiceOver.
/// `TimestampGuardTests` fails on any other file drawing a date itself.
enum TimestampFormat {
    enum Style {
        case short
        case long
    }

    private static func isFrench(_ locale: String?) -> Bool {
        (locale ?? UiLocaleStore.readerLocale) == MessageLocale.frCA
    }

    /// English names come from `en_US` and French from `fr_CA`; the patterns are
    /// explicit so the names are all the locale decides.
    private static func formatter(
        _ locale: String?, _ timeZone: TimeZone, english: String, french: String
    ) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.timeZone = timeZone
        // No locale means the reader's, as on Android, never English by default.
        if isFrench(locale ?? UiLocaleStore.readerLocale) {
            formatter.locale = Locale(identifier: "fr_CA")
            formatter.dateFormat = french
        } else {
            formatter.locale = Locale(identifier: "en_US")
            formatter.dateFormat = english
        }
        return formatter
    }

    private static func draw(
        _ date: Date, _ locale: String?, _ timeZone: TimeZone, english: String, french: String
    ) -> String {
        formatter(locale, timeZone, english: english, french: french).string(from: date)
    }

    /// A time of day alone ("3:42 PM", "15 h 42"), for a clock that sits under a heading
    /// that names the day.
    static func clock(
        _ date: Date, locale: String? = nil, timeZone: TimeZone = .current
    ) -> String {
        draw(date, locale, timeZone, english: "h:mm a", french: "H 'h' mm")
    }

    /// A bad or absent timestamp is blank, never "Invalid Date".
    static func label(
        _ iso: String?,
        style: Style = .short,
        locale: String? = nil,
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> String {
        guard let date = parseWireTimestamp(iso) else { return "" }
        return label(date, style: style, locale: locale, now: now, timeZone: timeZone)
    }

    static func label(
        _ date: Date,
        style: Style = .short,
        locale: String? = nil,
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> String {
        let words = locale ?? UiLocaleStore.readerLocale
        let long = style == .long
        let shape = timestampShape(
            atMs: Int64((date.timeIntervalSince1970 * 1000).rounded()),
            nowMs: Int64((now.timeIntervalSince1970 * 1000).rounded()),
            timeZone: timeZone
        )
        let time = clock(date, locale: locale, timeZone: timeZone)
        switch shape.bucket {
        case .now:
            return AppStrings.translate(words, "time.now")
        case .minutesAgo:
            return "\(shape.minutes)m"
        case .today:
            return time
        case .yesterday:
            return long
                ? AppStrings.translate(words, "time.yesterdayAt", ["time": time])
                : AppStrings.translate(words, "time.yesterday")
        case .tomorrow:
            return long
                ? AppStrings.translate(words, "time.tomorrowAt", ["time": time])
                : AppStrings.translate(words, "time.tomorrow")
        case .thisWeek:
            let day = draw(date, locale, timeZone, english: "EEE", french: "EEE")
            return long ? "\(day) \(time)" : day
        case .thisYear:
            let day = draw(date, locale, timeZone, english: "MMM d", french: "d MMM")
            return long ? "\(day), \(time)" : day
        case .older:
            let day = draw(date, locale, timeZone, english: "MMM d, yyyy", french: "d MMM yyyy")
            return long ? "\(day), \(time)" : day
        }
    }

    /// "Tue, Nov 10, 2026, 3:42 PM EST": weekday, date, time and zone.
    static func exact(
        _ iso: String?, locale: String? = nil, timeZone: TimeZone = .current
    ) -> String {
        guard let date = parseWireTimestamp(iso) else { return "" }
        let date1 = draw(
            date, locale, timeZone, english: "EEE, MMM d, yyyy", french: "EEE d MMM yyyy")
        let zone = draw(date, locale, timeZone, english: "zzz", french: "zzz")
        return "\(date1), \(clock(date, locale: locale, timeZone: timeZone)) \(zone)"
    }

    /// What VoiceOver says: the visible label, then the exact time.
    static func spoken(
        _ iso: String?,
        locale: String? = nil,
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> String {
        let exactText = exact(iso, locale: locale, timeZone: timeZone)
        if exactText.isEmpty { return "" }
        let labelText = label(iso, style: .long, locale: locale, now: now, timeZone: timeZone)
        return "\(labelText), \(exactText)"
    }
}
