import XCTest
@testable import Loonext

/// #376 — the same inputs the TypeScript owns, asserted against the Swift port.
///
/// `packages/shared` is shared by two of four clients, so every rule iOS needs
/// exists a second time here and a third time in Kotlin. #376 names that as the
/// root cause behind #338's parity drift, and it is right: a rule change needs
/// three edits and nothing enforced the third.
///
/// The cases are GENERATED from the TypeScript by
/// `scripts/generate-parity-vectors.mjs` and committed to
/// `packages/shared/vectors/`. CI regenerates and fails if they are stale, so
/// the file cannot quietly describe last month's rule.
///
/// This does not prevent divergence — three implementations remain, which
/// #376's own devil's advocate argues is reasonable for a hundred-line rule
/// across native clients. It CATCHES divergence, on the two rules where being
/// wrong costs money or wakes somebody up: segment counting (what a customer is
/// billed) and NANP lookup (destination validity, and the quiet-hours clock).
final class ParityVectorsTests: XCTestCase {
    private struct SegmentVector: Decodable {
        let text: String
        let encoding: String
        let segments: Int
        let unitsUsed: Int
        let unitsPerSegment: Int
    }

    private struct NanpVector: Decodable {
        let e164: String
        let is_us_ca: Bool
        let timezone: String?
        let country: String?
    }

    /// Walk UP to the repo root from this source file rather than counting
    /// directories. The test bundle's own resources would be a COPY of the
    /// vectors, which is a fourth place the cases live — the exact problem this
    /// is meant to solve.
    private func vectors<T: Decodable>(_ name: String, as type: [T].Type) throws -> [T] {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir
                .appendingPathComponent("packages/shared/vectors")
                .appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try JSONDecoder().decode(type, from: Data(contentsOf: candidate))
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTFail("parity vectors \(name) not found; run node scripts/generate-parity-vectors.mjs")
        return []
    }

    func testSegmentCountingAgreesWithTheTypeScript() throws {
        let cases = try vectors("segments.json", as: [SegmentVector].self)
        XCTAssertFalse(cases.isEmpty, "no segment vectors")
        for c in cases {
            let actual = estimateSegments(c.text)
            // The label names the INPUT rather than an index, so a failure says
            // which message diverged instead of which line of a JSON file.
            let label = "segments for \(c.text.prefix(24)) (\(c.text.count) chars)"
            XCTAssertEqual(actual.encoding, c.encoding, "\(label): encoding")
            XCTAssertEqual(actual.segments, c.segments, "\(label): segments")
            XCTAssertEqual(actual.unitsUsed, c.unitsUsed, "\(label): unitsUsed")
            XCTAssertEqual(
                actual.unitsPerSegment,
                c.unitsPerSegment,
                "\(label): unitsPerSegment"
            )
        }
    }

    func testTheEncodingsAreSpelledTheSameOnBothSides() {
        // The two constants the vectors compare against by string. A rename on
        // either side would make every segment case fail with a confusing
        // message; this one fails with the reason.
        XCTAssertEqual(SmsEncoding.gsm7, "GSM-7")
        XCTAssertEqual(SmsEncoding.ucs2, "UCS-2")
    }

    func testAreaCodeLookupAgreesWithTheTypeScript() throws {
        let cases = try vectors("nanp.json", as: [NanpVector].self)
        XCTAssertFalse(cases.isEmpty, "no nanp vectors")
        for c in cases {
            XCTAssertEqual(
                Nanp.isUsCaDestination(c.e164),
                c.is_us_ca,
                "is_us_ca for \(c.e164)"
            )
            // The quiet-hours clock reads this. A client that invented a
            // timezone here would text somebody at 3am.
            XCTAssertEqual(
                Nanp.destinationTimezone(c.e164),
                c.timezone,
                "timezone for \(c.e164)"
            )
            XCTAssertEqual(
                Nanp.destinationCountry(c.e164),
                c.country,
                "country for \(c.e164)"
            )
        }
    }
}
