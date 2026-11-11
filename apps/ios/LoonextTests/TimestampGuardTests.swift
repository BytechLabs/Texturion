import XCTest

/// #720: every date the app shows goes through `TimestampFormat`.
///
/// Each screen drew its own date with a `DateFormatter`, so one moment read "Sep 9" on
/// one screen and "9:42 AM" on the next, and none could be long-pressed for the exact
/// time. This fails on a direct date format anywhere outside the formatter, unless the
/// ROSTER below says why: a calendar day with no time of day, a machine format, or a
/// sentence shape the other clients pin.
///
/// T-0  the scan read source files and found the calls it is about.
/// T-1  no unlisted file formats a date itself.
/// T-2  the roster is closed: an entry whose file no longer makes that call fails.
/// T-3  every entry gives a reason.
final class TimestampGuardTests: XCTestCase {
    private struct Entry {
        let file: String
        let call: String
        let reason: String
    }

    private struct Rule {
        let call: String
        let pattern: String
    }

    private static let formatterFiles: Set<String> = ["Core/Format/TimestampFormat.swift"]

    private static let rules: [Rule] = [
        Rule(call: "DateFormatter(", pattern: #"\bDateFormatter\("#),
        Rule(call: "RelativeDateTimeFormatter", pattern: #"\bRelativeDateTimeFormatter\b"#),
        Rule(call: "DateComponentsFormatter", pattern: #"\bDateComponentsFormatter\b"#),
        Rule(
            call: "formatted(date",
            pattern: #"\.formatted\(\s*(?:date:|\.dateTime|\.relative|\.iso8601)"#
        ),
        Rule(
            call: "Text(date, style:",
            pattern: #"Text\([^\n]*style:\s*\.(?:date|time|relative|offset|timer)\b"#
        ),
        Rule(
            call: "setLocalizedDateFormatFromTemplate",
            pattern: #"\.setLocalizedDateFormatFromTemplate\("#
        ),
    ]

    private static let roster: [Entry] = [
        Entry(file: "Core/Diagnostics/DiagnosticsLog.swift", call: "DateFormatter(", reason: "A UTC stamp on a diagnostics line a developer reads, not a date a person is shown."),
        Entry(file: "Core/Model/ContactTimeline.swift", call: "DateFormatter(", reason: "The day heading that groups the contact timeline: a calendar day, never a time."),
        Entry(file: "Core/Model/ContactTimeline.swift", call: "formatted(date", reason: "The ISO day key of a timeline group; a machine format."),
        Entry(file: "Core/Model/ContactTimeline.swift", call: "setLocalizedDateFormatFromTemplate", reason: "The day heading that groups the contact timeline: a calendar day, never a time."),
        Entry(file: "Core/OnCall.swift", call: "DateFormatter(", reason: "The wire format of an instant sent to the API."),
        Entry(file: "Core/SnoozeLogic.swift", call: "DateFormatter(", reason: "The snooze return sentence shapes are pinned to the shared snoozeReturnShape and the other clients."),
        Entry(file: "Features/Contacts/ContactDetailView.swift", call: "DateFormatter(", reason: "Record lines say \"Added by Sam on {date}\" and the call list is grouped under day headings: calendar days, never times."),
        Entry(file: "Features/Contacts/ContactsData.swift", call: "DateFormatter(", reason: "The consent line says \"Consent · {date}\": a calendar day inside a sentence."),
        Entry(file: "Features/Settings/BillingSection.swift", call: "DateFormatter(", reason: "Billing period ends and renewal days: calendar days with no time of day."),
        Entry(file: "Features/Settings/BillingSection.swift", call: "setLocalizedDateFormatFromTemplate", reason: "Billing period ends and renewal days: calendar days with no time of day."),
        Entry(file: "Features/Settings/UsageExportCard.swift", call: "DateFormatter(", reason: "The UTC range sent to the export endpoint; a machine format."),
        Entry(file: "Features/Settings/UsageSection.swift", call: "DateFormatter(", reason: "Billing-period bounds and month names on the history bars: calendar days and months."),
        Entry(file: "Features/Tasks/TaskCalendarView.swift", call: "DateFormatter(", reason: "Calendar grid: month title, day numbers, day headings and day keys, not timestamps."),
        Entry(file: "Features/Tasks/TaskRepeatDraft.swift", call: "DateFormatter(", reason: "Parses and writes the yyyy-MM-dd day a repeat rule ends on; a machine format."),
        Entry(file: "Features/Thread/Timeline.swift", call: "DateFormatter(", reason: "The day divider in a thread and its yyyy-MM-dd key: a calendar day, never a time."),
        Entry(file: "Support/Format.swift", call: "DateFormatter(", reason: "Parses an offset-less wire timestamp; a machine format."),
    ]

    private static func stripComments(_ text: String) -> String {
        var out = text
        for pattern in [#"/\*[\s\S]*?\*/"#, #"(^|\s)//[^\n]*"#] {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(out.startIndex..., in: out)
            out = regex.stringByReplacingMatches(in: out, range: range, withTemplate: "$1")
        }
        return out
    }

    /// #238: a compact time ("5m") drawn as plain text is read by VoiceOver as "5 m". Every
    /// compact time a screen draws needs its spoken twin: `timedText { time in ... time(iso) }`
    /// with `.spokenAs`, or `.exactTime(iso)` on a lone `relativeTime`. A file may draw no
    /// more compact times than it speaks, unless the file only DEFINES those helpers or
    /// builds a sentence in pure model code (below). LONG labels name the day and the
    /// clock, and are not counted.
    ///
    /// T-4  the compact-time scan found the calls it is about.
    /// T-5  no unlisted file draws a compact time it does not speak.
    /// T-6  the compact roster is closed and gives a reason for each file.
    private static let compactRoster: [String: String] = [
        "Support/Format.swift": "Defines relativeTime, formatDue and timedDue, which draw the compact label and build its spoken twin.",
        "Support/Timestamp.swift": "Defines timedText, whose default label is relativeTime, and speaks it with its spoken twin.",
        "Core/Model/ContactTimeline.swift": "A due date inside a timeline sentence built in pure model code, with no view to label; it is a day or a clock ahead of now.",
    ]

    private static let compactCalls = [#"(?<!func )\brelativeTime\("#, #"(?<!func )\bformatDue\("#]
    private static let labelCall = #"TimestampFormat\.label\("#
    private static let spokenCalls = [#"\.exactTime\("#, #"\.spokenAs\("#]

    private static func count(_ pattern: String, in text: String) -> Int {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return 0 }
        return regex.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text))
    }

    /// Compact draws in `text`: relativeTime, formatDue, and a TimestampFormat.label that is
    /// not LONG (a `.long` in the 220 characters after the call counts as LONG).
    private static func compactDraws(_ text: String) -> Int {
        var total = compactCalls.reduce(0) { $0 + count($1, in: text) }
        guard let regex = try? NSRegularExpression(pattern: labelCall) else { return total }
        let whole = NSRange(text.startIndex..., in: text)
        for match in regex.matches(in: text, range: whole) {
            let window = (text as NSString).substring(
                with: NSRange(
                    location: match.range.location,
                    length: min(220, whole.length - match.range.location)
                )
            )
            if !window.contains(".long") { total += 1 }
        }
        return total
    }

    private struct Scan {
        let fileCount: Int
        let hits: [(file: String, call: String)]
        let compact: [(file: String, draws: Int, spoken: Int)]
    }

    private func scan() throws -> Scan {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var root: URL?
        while dir.path != "/" {
            let candidate = dir.appendingPathComponent("Loonext")
            if FileManager.default.fileExists(
                atPath: candidate.appendingPathComponent("Support").path
            ) {
                root = candidate
                break
            }
            dir = dir.deletingLastPathComponent()
        }
        let base = try XCTUnwrap(root, "the Loonext source folder was not found")
        let walker = try XCTUnwrap(
            FileManager.default.enumerator(at: base, includingPropertiesForKeys: nil)
        )
        var count = 0
        var hits: [(file: String, call: String)] = []
        var compact: [(file: String, draws: Int, spoken: Int)] = []
        for case let url as URL in walker where url.pathExtension == "swift" {
            let relative = String(url.path.dropFirst(base.path.count + 1))
            if Self.formatterFiles.contains(relative) { continue }
            let text = Self.stripComments(try String(contentsOf: url, encoding: .utf8))
            count += 1
            let draws = Self.compactDraws(text)
            if draws > 0 {
                let spoken = Self.spokenCalls.reduce(0) { $0 + Self.count($1, in: text) }
                compact.append((relative, draws, spoken))
            }
            for rule in Self.rules {
                guard let regex = try? NSRegularExpression(pattern: rule.pattern) else {
                    XCTFail("bad pattern for \(rule.call)")
                    continue
                }
                if regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil {
                    hits.append((relative, rule.call))
                }
            }
        }
        return Scan(fileCount: count, hits: hits, compact: compact)
    }

    func testT0TheScanReadSourcesAndFoundTheCallsItIsAbout() throws {
        let scan = try scan()
        XCTAssertGreaterThan(scan.fileCount, 0, "the scan read no source files")
        XCTAssertGreaterThan(scan.hits.count, 0, "no date calls found in \(scan.fileCount) files")
    }

    func testT1NoDateIsDrawnOutsideTheFormatterUnlessTheRosterSaysWhy() throws {
        let scan = try scan()
        let unlisted = scan.hits
            .filter { hit in !Self.roster.contains { $0.file == hit.file && $0.call == hit.call } }
            .map { "\($0.file)  \($0.call)" }
        XCTAssertEqual(
            unlisted,
            [],
            "Scanned \(scan.fileCount) files. These draw a date or time themselves. Use "
                + "relativeTime(iso) with .exactTime(iso) in a view, or TimestampFormat.label / "
                + "clock / exact in a sentence; a calendar day with no time of day may go on "
                + "the ROSTER:\n" + unlisted.joined(separator: "\n")
        )
    }

    func testT2TheRosterExcusesCodeThatStillExists() throws {
        let scan = try scan()
        let stale = Self.roster
            .filter { entry in !scan.hits.contains { $0.file == entry.file && $0.call == entry.call } }
            .map { "\($0.file)  \($0.call)" }
        XCTAssertEqual(stale, [], "These roster entries no longer match a call. Delete them.")
    }

    func testT3EveryRosterEntryGivesAReason() {
        let thin = Self.roster
            .filter { $0.reason.trimmingCharacters(in: .whitespaces).count < 15 }
            .map(\.file)
        XCTAssertEqual(thin, [])
    }

    func testT4TheCompactTimeScanFoundTheCallsItIsAbout() throws {
        let scan = try scan()
        XCTAssertGreaterThan(scan.fileCount, 0, "the compact scan read no source files")
        XCTAssertGreaterThan(scan.compact.count, 0, "no compact times found in \(scan.fileCount) files")
    }

    func testT5ACompactTimeDrawnAsPlainTextHasItsSpokenTwin() throws {
        let scan = try scan()
        let unspoken = scan.compact
            .filter { Self.compactRoster[$0.file] == nil && $0.draws > $0.spoken }
            .map { "\($0.file)  draws \($0.draws) compact time(s), speaks \($0.spoken)" }
        XCTAssertEqual(
            unspoken,
            [],
            "Scanned \(scan.fileCount) files, \(scan.compact.count) draw compact times. A compact "
                + "time reads as \"5 m\" aloud. Build the line with timedText { time in ... } and "
                + ".spokenAs, or add .exactTime(iso) to a lone relativeTime:\n"
                + unspoken.joined(separator: "\n")
        )
    }

    func testT6TheCompactRosterExcusesFilesThatStillDrawCompactTimes() throws {
        let scan = try scan()
        let stale = Self.compactRoster.keys
            .filter { file in !scan.compact.contains { $0.file == file } }
            .sorted()
        XCTAssertEqual(stale, [], "These compact roster entries no longer draw one. Delete them.")
        let thin = Self.compactRoster
            .filter { $0.value.trimmingCharacters(in: .whitespaces).count < 15 }
            .map(\.key)
        XCTAssertEqual(thin, [])
    }
}
