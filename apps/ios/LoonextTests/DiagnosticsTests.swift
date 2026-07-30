import XCTest
@testable import Loonext

/// #337 — the diagnostics surface iOS never had.
///
/// This app compiles only in Mobile CI, so these tests are the only thing that
/// runs the code before a device does. They pin the two properties that would
/// be quietly wrong otherwise:
///
///   1. **Nothing long, and nothing multi-line, reaches an entry.** The screen
///      is something a customer screenshots and sends us, and the report is one
///      event per line. A caller passing a whole error message would break both
///      at once.
///   2. **The unlock gesture matches Android exactly.** A founder saying "tap
///      the version seven times quickly" has to be true on whichever phone the
///      person is holding — that is the entire point of porting it rather than
///      inventing a second gesture.
final class DiagnosticsTests: XCTestCase {
    override func setUp() {
        super.setUp()
        DiagnosticsLog.clear()
    }

    override func tearDown() {
        DiagnosticsLog.clear()
        super.tearDown()
    }

    func testRecordsNewestFirst() {
        DiagnosticsLog.record(.api, "first")
        DiagnosticsLog.record(.realtime, "second")
        let entries = DiagnosticsLog.entries()
        XCTAssertEqual(entries.count, 2)
        // Newest first: the order somebody reading a bug report wants, because
        // the thing that just went wrong is the thing they are asking about.
        XCTAssertEqual(entries.first?.event, "second")
        XCTAssertEqual(entries.first?.category, .realtime)
    }

    func testClampsALongFieldRatherThanStoringIt() {
        let long = String(repeating: "x", count: 500)
        DiagnosticsLog.record(.api, long, detail: long)
        let entry = DiagnosticsLog.entries().first
        XCTAssertEqual(entry?.event.count, DiagnosticsLog.maxFieldLength)
        XCTAssertEqual(entry?.detail?.count, DiagnosticsLog.maxFieldLength)
    }

    func testCollapsesNewlinesSoOneEventStaysOneLine() {
        // Not cosmetic. The shared report is parsed by eye, one event per line,
        // and a multi-line detail would silently reshape every line after it.
        DiagnosticsLog.record(.sync, "sync\nfailed", detail: "a\n\nb")
        let entry = DiagnosticsLog.entries().first
        XCTAssertEqual(entry?.event, "sync failed")
        XCTAssertEqual(entry?.detail, "a b")
    }

    func testKeepsOnlyTheMostRecentEvents() {
        for index in 0..<(DiagnosticsLog.capacity + 25) {
            DiagnosticsLog.record(.api, "e\(index)")
        }
        let entries = DiagnosticsLog.entries()
        XCTAssertEqual(entries.count, DiagnosticsLog.capacity)
        // The ring drops the OLDEST, so the newest event is still there.
        XCTAssertEqual(entries.first?.event, "e\(DiagnosticsLog.capacity + 24)")
    }

    func testClearEmptiesTheRing() {
        DiagnosticsLog.record(.push, "registered")
        DiagnosticsLog.clear()
        XCTAssertTrue(DiagnosticsLog.entries().isEmpty)
    }

    // MARK: - The report

    private var snapshot: DiagnosticsSnapshot {
        DiagnosticsSnapshot(
            appVersion: "1.4.0",
            build: "88",
            systemVersion: "26.0",
            deviceModel: "iPhone",
            pushRegistered: true,
            notificationsAllowed: false,
            realtimeState: "Joined (2 number topics)",
            companyId: "co-1"
        )
    }

    func testReportCarriesTheDeviceFactsAndTheEvents() {
        DiagnosticsLog.record(.api, "request_failed", detail: "not_found 404")
        let text = DiagnosticsReport.text(
            snapshot: snapshot,
            entries: DiagnosticsLog.entries()
        )
        XCTAssertTrue(text.contains("App version: 1.4.0 (88)"))
        XCTAssertTrue(text.contains("Push token: Registered"))
        XCTAssertTrue(text.contains("Notifications: Blocked"))
        XCTAssertTrue(text.contains("Realtime: Joined (2 number topics)"))
        XCTAssertTrue(text.contains("request_failed"))
        XCTAssertTrue(text.contains("not_found 404"))
    }

    func testReportSaysSoWhenThereIsNothingToSay() {
        // An empty section rendered as nothing at all reads as a broken report.
        let text = DiagnosticsReport.text(snapshot: snapshot, entries: [])
        XCTAssertTrue(text.contains("RECENT EVENTS (0)"))
        XCTAssertTrue(text.contains("(none)"))
    }

    func testTheScreenAndTheReportShareOneOrder() {
        // `rows` is the single source for both, so a field added to one cannot
        // go missing from the other — the #437 failure, in miniature.
        let text = DiagnosticsReport.text(snapshot: snapshot, entries: [])
        for row in snapshot.rows {
            XCTAssertTrue(
                text.contains("\(row.label): \(row.value)"),
                "report is missing the row the screen shows: \(row.label)"
            )
        }
    }

    // MARK: - The gesture

    func testUnlockGestureMatchesAndroid() {
        XCTAssertEqual(DiagnosticsAccess.tapsToUnlock, 7)
        XCTAssertEqual(DiagnosticsAccess.tapWindow, 2)
        // Verbatim from Android's SettingsHome.kt, so one instruction works on
        // either phone.
        XCTAssertEqual(DiagnosticsAccess.message(unlocked: true), "Diagnostics unlocked")
        XCTAssertEqual(DiagnosticsAccess.message(unlocked: false), "Diagnostics hidden")
    }

    func testDiagnosticsIsHiddenUntilUnlocked() {
        // The section exists in the enum, so the ONLY thing keeping it off a
        // customer's settings screen is the filter. If `allCases` were ever
        // rendered directly again, this is what would say so.
        XCTAssertTrue(SettingsSection.allCases.contains(.diagnostics))
    }
}
