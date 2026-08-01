import XCTest

@testable import Loonext

/// #321 — the marker rule, hand-ported from `packages/shared/src/whats-new.ts`.
///
/// A badge that lights on one client and not another is worse than no badge, so
/// the rule has to answer identically on three clients. These are the same
/// cases the TypeScript and Kotlin suites assert, in the same order.
///
/// The cases that would make the marker USELESS matter more than the ones that
/// light it correctly, so most of these are about staying dark.
final class WhatsNewPortTests: XCTestCase {

    private let entries = [
        WhatsNewEntry(date: "2026-07-01", title: "Older", body: "b"),
        WhatsNewEntry(date: "2026-08-01", title: "Newer", body: "b"),
    ]

    func testLightsWhenSomethingShippedSinceTheyLastLooked() {
        XCTAssertTrue(
            hasUnseenWhatsNew(lastSeen: "2026-07-15", joinedAt: "2026-01-01", entries: entries)
        )
    }

    func testGoesDarkOnceTheyHaveLooked() {
        XCTAssertFalse(
            hasUnseenWhatsNew(lastSeen: "2026-08-01", joinedAt: "2026-01-01", entries: entries)
        )
    }

    func testDoesNotLightForAWorkspaceThatJustArrived() {
        // The case that would make the marker useless. A workspace created
        // today has no memory of missing anything, and a badge advertising six
        // months of changes is one they learn to ignore on day one.
        XCTAssertFalse(
            hasUnseenWhatsNew(lastSeen: nil, joinedAt: "2026-08-02", entries: entries)
        )
    }

    func testDoesLightForOneThatArrivedBeforeTheNewestChange() {
        XCTAssertTrue(
            hasUnseenWhatsNew(lastSeen: nil, joinedAt: "2026-07-15", entries: entries)
        )
    }

    func testSaysNothingWhenNothingIsKnown() {
        // A wrong badge costs trust in every later one, so an unknown member
        // gets silence rather than a guess.
        XCTAssertFalse(hasUnseenWhatsNew(lastSeen: nil, joinedAt: nil, entries: entries))
    }

    func testToleratesAFullTimestampWhereADateIsExpected() {
        // The client stores an ISO instant; the entries carry a date.
        XCTAssertTrue(
            hasUnseenWhatsNew(lastSeen: "2026-07-15T09:30:00Z", joinedAt: nil, entries: entries)
        )
        XCTAssertFalse(
            hasUnseenWhatsNew(lastSeen: "2026-08-01T09:30:00Z", joinedAt: nil, entries: entries)
        )
    }

    func testReportsWhichEntriesAreNew() {
        XCTAssertEqual(
            unseenWhatsNewEntries(lastSeen: "2026-07-15", joinedAt: nil, entries: entries)
                .map(\.title),
            ["Newer"]
        )
    }

    func testFindsTheNewestDateRegardlessOfOrder() {
        XCTAssertEqual(latestWhatsNewDate(entries), "2026-08-01")
        XCTAssertEqual(latestWhatsNewDate([]), "")
    }

    func testShippedEntriesAreNewestFirstAndCarryNoFutureDate() {
        let dates = whatsNewEntries.map(\.date)
        XCTAssertEqual(dates, dates.sorted(by: >))
        let today = String(ISO8601DateFormatter().string(from: Date()).prefix(10))
        for entry in whatsNewEntries {
            XCTAssertTrue(entry.date <= today, "\(entry.title) is dated \(entry.date)")
        }
    }

    func testNoEntryAnnouncesSomethingThatHasNotHappened() {
        // The honesty rule: a roadmap presented as news is how a changelog
        // loses credibility, and it does not come back.
        for entry in whatsNewEntries {
            let text = "\(entry.title) \(entry.body)".lowercased()
            XCTAssertFalse(text.contains("coming soon"), entry.title)
            XCTAssertFalse(text.contains("we will"), entry.title)
            XCTAssertFalse(text.contains("roadmap"), entry.title)
            // Law 6: no em or en dash in rendered copy.
            XCTAssertFalse(text.contains("—"), entry.title)
            XCTAssertFalse(text.contains("–"), entry.title)
        }
    }
}
