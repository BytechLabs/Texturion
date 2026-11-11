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

/// #720: the short label for a moment ('now', '12m', '3:42 PM', 'Sat', 'Sep 9',
/// 'Sep 9, 2025'), from the shared rule. Unparseable input renders as an empty string.
func relativeTime(_ iso: String, now: Date = Date(), calendar: Calendar = .current) -> String {
    TimestampFormat.label(iso, now: now, timeZone: calendar.timeZone)
}

/// #720: the exact moment with its zone ('Tue, Nov 10, 2026, 3:42 PM EST'), or the raw
/// text when it is not a timestamp.
func absoluteTime(_ iso: String, calendar: Calendar = .current) -> String {
    let exact = TimestampFormat.exact(iso, timeZone: calendar.timeZone)
    return exact.isEmpty ? iso : exact
}

/// #582 — the two letters in an avatar. The hand-port of
/// `packages/shared/src/avatar-initials.ts`; `AvatarInitialsParityTests` holds this to
/// that file, so change them together or the test says so.
///
/// This used to take the first CHARACTER of the first and last word, whatever it was.
/// An unnamed contact displays as its formatted number, so the badge was handed
/// `(415) 555-0134` and wore `(5` — on the contacts list and the thread header, which
/// is the busiest screen in the app.
///
/// Unicode SCALARS rather than Swift `Character`s, deliberately. A `Character` is a
/// grapheme cluster and would be the prettier answer here — a decomposed "É" would
/// stay "É" — but TypeScript and Kotlin reach for two different APIs built on two
/// different Unicode tables to do the same, and three implementations each correct
/// against a different table is how this drifts apart again. Scalars are the same
/// operation in all three, which is what lets the parity test hold them together.
///
/// "Dana Whitcomb" → "DW", "Ana Maria Rojas" → "AR", "cher" → "CH",
/// "(415) 555-0134" → "#", "" → "?".
func initialsOf(_ name: String?) -> String {
    let trimmed = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "?" }
    // No letter anywhere means this is not a name — it is the number we show instead
    // of one, and `(5` is not initials.
    if !trimmed.unicodeScalars.contains(where: { isLetterScalar($0) }) { return "#" }

    let words = trimmed
        .split(whereSeparator: { $0.isWhitespace })
        .filter { word in word.unicodeScalars.contains(where: { isGlyphScalar($0) }) }
    if words.isEmpty { return "?" }
    if words.count == 1 {
        let glyphs = words[0].unicodeScalars.filter { isGlyphScalar($0) }.prefix(2)
        return String(String.UnicodeScalarView(glyphs)).uppercased()
    }
    return (firstGlyph(words[0]) + firstGlyph(words[words.count - 1])).uppercased()
}

/// A letter, by Unicode general category.
private func isLetterScalar(_ scalar: Unicode.Scalar) -> Bool {
    scalar.properties.isAlphabetic
}

/// A character worth showing: a letter or a digit, never punctuation.
private func isGlyphScalar(_ scalar: Unicode.Scalar) -> Bool {
    isLetterScalar(scalar) || scalar.properties.numericType != nil
}

/// The first letter-or-digit in a word, or "" if it has none.
private func firstGlyph(_ word: Substring) -> String {
    guard let scalar = word.unicodeScalars.first(where: { isGlyphScalar($0) }) else {
        return ""
    }
    return String(Character(scalar))
}

/// A not-done task whose due date is in the past.
func isOverdue(_ task: TaskItem, now: Date = Date()) -> Bool {
    guard !task.done, let due = parseWireTimestamp(task.due_at) else { return false }
    return due < now
}

/// A short human due label for a chip/cell, from the shared timestamp rule: "3:00 PM"
/// today, "Tomorrow", "Sat", "Jul 8", "Jul 8, 2027". Nil/unparseable due → "" (the
/// caller renders nothing).
func formatDue(_ dueAt: String?, now: Date = Date(), calendar: Calendar = .current) -> String {
    TimestampFormat.label(dueAt, now: now, timeZone: calendar.timeZone)
}

extension String {
    var isBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// A CSV export as the bytes to write to a file. #587.
///
/// The server emits a UTF-8 byte-order mark so Excel round-trips accents, but the
/// response arrives here as a decoded `String`, so it is re-attached on the way to
/// disk. Stripping first keeps it idempotent if a transport ever stops eating it.
///
/// ONE COPY. This was written out twice — the contacts screen and the billing
/// screen's export door — and two copies of three magic bytes is how one of them
/// quietly loses them.
func csvExportData(_ text: String) -> Data {
    var data = Data([0xEF, 0xBB, 0xBF])
    var body = text
    if body.hasPrefix("\u{FEFF}") { body.removeFirst() }
    data.append(Data(body.utf8))
    return data
}

/// #238: a line with a due label in it, drawn by `formatDue` and spoken in full; see
/// `timedText`.
func timedDue(
    locale: String? = nil,
    _ build: (_ due: (String?) -> String) -> String
) -> TimedText {
    timedText(locale: locale, drawTime: { formatDue($0) }, build)
}
