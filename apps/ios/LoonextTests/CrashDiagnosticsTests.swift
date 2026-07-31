import XCTest
@testable import Loonext

/// #485 — crash capture on the platform that had none.
///
/// What is tested here is the pure half: rotation, clamping, and the report
/// text. The MetricKit half cannot be unit-tested — `MXCrashDiagnostic` has no
/// public initialiser, and a crash cannot be provoked inside a test process
/// that has to survive to report the result. That boundary is why the pure
/// half was separated out at all.
final class CrashDiagnosticsTests: XCTestCase {

    private func report(
        _ secondsAgo: TimeInterval,
        stack: String = "frame",
        reason: String? = "Namespace SIGNAL, Code 5"
    ) -> CrashReport {
        CrashReport(
            receivedAt: Date(timeIntervalSinceNow: -secondsAgo),
            appVersion: "42",
            reason: reason,
            signal: "SIG5",
            stack: stack
        )
    }

    func testKeepsTheNewestAndDropsTheOldest() {
        // The interesting crash is the one that just happened, and a person who
        // declined the prompt has not thrown the earlier ones away (#197's
        // lesson on Android).
        let existing = (1...CrashReportLog.maxEntries).map { report(TimeInterval($0) * 100) }
        let merged = CrashReportLog.merged(existing: existing, incoming: [report(0)])
        XCTAssertEqual(merged.count, CrashReportLog.maxEntries)
        XCTAssertEqual(merged.first?.receivedAt, merged.map(\.receivedAt).max())
        // The oldest fell off, not the newest.
        XCTAssertFalse(merged.contains { $0.id == existing.last?.id })
    }

    func testNewestFirst() {
        // The screen renders the top of this list.
        let merged = CrashReportLog.merged(
            existing: [report(300), report(100)],
            incoming: [report(200)]
        )
        let times = merged.map(\.receivedAt)
        XCTAssertEqual(times, times.sorted(by: >))
    }

    func testTruncatesAStackThatWouldGrowWithoutLimit() {
        // An unbounded string here is a file that grows on a device already
        // having a bad day, and the frames that matter are at the top.
        let huge = String(repeating: "x", count: CrashReportLog.maxStackCharacters * 2)
        let clamped = CrashReportLog.clampStack(huge)
        XCTAssertLessThan(clamped.count, huge.count)
        XCTAssertTrue(clamped.hasSuffix("… truncated"))
        XCTAssertTrue(clamped.hasPrefix("xxxx"))
    }

    func testLeavesAShortStackExactlyAsItWas() {
        // Truncation must be invisible when nothing was truncated — a marker on
        // a complete stack would send somebody looking for frames that are
        // already all there.
        XCTAssertEqual(CrashReportLog.clampStack("a\nb\nc"), "a\nb\nc")
    }

    func testTheSharedReportCarriesTheCrash() {
        // The point of capturing it is getting it OFF the device.
        let text = DiagnosticsReport.text(
            snapshot: snapshot(),
            entries: [],
            crashes: [report(0, stack: "0  Loonext  0x1  thing()")]
        )
        XCTAssertTrue(text.contains("=== CRASHES (1) ==="))
        XCTAssertTrue(text.contains("0  Loonext  0x1  thing()"))
        XCTAssertTrue(text.contains("Namespace SIGNAL, Code 5"))
        XCTAssertTrue(text.contains("build=42"))
    }

    func testTheSharedReportSaysWhenThereAreNone() {
        // "(none captured)" rather than an absent section: a report that simply
        // omits the heading reads as an older build that could not capture
        // crashes at all, which is a different fact.
        let text = DiagnosticsReport.text(snapshot: snapshot(), entries: [])
        XCTAssertTrue(text.contains("=== CRASHES (0) ==="))
        XCTAssertTrue(text.contains("(none captured)"))
    }

    func testTheCrashSectionSurvivesAMissingReason() {
        // Apple does not always give one, and a nil must not swallow the stack.
        let text = DiagnosticsReport.text(
            snapshot: snapshot(),
            entries: [],
            crashes: [report(0, stack: "frames here", reason: nil)]
        )
        XCTAssertTrue(text.contains("frames here"))
        XCTAssertFalse(text.contains("reason:"))
    }

    func testACrashReportRoundTripsThroughJSON() {
        // It is persisted as JSON and read back after a relaunch — which is the
        // whole feature, since a report that evaporates on restart is a report
        // nobody sends.
        let original = report(0, stack: "a\nb")
        let data = try? JSONEncoder().encode([original])
        XCTAssertNotNil(data)
        let decoded = try? JSONDecoder().decode([CrashReport].self, from: data ?? Data())
        XCTAssertEqual(decoded?.first, original)
    }

    private func snapshot() -> DiagnosticsSnapshot {
        DiagnosticsSnapshot(
            appVersion: "1.0",
            build: "42",
            systemVersion: "26.0",
            deviceModel: "iPhone",
            pushRegistered: true,
            notificationsAllowed: true,
            realtimeState: "joined",
            companyId: nil
        )
    }
}
