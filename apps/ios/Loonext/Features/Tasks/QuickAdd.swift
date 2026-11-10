import Foundation

/// #689 A: the quick-add line.
///
///   "Fix furnace @rehman tomorrow 9am #urgent"
///
/// becomes a title, one person, a due time, a priority and labels. Nothing here
/// saves anything: it returns what it understood, and the screen shows that as a
/// preview the member confirms.
///
/// A hand port of `packages/shared/src/quick-add.ts`, run against
/// `packages/shared/vectors/quick-add.json`. The rules, in the order they bind,
/// are written out at the top of that file; this one only records where the
/// port differs in mechanism:
///
///  - no regular expressions. `\b` does not compile in a Swift regex literal and
///    a pattern copied across three languages is where this repository has been
///    bitten, so each shape (`9:30pm`, `3rd`, `2026-11-12`) is read by hand;
///  - the member's zone is a `TimeZone`, and the wall clock of an instant in it
///    comes from a `Calendar` set to that zone. All other date arithmetic is on
///    plain integers (days from civil), so it cannot drift with the device zone.
///
/// A word the parser is not sure of is always left in the title.

enum QuickAddPriority: String, Sendable, Equatable {
    case low
    case normal
    case high
    case urgent
}

struct QuickAddMember: Sendable, Equatable {
    let userId: String
    let name: String
}

struct QuickAddLabel: Sendable, Equatable {
    let id: String
    let name: String
}

struct QuickAddContext: Sendable {
    /// The instant the line is typed.
    let now: Date
    /// The zone of the member who is typing.
    let timeZone: TimeZone
    /// The member typing, for "@me".
    let selfUserId: String
    let members: [QuickAddMember]
    let labels: [QuickAddLabel]
}

struct QuickAddUnderstood: Sendable, Equatable {
    /// "assignee", "due", "priority" or "label".
    let kind: String
    /// The words as typed.
    let text: String
}

struct QuickAddResult: Sendable, Equatable {
    /// What is left once everything understood is taken out.
    let title: String
    let assignee: QuickAddMember?
    /// UTC instant, ISO 8601 with milliseconds, or nil.
    let dueAt: String?
    /// True when the line named a time of day.
    let dueHasTime: Bool
    let priority: QuickAddPriority?
    let labels: [QuickAddLabel]
    let understood: [QuickAddUnderstood]
    /// Words that looked like a mention or a label and matched nothing; they stay in the title.
    let ignored: [String]
}

private let priorityWords: [String: QuickAddPriority] = [
    "urgent": .urgent,
    "high": .high,
    "low": .low,
    "normal": .normal,
]

private let weekdays: [String: Int] = [
    "sunday": 0, "sun": 0,
    "monday": 1, "mon": 1,
    "tuesday": 2, "tue": 2, "tues": 2,
    "wednesday": 3, "wed": 3,
    "thursday": 4, "thu": 4, "thur": 4, "thurs": 4,
    "friday": 5, "fri": 5,
    "saturday": 6, "sat": 6,
]

private let months: [String: Int] = [
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
]

private let defaultHour = 9
private let afternoonHour = 17
private let tonightHour = 18

private struct Civil {
    var y: Int
    var m: Int
    var d: Int
}

private struct TimeOfDay {
    var h: Int
    var mi: Int
}

private struct WallClock {
    var civil: Civil
    var clock: TimeOfDay
    var weekday: Int
}

// MARK: - Calendar arithmetic on plain integers

/// Days since 1970-01-01 of a civil date (proleptic Gregorian).
private func daysFromCivil(_ c: Civil) -> Int {
    let y = c.m <= 2 ? c.y - 1 : c.y
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = (c.m + 9) % 12
    let doy = (153 * mp + 2) / 5 + c.d - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
}

private func civilFromDays(_ days: Int) -> Civil {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
    let y = yoe + era * 400
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let d = doy - (153 * mp + 2) / 5 + 1
    let m = mp < 10 ? mp + 3 : mp - 9
    return Civil(y: m <= 2 ? y + 1 : y, m: m, d: d)
}

private func addDays(_ civil: Civil, _ days: Int) -> Civil {
    civilFromDays(daysFromCivil(civil) + days)
}

