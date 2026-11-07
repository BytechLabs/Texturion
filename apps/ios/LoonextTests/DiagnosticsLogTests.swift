import XCTest
@testable import Loonext

/// #253: the ring behind the support email's recent-error lines. These tests
/// pin what would be quietly wrong otherwise: nothing long and nothing
/// multi-line reaches a line, the newest failure is first, and the email never
/// carries more than the shared six.
final class DiagnosticsLogTests: XCTestCase {
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
        DiagnosticsLog.record(.sync, "sync\nfailed", detail: "a\n\nb")
        let entry = DiagnosticsLog.entries().first
        XCTAssertEqual(entry?.event, "sync failed")
        XCTAssertEqual(entry?.detail, "a b")
    }

    func testKeepsOnlyTheMostRecentEvents() {
        for index in 0..<(DiagnosticsLog.capacity + 5) {
            DiagnosticsLog.record(.api, "e\(index)")
        }
        let entries = DiagnosticsLog.entries()
        XCTAssertEqual(entries.count, DiagnosticsLog.capacity)
        XCTAssertEqual(entries.first?.event, "e\(DiagnosticsLog.capacity + 4)")
    }

    func testTheSupportEmailCarriesTheNewestSixAsOneLineEach() {
        for index in 0..<10 {
            DiagnosticsLog.record(.api, "request_failed", detail: "e\(index) 500")
        }
        let lines = DiagnosticsLog.recentLines()
        XCTAssertEqual(lines.count, DiagnosticsLog.reportedLines)
        XCTAssertEqual(DiagnosticsLog.reportedLines, 6)
        XCTAssertTrue(lines.first?.hasSuffix(" api request_failed e9 500") ?? false)
        XCTAssertTrue(lines.allSatisfy { !$0.contains("\n") })
    }
}
