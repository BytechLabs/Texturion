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
    /// TWO THINGS HERE DISAGREE WITH THE OTHER CLIENTS BY DEFAULT, and both
    /// were caught by the parity tests rather than by reading the code.
    ///
    /// `Locale(identifier: "en_US_POSIX")` is load-bearing, not boilerplate.
    /// `String(format:)` follows the current locale, which renders 4.6 as "4,6"
    /// across most of Europe — the same number disagreeing with the laptop, on
    /// a customer's phone only.
    ///
    /// The explicit rounding is the second. `String(format: "%.1f")` is C
    /// printf, which rounds half to EVEN: 4.25 prints as "4.2" here while
    /// JavaScript's `toFixed` and Kotlin's `String.format` both give "4.3".
    /// A tie is not exotic — an average of exactly 4.25 is four answers of 4
    /// and four of 5 — and one screen reading 4.2 while another reads 4.3 is
    /// precisely the kind of small disagreement that makes a crew stop trusting
    /// the panel. `.toNearestOrAwayFromZero` is half-up, which is what the
    /// other two do, and scores are always positive so the two are the same
    /// rule here.
    static func format(_ average: Double?) -> String {
        guard let average, average.isFinite else { return "—" }
        let halfUp = (average * 10).rounded(.toNearestOrAwayFromZero) / 10
        return String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), halfUp)
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
