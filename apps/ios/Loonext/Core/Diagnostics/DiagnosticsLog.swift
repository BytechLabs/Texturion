import Foundation

/// #337 — the recent-client-events ring iOS never had.
///
/// Android has `CallFlowLog` and `CrashReportStore`; iOS had nothing, on the
/// platform where it matters most. Swift compiles only in Mobile CI, so an iOS
/// bug's whole life is: it happens on somebody's device, and nobody can see it
/// until a person describes it in prose. This is the shortest available path
/// from "something is wrong" to "here is what the client actually did".
///
/// DELIBERATELY SMALL. Not a logging framework, not telemetry, and nothing is
/// ever sent anywhere on its own — it is a bounded ring a person can read on
/// screen and choose to share. Everything about it is local until somebody taps
/// share.
///
/// THE PRIVACY RULE IS STRUCTURAL, NOT ADVISORY. SPEC §10 says message bodies,
/// names, addresses and phone numbers never reach telemetry, and this screen is
/// something a customer may screenshot and send us. So the API is `event` +
/// optional `detail`, both documented as SHORT CODES, and `record` truncates
/// hard. Call sites pass an error CODE and an HTTP status, never a message —
/// our own copy can quote a customer's number back ("+1… has opted out"), so
/// "our strings are safe" is not true enough to rely on.
///
/// PERSISTED, because the events worth reading are usually the ones just before
/// a relaunch. Same reasoning as #197 on Android: a report that evaporates when
/// the app restarts is a report nobody ever sends.
enum DiagnosticsCategory: String, Codable, CaseIterable, Sendable {
    case api
    case realtime
    case push
    case sync
}

struct DiagnosticsEntry: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    let at: Date
    let category: DiagnosticsCategory
    /// A short code naming what happened: "request_failed", "socket_closed".
    let event: String
    /// A short code qualifying it: "not_found 404", "no_token". Never content.
    let detail: String?

    init(
        id: UUID = UUID(),
        at: Date = Date(),
        category: DiagnosticsCategory,
        event: String,
        detail: String? = nil
    ) {
        self.id = id
        self.at = at
        self.category = category
        self.event = event
        self.detail = detail
    }
}

enum DiagnosticsLog {
    /// How many events are kept. Small on purpose: the useful window is the last
    /// few minutes before somebody noticed, and an unbounded ring in
    /// UserDefaults is its own bug.
    static let capacity = 120

    /// Hard ceiling per field. A caller that passes something long is passing
    /// something it should not, and this is where that stops being a leak.
    static let maxFieldLength = 80

    private static let storageKey = "diagnostics_log_v1"
    private static let lock = NSLock()

    /// Append one event. Safe to call from any thread and from any context —
    /// including a failure path that is already unhappy, which is why nothing
    /// here can throw.
    static func record(
        _ category: DiagnosticsCategory,
        _ event: String,
        detail: String? = nil
    ) {
        let entry = DiagnosticsEntry(
            category: category,
            event: clamp(event),
            detail: detail.map(clamp)
        )
        lock.lock()
        defer { lock.unlock() }
        var all = loadLocked()
        all.append(entry)
        if all.count > capacity {
            all.removeFirst(all.count - capacity)
        }
        saveLocked(all)
    }

    /// Newest first, which is the order somebody reading a bug report wants.
    static func entries() -> [DiagnosticsEntry] {
        lock.lock()
        defer { lock.unlock() }
        return loadLocked().reversed()
    }

    /// #253 — the last few failures, formatted for a support email.
    ///
    /// Capped at `reportedLines` because some mail clients truncate a mailto
    /// body around 2000 characters, and a truncated body carries NO diagnostics
    /// rather than fewer. Six is what a person needed anyway: the failure that
    /// made them write in is always at the top.
    ///
    /// Safe to put in an email by construction — every entry is already an
    /// event code plus a short detail, never content. That is the whole reason
    /// this ring's API refuses message text (see the type comment above).
    static func recentLines(limit: Int = reportedLines) -> [String] {
        entries().prefix(limit).map { entry in
            let clock = clockFormatter.string(from: entry.at)
            let detail = entry.detail.map { " \($0)" } ?? ""
            return "\(clock) \(entry.category.rawValue) \(entry.event)\(detail)"
        }
    }

    /// Mirror of SUPPORT_ERROR_LINES in packages/shared.
    static let reportedLines = 6

    private static let clockFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }()

    static func clear() {
        lock.lock()
        defer { lock.unlock() }
        UserDefaults.standard.removeObject(forKey: storageKey)
    }

    // MARK: - Storage

    private static func loadLocked() -> [DiagnosticsEntry] {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else { return [] }
        // A decode failure means a format change or a corrupt blob. Dropping the
        // ring is the right answer: this is diagnostics, and refusing to record
        // anything ever again because of one bad byte would be the worse bug.
        return (try? JSONDecoder().decode([DiagnosticsEntry].self, from: data)) ?? []
    }

    private static func saveLocked(_ entries: [DiagnosticsEntry]) {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }

    /// Collapse whitespace and cut to the ceiling. Whitespace collapsing is not
    /// cosmetic: a multi-line value would break the one-event-per-line shape the
    /// shared report depends on.
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

/// #337 — whether the Diagnostics row is visible, matching Android's `devMode`.
///
/// A hidden surface rather than a hidden BUILD, for the same reason Android
/// chose the easter egg (#198): the people who need diagnostics are on the
/// release build, in a truck, describing a symptom down a phone. A debug-only
/// screen is a screen that is never there when it is wanted.
///
/// Seven quick taps on the version footer, silent while counting, and the same
/// two sentences on either platform so one set of instructions works for both.
enum DiagnosticsAccess {
    private static let key = "diagnostics_unlocked"

    /// Taps needed, and the window between them. Both match Android exactly —
    /// a founder saying "tap the version seven times quickly" has to be true on
    /// whichever phone the person is holding.
    static let tapsToUnlock = 7
    static let tapWindow: TimeInterval = 2

    static var isUnlocked: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// The snackbar copy, verbatim from Android's `SettingsHome.kt`.
    static func message(unlocked: Bool) -> String {
        unlocked ? "Diagnostics unlocked" : "Diagnostics hidden"
    }
}
