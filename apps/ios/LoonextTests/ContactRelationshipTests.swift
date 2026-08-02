import XCTest

@testable import Loonext

/// #410/#505 — the Swift half of two strings three clients render.
///
/// The tables below are `CONTACT_RELATIONSHIP_CASES` and
/// `CONTACT_REPEAT_BADGE_CASES` from
/// `packages/shared/src/contact-relationship.ts`, copied case for case. Adding
/// a case there means adding it here; the mirror is
/// `apps/android/.../features/contacts/ContactRelationshipTest.kt`.
///
/// A drifted copy does not degrade a feature — it tells one platform's crew a
/// different thing about the same customer.
final class ContactRelationshipTests: XCTestCase {

    /// (count, firstConversationAt, expected) — the shared fixture.
    private let cases: [(Int?, String?, String?)] = [
        (0, nil, nil),
        (nil, nil, nil),
        (0, "2026-03-04T10:00:00Z", nil),
        (1, "2026-03-04T10:00:00Z", "Customer since March 2026 · 1 conversation"),
        (7, "2026-03-04T10:00:00Z", "Customer since March 2026 · 7 conversations"),
        (23, "2023-11-30T23:59:59Z", "Customer since November 2023 · 23 conversations"),
        (4, nil, "4 conversations"),
        (4, "not a timestamp", "4 conversations"),
        (2, "2026-01-01T00:00:00Z", "Customer since January 2026 · 2 conversations"),
        (2, "2026-12-31T23:59:59Z", "Customer since December 2026 · 2 conversations"),
    ]

    func testMatchesTheSharedTableCaseForCase() {
        for (count, first, expected) in cases {
            XCTAssertEqual(
                contactRelationshipLine(count, first),
                expected,
                "count=\(String(describing: count)) first=\(String(describing: first))"
            )
        }
    }

    func testReadsTheMonthOffTheStringNotThroughADate() {
        // A Date-based port shifts a midnight UTC timestamp into the previous
        // month west of Greenwich, so the same customer would read "December"
        // on one client and "January" on another.
        XCTAssertEqual(monthYear("2026-01-01T00:00:00Z"), "January 2026")
        XCTAssertEqual(monthYear("2026-01-01T00:00:00-08:00"), "January 2026")
        XCTAssertEqual(monthYear("2026-12-31T23:59:59+13:00"), "December 2026")
    }

    func testDegradesToNilOnAnythingItCannotRead() {
        for bad in [nil, "", "yesterday", "2026", "26-03-04"] as [String?] {
            XCTAssertNil(monthYear(bad), String(describing: bad))
        }
    }

    func testGetsTheSingularRight() {
        // "1 conversations" is the kind of detail that makes a product feel
        // unfinished on the exact screen it is trying to build confidence.
        XCTAssertEqual(contactRelationshipLine(1, nil), "1 conversation")
        XCTAssertEqual(contactRelationshipLine(2, nil), "2 conversations")
    }

    // MARK: - #505, the thread-header badge

    /// (count, expected badge) — `CONTACT_REPEAT_BADGE_CASES`, case for case.
    private let badgeCases: [(Int?, String?)] = [
        (nil, nil),
        (0, nil),
        (1, nil),
        (2, "2 conversations"),
        (7, "7 conversations"),
        (23, "23 conversations"),
        (-3, nil),
    ]

    func testRepeatBadgeMatchesTheSharedTableCaseForCase() {
        for (count, expected) in badgeCases {
            XCTAssertEqual(
                contactRepeatBadge(count),
                expected,
                "count=\(String(describing: count))"
            )
        }
    }

    func testTheThresholdIsTheNamedConstantNotALiteral() {
        // Deliberately RELATIVE to the constant, with no `== 2` anywhere: the
        // table above already pins the shared contract's value, and a second
        // copy of the literal here would become a ceiling on changing it rather
        // than a check that the function and the constant still agree. What
        // this catches is one of the two moving without the other.
        XCTAssertNil(contactRepeatBadge(repeatCustomerMinimum - 1))
        XCTAssertNotNil(contactRepeatBadge(repeatCustomerMinimum))
    }

    func testTheHeaderAndTheContactScreenDisagreeAtOneDeliberately() {
        // The #505 decision, pinned so nobody "fixes" it into consistency
        // later: the count includes the conversation on screen, so a first-time
        // caller reads 1 and gets NO header chip — a badge on every thread
        // would be noise on the common case. `ContactDetailView` still says
        // "1 conversation", because somebody who opened a reading surface is
        // owed the fact. The two strings disagreeing at 1 IS the design.
        XCTAssertNil(contactRepeatBadge(1))
        XCTAssertEqual(contactRelationshipLine(1, nil), "1 conversation")
    }
}