private func daysInMonth(_ y: Int, _ m: Int) -> Int {
    let next = m == 12 ? Civil(y: y + 1, m: 1, d: 1) : Civil(y: y, m: m + 1, d: 1)
    return daysFromCivil(next) - daysFromCivil(Civil(y: y, m: m, d: 1))
}

private func civilKey(_ c: Civil) -> Int {
    c.y * 10_000 + c.m * 100 + c.d
}

/// Milliseconds since the epoch of a UTC wall clock (what `Date.UTC` returns).
private func utcMillis(_ c: Civil, _ k: TimeOfDay) -> Int {
    ((daysFromCivil(c) * 24 + k.h) * 60 + k.mi) * 60_000
}

private func millis(of date: Date) -> Int {
    Int((date.timeIntervalSince1970 * 1000).rounded())
}

/// The wall clock of an instant (milliseconds) in a zone.
private func wallClock(_ instant: Int, _ zone: TimeZone) -> WallClock {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let date = Date(timeIntervalSince1970: Double(instant) / 1000)
    let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .weekday], from: date)
    return WallClock(
        civil: Civil(y: parts.year ?? 1970, m: parts.month ?? 1, d: parts.day ?? 1),
        clock: TimeOfDay(h: (parts.hour ?? 0) % 24, mi: parts.minute ?? 0),
        // Calendar counts Sunday as 1; the rules count it as 0.
        weekday: ((parts.weekday ?? 1) - 1 + 7) % 7
    )
}

private func offsetAt(_ instant: Int, _ zone: TimeZone) -> Int {
    let w = wallClock(instant, zone)
    return utcMillis(w.civil, w.clock) - (instant / 60_000) * 60_000
}

/// The instant (milliseconds) at which a zone's wall clock reads this civil
/// date and time.
private func zonedToInstant(_ civil: Civil, _ clock: TimeOfDay, _ zone: TimeZone) -> Int {
    let guess = utcMillis(civil, clock)
    var instant = guess - offsetAt(guess, zone)
    // Across a daylight-saving change the offset at the guess is not the offset
    // at the answer; one more step settles it.
    let corrected = guess - offsetAt(instant, zone)
    if corrected != instant { instant = corrected }
    return instant
}

private func isoString(_ instant: Int) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(identifier: "UTC")
    return formatter.string(from: Date(timeIntervalSince1970: Double(instant) / 1000))
}

// MARK: - Words

private struct Word {
    /// As typed, for the preview and for the title.
    let raw: String
    /// Lower case with trailing sentence punctuation removed.
    let low: String
}

private func stripTail(_ text: String) -> String {
    var chars = Array(text)
    while let last = chars.last, ",.;!?)".contains(last) { chars.removeLast() }
    return String(chars)
}

private func toWords(_ line: String) -> [Word] {
    line.split(whereSeparator: { $0.isWhitespace }).map { piece in
        let raw = String(piece)
        return Word(raw: raw, low: stripTail(raw).lowercased())
    }
}

private func isDigit(_ c: Character) -> Bool {
    guard let v = c.asciiValue else { return false }
    return v >= 48 && v <= 57
}

/// The ASCII digits at the start of `chars`, from `from`.
private func leadingDigits(_ chars: [Character], from: Int = 0) -> (value: Int, count: Int) {
    var value = 0
    var count = 0
    var i = from
    while i < chars.count, isDigit(chars[i]) {
        // Capped so a very long run cannot overflow; the callers reject long runs.
        if count < 12 { value = value * 10 + Int(chars[i].asciiValue! - 48) }
        count += 1
        i += 1
    }
    return (value, count)
}

private func isMeridiem(_ rest: ArraySlice<Character>) -> Bool {
    let text = String(rest)
    return text == "am" || text == "pm"
}

