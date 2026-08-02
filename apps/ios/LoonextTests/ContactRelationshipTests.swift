import XCTest

@testable import Loonext

/// #410 — the Swift half of a line three clients render.
///
/// The table below is `CONTACT_RELATIONSHIP_CASES` from
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
}
