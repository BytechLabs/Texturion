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

    private struct RejectionVector: Decodable {
        let domain: String
        let reason: String
        let recognised: Bool
        let field: String?
    }

    private struct AvatarInitialsVector: Decodable {
        let name: String
        let initials: String
    }

    private struct LastCompleteMonthVector: Decodable {
        let year: Int
        let month: Int
        let from: String
        let to: String
    }

    private struct PrepaidCopyVector: Decodable {
        let from_plan: String
        let to_plan: String
        let credit: String?
        let heading: String
        let explanation: String
        let acknowledgement: String
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

    /// #352. Pins WHERE a rejection sends the customer and whether we claim to
    /// understand it — never the wording, which each platform may phrase its own
    /// way. A client that focuses the wrong field walks somebody through
    /// re-entering the one thing that was already right, then bills them another
    /// multi-day carrier review for it.
    ///
    /// This case earned its vectors before it shipped: the obvious matcher is a
    /// word-boundary regex, and `ein` does not match `EIN_MISMATCH`
    /// because an underscore is a word character — so the whole catalogue
    /// matched nothing while reading as correct. Hence no regex on any side.
    func testRejectionRoutingAgreesWithTheTypeScript() throws {
        let cases = try vectors("rejections.json", as: [RejectionVector].self)
        XCTAssertFalse(cases.isEmpty, "no rejection vectors")
        for testCase in cases {
            let domain: RejectionDomain
            switch testCase.domain {
            case "registration": domain = .registration
            case "port": domain = .port
            default:
                XCTFail("unknown domain \(testCase.domain)")
                continue
            }
            let guidance = explainRejection(domain, testCase.reason)
            let label = "\(testCase.domain)/\(testCase.reason.prefix(40))"
            XCTAssertEqual(guidance != nil, testCase.recognised, "recognised for \(label)")
            XCTAssertEqual(guidance?.field, testCase.field, "field for \(label)")
            if let guidance {
                // Wording is free; empty wording is not. A recognised reason
                // that renders nothing is worse than an unrecognised one,
                // because the raw fall-through never runs.
                XCTAssertFalse(guidance.what.isEmpty, "what for \(label)")
                XCTAssertFalse(guidance.fix.isEmpty, "fix for \(label)")
            }
        }
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

    func testAvatarInitialsAgreeWithTheTypeScript() throws {
        // #582: this rule existed FIVE times and the five disagreed. Two of them
        // disagreed on one screen, so a contact was two people at a glance, and this
        // phone showed `(5` for every unnamed contact — the badge is handed a
        // formatted number and the old code took its first character.
        //
        // There is one implementation now. This is what keeps the hand-port on it,
        // including the case Swift would otherwise get "right" differently: a
        // decomposed accent, where a grapheme cluster and a scalar disagree.
        let cases = try vectors("avatar-initials.json", as: [AvatarInitialsVector].self)
        XCTAssertFalse(cases.isEmpty, "no avatar-initials vectors")
        for one in cases {
            // Names the INPUT, so a failure says which name diverged rather than
            // which line of a JSON file.
            XCTAssertEqual(
                initialsOf(one.name), one.initials,
                "initials for '\(one.name)'"
            )
        }
    }

    func testTheDefaultExportPeriodAgreesWithTheTypeScript() throws {
        // #595: the period a bookkeeper's export opens on, which three clients
        // now compute independently. If they disagree, two crews reconciling the
        // same month against the same invoice get files covering different days
        // — and the divergence is invisible, because each client is internally
        // consistent and confidently wrong on its own.
        //
        // The cases worth having are the ones a shortcut gets wrong: January,
        // which rolls back a year; February in a common year, a leap year, and
        // BOTH century rules — 2100 is 28 days and 2000 is 29, which a `% 4`
        // test gets right everywhere anybody would think to check and wrong in
        // the one place nobody would.
        //
        // The Swift side reaches for `Calendar.range(of: .day, in: .month, for:)`
        // rather than porting the TypeScript's spelled-out table. That is a
        // DIFFERENT implementation of the same rule, which is exactly what these
        // vectors are for: a hand-port that merely transliterated would agree
        // with itself.
        let cases = try vectors("last-complete-month.json", as: [LastCompleteMonthVector].self)
        XCTAssertFalse(cases.isEmpty, "no last-complete-month vectors")
        for one in cases {
            let actual = UsageExport.lastCompleteMonth(year: one.year, month: one.month)
            // Names the INPUT, so a failure says which month diverged rather
            // than which line of a JSON file.
            let label = "lastCompleteMonth(\(one.year), \(one.month))"
            XCTAssertEqual(actual.from, one.from, "from for \(label)")
            XCTAssertEqual(actual.to, one.to, "to for \(label)")
        }
    }

    func testPrepaidYearPromiseAgreesWithTheTypeScript() throws {
        // #583/D131: these sentences tell a customer their money is coming back, and
        // they are asked to agree to the amount in them. Three clients say it. A word
        // of drift here is a different promise on a different phone.
        //
        // The pair that matters most is the last: no figure from the server means
        // promise no number. A client that interpolated a nil anyway would say "puts
        // back on your account" — broken, and a promise about an amount nobody named.
        let cases = try vectors("prepaid-conversion-copy.json", as: [PrepaidCopyVector].self)
        XCTAssertFalse(cases.isEmpty, "no prepaid-conversion-copy vectors")
        for one in cases {
            let actual = prepaidConversionCopy(
                from: one.from_plan, to: one.to_plan, credit: one.credit
            )
            let label = "\(one.from_plan)->\(one.to_plan) credit=\(one.credit ?? "nil")"
            XCTAssertEqual(actual.heading, one.heading, "heading for \(label)")
            XCTAssertEqual(actual.explanation, one.explanation, "explanation for \(label)")
            XCTAssertEqual(
                actual.acknowledgement, one.acknowledgement,
                "acknowledgement for \(label)"
            )
        }
    }
}