/// A time of day written as one word: 9am, 9:30pm, 14:00, noon.
private func parseClockWord(_ low: String) -> TimeOfDay? {
    if low == "noon" { return TimeOfDay(h: 12, mi: 0) }
    let chars = Array(low)
    let hourDigits = leadingDigits(chars)
    guard hourDigits.count >= 1, hourDigits.count <= 2 else { return nil }
    var i = hourDigits.count
    let hour = hourDigits.value
    var minute = 0
    var hasMinutes = false
    if i < chars.count, chars[i] == ":" {
        let minuteDigits = leadingDigits(chars, from: i + 1)
        guard minuteDigits.count == 2 else { return nil }
        minute = minuteDigits.value
        hasMinutes = true
        i += 3
    }
    let rest = chars[i...]
    if isMeridiem(rest) {
        if hour < 1 || hour > 12 || minute > 59 { return nil }
        return TimeOfDay(h: (hour % 12) + (String(rest) == "pm" ? 12 : 0), mi: minute)
    }
    if hasMinutes, rest.isEmpty {
        if hour > 23 || minute > 59 { return nil }
        return TimeOfDay(h: hour, mi: minute)
    }
    return nil
}

/// "at 9": the hour alone, read the way a trade day is read.
private func parseBareHour(_ low: String) -> TimeOfDay? {
    let chars = Array(low)
    let digits = leadingDigits(chars)
    guard digits.count >= 1, digits.count <= 2, digits.count == chars.count else { return nil }
    let hour = digits.value
    if hour < 1 || hour > 23 { return nil }
    if hour >= 13 { return TimeOfDay(h: hour, mi: 0) }
    if hour == 12 { return TimeOfDay(h: 12, mi: 0) }
    return TimeOfDay(h: hour <= 6 ? hour + 12 : hour, mi: 0)
}

/// "12", "3rd": a day of the month, 1 to 31.
private func ordinalDay(_ low: String) -> Int? {
    let chars = Array(low)
    let digits = leadingDigits(chars)
    guard digits.count >= 1, digits.count <= 2 else { return nil }
    let suffix = String(chars[digits.count...])
    guard suffix.isEmpty || suffix == "st" || suffix == "nd" || suffix == "rd" || suffix == "th" else {
        return nil
    }
    return digits.value >= 1 && digits.value <= 31 ? digits.value : nil
}

/// "2026-11-12": four digits, two, two, with hyphens between.
private func parseIsoDate(_ low: String) -> (y: Int, m: Int, d: Int)? {
    let chars = Array(low)
    guard chars.count == 10, chars[4] == "-", chars[7] == "-" else { return nil }
    for (index, c) in chars.enumerated() where index != 4 && index != 7 && !isDigit(c) {
        return nil
    }
    let y = leadingDigits(chars, from: 0).value
    let m = leadingDigits(Array(chars[5 ..< 7])).value
    let d = leadingDigits(Array(chars[8 ..< 10])).value
    return (y, m, d)
}

private enum DateHit {
    case civil(Civil, words: Int)
    case instant(Int, words: Int)
    case tonight(Civil, words: Int)

    var words: Int {
        switch self {
        case let .civil(_, words), let .instant(_, words), let .tonight(_, words):
            return words
        }
    }
}

