import Foundation

/// Pure display formatting shared across tabs — mirrors the Android
/// ui/common/Ui.kt + features/tasks/TaskFormat.kt helpers so the two clients
/// read identically. Locale is pinned to en_US_POSIX: the app's copy is
/// English and the unit tests must be deterministic on any CI machine.

private let posixLocale = Locale(identifier: "en_US_POSIX")

/// Parse a wire timestamp that may be UTC ("…Z"), offset-bearing
/// ("…-04:00" — due_at echoes what clients wrote), fractional-seconds
/// bearing, or offset-less. Nil when unparseable — callers render nothing
/// rather than crash on a new shape.
func parseWireTimestamp(_ iso: String?) -> Date? {
    guard let iso else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: iso) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    if let date = plain.date(from: iso) { return date }
    // Offset-less local timestamp (rare, but the Android client accepts it).
    let local = DateFormatter()
    local.locale = posixLocale
    local.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    local.timeZone = TimeZone.current
    return local.date(from: iso)
}

/// '(415) 555-0134' for +1 NANP numbers, raw otherwise.
func formatPhone(_ e164: String?) -> String {
    guard let e164 else { return "" }
    guard e164.hasPrefix("+1") else { return e164 }
    let digits = e164.dropFirst(2)
    guard digits.count == 10, digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return e164 }
    let npa = digits.prefix(3)
    let nxx = digits.dropFirst(3).prefix(3)
    let line = digits.suffix(4)
    return "(\(npa)) \(nxx)-\(line)"
}

/// Relative timestamp mirroring the web ('now', '5m', '3h', '2d', 'Jul 8',
/// 'Jul 8 2025'). Unparseable input renders as an empty string.
func relativeTime(_ iso: String, now: Date = Date(), calendar: Calendar = .current) -> String {
    guard let date = parseWireTimestamp(iso) else { return "" }
    let seconds = now.timeIntervalSince(date)
    let minutes = Int(seconds / 60)
    let hours = Int(seconds / 3600)
    let days = Int(seconds / 86_400)
    if minutes < 1 { return "now" }
    if minutes < 60 { return "\(minutes)m" }
    if hours < 24 { return "\(hours)h" }
    if days < 7 { return "\(days)d" }
    let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
    return monthDayString(date, calendar: calendar, withYear: !sameYear)
}

/// 'Jul 8, 2026 3:04 PM' for detail surfaces.
func absoluteTime(_ iso: String, calendar: Calendar = .current) -> String {
    guard let date = parseWireTimestamp(iso) else { return iso }
    let formatter = DateFormatter()
    formatter.locale = posixLocale
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "MMM d, yyyy h:mm a"
    return formatter.string(from: date)
}

/// Flat avatar initials: "Dana Whitcomb" → "DW", "cher" → "CH", empty → "#".
func initialsOf(_ name: String?) -> String {
    let trimmed = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "#" }
    let parts = trimmed.split(whereSeparator: { $0.isWhitespace })
    if parts.count >= 2, let first = parts.first?.first, let last = parts.last?.first {
        return String([first, last]).uppercased()
    }
    return String(trimmed.prefix(2)).uppercased()
}

/// A not-done task whose due date is in the past.
func isOverdue(_ task: TaskItem, now: Date = Date()) -> Bool {
    guard !task.done, let due = parseWireTimestamp(task.due_at) else { return false }
    return due < now
}

/// A short human due label for a chip/cell: "Today", "Tomorrow", "Jul 8",
/// "Jul 8 2027". Nil/unparseable due → "" (the caller renders nothing).
func formatDue(_ dueAt: String?, now: Date = Date(), calendar: Calendar = .current) -> String {
    guard let due = parseWireTimestamp(dueAt) else { return "" }
    if calendar.isDate(due, inSameDayAs: now) { return "Today" }
    if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now),
       calendar.isDate(due, inSameDayAs: tomorrow) {
        return "Tomorrow"
    }
    let sameYear = calendar.component(.year, from: due) == calendar.component(.year, from: now)
    return monthDayString(due, calendar: calendar, withYear: !sameYear)
}

extension String {
    var isBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

private func monthDayString(_ date: Date, calendar: Calendar, withYear: Bool) -> String {
    let formatter = DateFormatter()
    formatter.locale = posixLocale
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = withYear ? "MMM d yyyy" : "MMM d"
    return formatter.string(from: date)
}
