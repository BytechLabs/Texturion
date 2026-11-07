import Foundation

/// #337, #253: the last few things that went wrong on this device, for the
/// support email.
///
/// In memory only (D147), matching Android's `RecentErrors` and the web ring:
/// it empties with the process, and its one reader is the support mailto a
/// person chooses to send.
///
/// THE PRIVACY RULE IS STRUCTURAL, NOT ADVISORY. SPEC §10 says message bodies,
/// names, addresses and phone numbers never reach telemetry, and these lines
/// ride into an email. So the API is `event` + optional `detail`, both
/// documented as SHORT CODES, and `record` truncates hard. Call sites pass an
/// error CODE and an HTTP status, never a message: our own copy can quote a
/// customer's number back ("+1… has opted out"), so "our strings are safe" is
/// not true enough to rely on.
enum DiagnosticsCategory: String, Sendable {
    case api
    case realtime
    case push
    case sync
}

struct DiagnosticsEntry: Equatable, Sendable {
    let at: Date
    let category: DiagnosticsCategory
    /// A short code naming what happened: "request_failed", "socket_closed".
    let event: String
    /// A short code qualifying it: "not_found 404", "no_token". Never content.
    let detail: String?
}

enum DiagnosticsLog {
    /// Headroom over `reportedLines`; more would never be sent.
    static let capacity = 12

    /// Mirror of SUPPORT_ERROR_LINES in packages/shared.
    static let reportedLines = 6

    /// Hard ceiling per field. A caller that passes something long is passing
    /// something it should not, and this is where that stops being a leak.
    static let maxFieldLength = 80

    private static let lock = NSLock()
    private nonisolated(unsafe) static var ring: [DiagnosticsEntry] = []

    /// Append one event. Safe to call from any thread and from any context,
    /// including a failure path that is already unhappy, which is why nothing
    /// here can throw.
    static func record(
        _ category: DiagnosticsCategory,
        _ event: String,
        detail: String? = nil
    ) {
        let entry = DiagnosticsEntry(
            at: Date(),
            category: category,
            event: clamp(event),
            detail: detail.map(clamp)
        )
        lock.lock()
        defer { lock.unlock() }
        ring.append(entry)
        if ring.count > capacity {
            ring.removeFirst(ring.count - capacity)
        }
    }

    /// Newest first, which is the order somebody reading a bug report wants.
    static func entries() -> [DiagnosticsEntry] {
        lock.lock()
        defer { lock.unlock() }
        return ring.reversed()
    }

    /// The last few failures, formatted for a support email.
    ///
    /// Capped at `reportedLines` because some mail clients truncate a mailto
    /// body around 2000 characters, and a truncated body carries NO diagnostics
    /// rather than fewer. Six is what a person needed anyway: the failure that
    /// made them write in is always at the top.
    static func recentLines(limit: Int = reportedLines) -> [String] {
        entries().prefix(limit).map { entry in
            let clock = clockFormatter.string(from: entry.at)
            let detail = entry.detail.map { " \($0)" } ?? ""
            return "\(clock) \(entry.category.rawValue) \(entry.event)\(detail)"
        }
    }

    /// Tests only: the app never empties the ring before the process ends.
    static func clear() {
        lock.lock()
        defer { lock.unlock() }
        ring.removeAll()
    }

    private static let clockFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }()

    /// Collapse whitespace and cut to the ceiling. Whitespace collapsing is not
    /// cosmetic: a multi-line value would break the one-event-per-line shape the
    /// support email depends on.
    private static func clamp(_ value: String) -> String {
        let collapsed = value
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return collapsed.count <= maxFieldLength
            ? collapsed
            : String(collapsed.prefix(maxFieldLength - 1)) + "\u{2026}"
    }
}