/// The date phrase that starts at `i`, if any.
private func dateAt(_ words: [Word], _ i: Int, today: WallClock, now: Int) -> DateHit? {
    let w = words[i].low
    func next(_ offset: Int) -> String? {
        i + offset < words.count ? words[i + offset].low : nil
    }
    let todayCivil = today.civil

    if w == "today" { return .civil(todayCivil, words: 1) }
    if w == "tomorrow" || w == "tmrw" || w == "tmr" {
        return .civil(addDays(todayCivil, 1), words: 1)
    }
    if w == "tonight" { return .tonight(todayCivil, words: 1) }

    if w == "next", next(1) == "week" {
        let toMonday = ((8 - today.weekday) % 7) == 0 ? 7 : (8 - today.weekday) % 7
        return .civil(addDays(todayCivil, toMonday), words: 2)
    }
    if w == "next" || w == "this", let nextWord = next(1), let target = weekdays[nextWord] {
        if w == "this" {
            let raw = (target - today.weekday + 7) % 7
            return .civil(addDays(todayCivil, raw == 0 ? 7 : raw), words: 2)
        }
        let rawMonday = (8 - today.weekday) % 7
        let toMonday = rawMonday == 0 ? 7 : rawMonday
        let fromMonday = (target + 6) % 7
        return .civil(addDays(todayCivil, toMonday + fromMonday), words: 2)
    }
    if let target = weekdays[w] {
        let raw = (target - today.weekday + 7) % 7
        return .civil(addDays(todayCivil, raw == 0 ? 7 : raw), words: 1)
    }

    if w == "in", let amountWord = next(1), let unit = next(2) {
        let amountChars = Array(amountWord)
        let amount = leadingDigits(amountChars)
        if amount.count >= 1, amount.count <= 3, amount.count == amountChars.count, amount.value >= 1 {
            let n = amount.value
            if ["minute", "minutes", "min", "mins"].contains(unit) {
                return .instant(now + n * 60_000, words: 3)
            }
            if ["hour", "hours", "hr", "hrs"].contains(unit) {
                return .instant(now + n * 3_600_000, words: 3)
            }
            if ["day", "days"].contains(unit) {
                return .civil(addDays(todayCivil, n), words: 3)
            }
            if ["week", "weeks"].contains(unit) {
                return .civil(addDays(todayCivil, n * 7), words: 3)
            }
        }
    }

    if let iso = parseIsoDate(w) {
        if iso.m >= 1, iso.m <= 12, iso.d >= 1, iso.d <= daysInMonth(iso.y, iso.m) {
            return .civil(Civil(y: iso.y, m: iso.m, d: iso.d), words: 1)
        }
        return nil
    }

    // "nov 12" and "12 nov": the next such date on or after today.
    if let month = months[w], let after = next(1), let day = ordinalDay(after) {
        guard let civil = nextOccurrence(month, day, todayCivil) else { return nil }
        return .civil(civil, words: 2)
    }
    if let day = ordinalDay(w), let after = next(1), let month = months[after] {
        guard let civil = nextOccurrence(month, day, todayCivil) else { return nil }
        return .civil(civil, words: 2)
    }
    return nil
}

/// The next time this month and day come round, today included; nil when no year has it.
private func nextOccurrence(_ month: Int, _ day: Int, _ today: Civil) -> Civil? {
    for year in today.y ... (today.y + 4) {
        if day > daysInMonth(year, month) { continue }
        let candidate = Civil(y: year, m: month, d: day)
        if civilKey(candidate) >= civilKey(today) { return candidate }
    }
    return nil
}

/// A tag that is a reference (`t-142`, `contact-1a2b3c4d`, `conv-1a2b3c4d`),
/// never a label. `tag` is already lower case.
private func isReferenceTag(_ tag: String) -> Bool {
    let chars = Array(tag)
    func hex8(_ from: Int) -> Bool {
        guard chars.count == from + 8 else { return false }
        for c in chars[from...] {
            guard let v = c.asciiValue, (v >= 48 && v <= 57) || (v >= 97 && v <= 102) else {
                return false
            }
        }
        return true
    }
    if tag.hasPrefix("t-") {
        let digits = leadingDigits(chars, from: 2)
        return digits.count >= 1 && digits.count <= 9 && 2 + digits.count == chars.count
    }
    if tag.hasPrefix("contact-") { return hex8(8) }
    if tag.hasPrefix("conv-") { return hex8(5) }
    return false
}

private func nameParts(_ member: QuickAddMember) -> [String] {
    member.name.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
}

/// The one member the query names, or nil when it names none or several.
private func matchMember(_ members: [QuickAddMember], _ query: String) -> QuickAddMember? {
    let q = stripTail(query)
    if q.isEmpty { return nil }
    let exactFirst = members.filter { nameParts($0).first == q }
    if exactFirst.count == 1 { return exactFirst[0] }
    let starts = members.filter { member in nameParts(member).contains { $0.hasPrefix(q) } }
    if starts.count == 1 { return starts[0] }
    let whole = members.filter { member in
        nameParts(member).joined().hasPrefix(q)
    }
    return whole.count == 1 ? whole[0] : nil
}

// MARK: - The parse

