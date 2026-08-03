import Foundation

/// #313 — how a rating READS. Hand-port of `packages/shared/src/satisfaction.ts`;
/// `SatisfactionFormatTests` carries the same cases as the TS and Kotlin suites.
///
/// The refusals matter more than the arithmetic. An average of three answers is
/// noise, and #313 is explicit about the cost: "in a small crew, a bad month for
/// one tech is noise, and treating it as data damages trust faster than it
/// improves service." The server applies that floor and sends nil; nothing here
/// ever fills the gap.
enum SatisfactionFormat {

    /// Mirrors SATISFACTION_ARC_MIN_DELTA. Below this, a move is rounding.
    static let arcMinDelta = 0.2

    /// Mirrors SATISFACTION_MIN_SAMPLE.
    static let minSample = 5

    /// One decimal, or an em dash.
    ///
    /// `Locale(identifier: "en_US_POSIX")` is load-bearing, not boilerplate.
    /// `String(format:)` follows the current locale, which renders 4.6 as "4,6"
    /// across most of Europe — making this number disagree with the same number
    /// on the laptop, on a customer's phone only, which is exactly the failure
    /// the parity guards exist to stop.
    static func format(_ average: Double?) -> String {
        guard let average, average.isFinite else { return "—" }
        return String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), average)
    }

    /// "better", "worse", or nil when the honest answer is "not enough to say".
    ///
    /// Mirrors response time's `arcDirection` deliberately: the two cards sit
    /// together, and an arc meaning one thing on one and another on the other is
    /// worse than no arc at all.
    static func arcDirection(_ improvedBy: Double?) -> String? {
        guard let improvedBy, improvedBy.isFinite else { return nil }
        if abs(improvedBy) < arcMinDelta { return nil }
        return improvedBy > 0 ? "better" : "worse"
    }

    /// The poor count as a sentence — work that happened, not a score.
    ///
    /// "2 jobs needed a call back" is a fact an owner can check; "customer
    /// satisfaction: 87%" is a number nobody can do anything with.
    static func poorRatingLine(_ count: Int) -> String {
        count == 1 ? "1 job needed a call back" : "\(count) jobs needed a call back"
    }
}
