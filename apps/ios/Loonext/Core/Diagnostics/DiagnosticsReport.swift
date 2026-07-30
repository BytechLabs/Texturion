import Foundation

/// #337 — the device state a bug report always needs, assembled once.
///
/// Deliberately NOT built inside the diagnostics view. #337's acceptance asks
/// that the output "shares a payload with #253's support reporting", and #253
/// is not built yet — so the seam has to exist before the second consumer does,
/// or the second consumer will assemble device context a second, slightly
/// different way. That is how the same claim ends up written twice (#437).
///
/// Everything here is a fact about the BUILD or the CLIENT'S OWN STATE. There is
/// no customer content, and there is nothing that could become customer content
/// later: the entries come from `DiagnosticsLog`, whose fields are short codes
/// by construction.
struct DiagnosticsSnapshot: Equatable, Sendable {
    var appVersion: String
    var build: String
    var systemVersion: String
    var deviceModel: String
    /// Whether a push token has been handed to the server.
    var pushRegistered: Bool
    /// Whether the user has granted notification authorization.
    var notificationsAllowed: Bool
    /// The realtime socket's own account of itself.
    var realtimeState: String
    /// The workspace this session is looking at. An identifier, never a name —
    /// a workspace name is a real business's name.
    var companyId: String?

    /// The lines the screen renders and the report prints, in one order so the
    /// two cannot drift apart.
    var rows: [(label: String, value: String)] {
        [
            ("App version", build.isEmpty ? appVersion : "\(appVersion) (\(build))"),
            ("iOS", systemVersion),
            ("Device", deviceModel),
            ("Push token", pushRegistered ? "Registered" : "Not registered"),
            ("Notifications", notificationsAllowed ? "Allowed" : "Blocked"),
            ("Realtime", realtimeState),
            ("Workspace", companyId ?? "None"),
        ]
    }
}

enum DiagnosticsReport {
    /// One plain-text bundle: the device facts, then the event ring.
    ///
    /// Plain text rather than JSON because the destination is a human — pasted
    /// into an email or a message to us. A support reply nobody can read at a
    /// glance is a support reply that gets ignored.
    static func text(
        snapshot: DiagnosticsSnapshot,
        entries: [DiagnosticsEntry],
        now: Date = Date()
    ) -> String {
        var out = "Loonext iOS diagnostics\n"
        out += "captured=\(stamp(now))\n\n"
        for row in snapshot.rows {
            out += "\(row.label): \(row.value)\n"
        }
        out += "\n=== RECENT EVENTS (\(entries.count)) ===\n"
        if entries.isEmpty {
            out += "(none)\n"
        } else {
            for entry in entries {
                out += line(entry) + "\n"
            }
        }
        return out
    }

    /// One event, one line: time, category, event, detail.
    static func line(_ entry: DiagnosticsEntry) -> String {
        let base = "\(stamp(entry.at))  \(entry.category.rawValue)  \(entry.event)"
        guard let detail = entry.detail, !detail.isEmpty else { return base }
        return "\(base)  \(detail)"
    }

    /// ISO 8601, via the format STYLE rather than a cached `ISO8601DateFormatter`.
    ///
    /// A `static let` formatter is the obvious shape and does not compile under
    /// Swift 6: `ISO8601DateFormatter` is not `Sendable`, so a shared static one
    /// is exactly the "global with shared mutable state" the language now
    /// rejects. The format style is a value, so there is nothing to share.
    private static func stamp(_ date: Date) -> String {
        date.formatted(.iso8601)
    }
}