func parseQuickAdd(_ line: String, _ ctx: QuickAddContext) -> QuickAddResult {
    let words = toWords(line)
    let now = millis(of: ctx.now)
    let today = wallClock(now, ctx.timeZone)

    var kept: [String?] = words.map { Optional($0.raw) }
    var understood: [QuickAddUnderstood] = []
    var ignored: [String] = []
    var labels: [QuickAddLabel] = []
    var assignee: QuickAddMember?
    var priority: QuickAddPriority?

    var dateHit: DateHit?
    var dateText = ""
    var clock: TimeOfDay?
    var clockText = ""

    func take(_ from: Int, _ count: Int) -> String {
        let text = words[from ..< (from + count)].map { $0.raw }.joined(separator: " ")
        for k in from ..< (from + count) { kept[k] = nil }
        return text
    }

    var i = 0
    while i < words.count {
        let word = words[i]
        let low = word.low

        if low.hasPrefix("@"), low.count > 1 {
            let query = String(low.dropFirst())
            let found: QuickAddMember?
            if query == "me" {
                found = ctx.members.first { $0.userId == ctx.selfUserId }
            } else {
                found = matchMember(ctx.members, query)
            }
            if let found, assignee == nil {
                assignee = found
                understood.append(QuickAddUnderstood(kind: "assignee", text: take(i, 1)))
            } else if found == nil {
                ignored.append(word.raw)
            }
            i += 1
            continue
        }

        if low.hasPrefix("#"), low.count > 1 {
            let tag = String(low.dropFirst())
            if isReferenceTag(tag) {
                i += 1
                continue
            }
            if let value = priorityWords[tag] {
                if priority == nil {
                    priority = value
                    understood.append(QuickAddUnderstood(kind: "priority", text: take(i, 1)))
                }
                i += 1
                continue
            }
            if let label = ctx.labels.first(where: { $0.name.lowercased() == tag }) {
                if !labels.contains(where: { $0.id == label.id }) {
                    labels.append(label)
                    understood.append(QuickAddUnderstood(kind: "label", text: take(i, 1)))
                } else {
                    _ = take(i, 1)
                }
            } else {
                ignored.append(word.raw)
            }
            i += 1
            continue
        }

        if dateHit == nil, let hit = dateAt(words, i, today: today, now: now) {
            dateHit = hit
            dateText = take(i, hit.words)
            i += hit.words
            continue
        }

        if clock == nil {
            var found = parseClockWord(low)
            var consumed = 1
            if found == nil, low == "at", i + 1 < words.count {
                found = parseClockWord(words[i + 1].low) ?? parseBareHour(words[i + 1].low)
                consumed = 2
            }
            if let found {
                clock = found
                clockText = take(i, consumed)
                i += consumed
                continue
            }
        }
        i += 1
    }

    var dueAt: String?
    var dueHasTime = false
    if dateHit != nil || clock != nil {
        var instant: Int
        switch dateHit {
        case let .instant(value, _):
            instant = value
            dueHasTime = true
            if let clock {
                let w = wallClock(instant, ctx.timeZone)
                instant = zonedToInstant(w.civil, clock, ctx.timeZone)
            }
        case let .civil(civil, _):
            if let clock {
                instant = zonedToInstant(civil, clock, ctx.timeZone)
                dueHasTime = true
            } else {
                instant = zonedToInstant(civil, TimeOfDay(h: defaultHour, mi: 0), ctx.timeZone)
                if civilKey(civil) == civilKey(today.civil), instant <= now {
                    instant = zonedToInstant(civil, TimeOfDay(h: afternoonHour, mi: 0), ctx.timeZone)
                }
            }
        case let .tonight(civil, _):
            if let clock {
                instant = zonedToInstant(civil, clock, ctx.timeZone)
            } else {
                instant = zonedToInstant(civil, TimeOfDay(h: tonightHour, mi: 0), ctx.timeZone)
            }
            dueHasTime = true
        case nil:
            let at = clock ?? TimeOfDay(h: defaultHour, mi: 0)
            instant = zonedToInstant(today.civil, at, ctx.timeZone)
            if instant <= now {
                instant = zonedToInstant(addDays(today.civil, 1), at, ctx.timeZone)
            }
            dueHasTime = true
        }
        dueAt = isoString(instant)
        understood.append(
            QuickAddUnderstood(
                kind: "due",
                text: [dateText, clockText].filter { !$0.isEmpty }.joined(separator: " ")
            )
        )
    }

    let title = kept.compactMap { $0 }.joined(separator: " ")
    return QuickAddResult(
        title: title,
        assignee: assignee,
        dueAt: dueAt,
        dueHasTime: dueHasTime,
        priority: priority,
        labels: labels,
        understood: understood,
        ignored: ignored
    )
}
