import Foundation

/// #239 — how a response time READS. Hand-port of
/// `packages/shared/src/response-time.ts`; `ResponseTimeFormatTests` carries the
/// same table of cases as the TS and Kotlin suites.
///
/// This number is the product's whole retention argument and the customer is
/// meant to repeat it to other contractors. It has to say the same thing on the
/// phone as on the laptop, or a crew comparing two screens learns not to trust
/// either.
enum ResponseTimeFormat {

    /// A change of under a minute is not a story — it is the same performance
    /// measured twice, and dressing it up as progress is how a metric earns a
    /// reputation for flattery.
    static let arcMinSeconds: Double = 60

    /// Rounded, coarse, and honest: the largest unit that still tells the truth.
    static func format(_ seconds: Double?) -> String {
        // No median is a real state — a window with no answered lead. Refuse to
        // invent a zero; "0 sec" would read as instant service for a workspace
        // that answered nothing.
        guard let seconds, seconds.isFinite else { return "—" }
        let total = Int(max(0, seconds).rounded())

        // Under a minute keeps its precision: it is the number worth bragging
        // about, and "under a minute" would round away the difference between a
        // fifty-second reply and a five-second one.
        if total < 60 { return "\(total) sec" }

        // ROUNDING CARRIES. A rounded remainder can reach a whole unit of the
        // next size up: 3,599 seconds rounds to 60 minutes and 86,399 to 24
        // hours. Without the carry those print as "60 min" and "23 hr 60 min".
        var minutes = Int((Double(total) / 60).rounded())
        var hours = 0
        var days = 0
        if minutes >= 60 {
            hours = minutes / 60
            minutes -= hours * 60
        }
        if hours >= 24 {
            days = hours / 24
            hours -= days * 24
        }

        if days > 0 {
            let rounded = hours >= 12 ? days + 1 : days
            return rounded == 1 ? "1 day" : "\(rounded) days"
        }
        if hours > 0 {
            if minutes == 0 { return hours == 1 ? "1 hr" : "\(hours) hr" }
            return "\(hours) hr \(minutes) min"
        }
        return minutes == 1 ? "1 min" : "\(minutes) min"
    }

    /// Which way the arc goes, or nil when there is no arc worth drawing.
    static func arcDirection(_ improvedBySeconds: Double?) -> String? {
        guard let improvedBySeconds, improvedBySeconds.isFinite else { return nil }
        if abs(improvedBySeconds) < arcMinSeconds { return nil }
        // Including the wrong direction. A metric that only ever reports
        // improvement is one nobody believes.
        return improvedBySeconds > 0 ? "faster" : "slower"
    }
}
