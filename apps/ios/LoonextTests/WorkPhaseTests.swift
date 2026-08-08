import XCTest
@testable import Loonext

/// #294 — before and after, and that this phone groups a job the way the laptop does.
///
/// A drift here means one client shows a customer four visits and another shows one
/// flat pile of photos. It would not fail to compile, which is why the port gets its
/// own test — and why it matters that iOS compiles only in CI.
final class WorkPhaseTests: XCTestCase {

    private struct Photo: JobPhotoLike {
        let id: String
        var noteId: String?
        var workPhase: String?
        var addedByUserId: String?
        var createdAt: String = "2026-08-08T10:00:00Z"
    }

    // MARK: - The two labels

    func testItIsBeforeAndAfterAndNothingElse() {
        // "During" is a category somebody invented in a meeting. A tech takes a
        // handful when they arrive and a handful when they finish.
        XCTAssertEqual(WorkPhase.all, ["before", "after"])
        XCTAssertEqual(WorkPhase.label("before"), "Before")
        XCTAssertEqual(WorkPhase.label("after"), "After")
    }

    func testAnythingElseIsNotAPhase() {
        XCTAssertTrue(WorkPhase.isPhase("before"))
        XCTAssertTrue(WorkPhase.isPhase("after"))
        for bad in ["during", "BEFORE", "", nil] {
            XCTAssertFalse(WorkPhase.isPhase(bad), bad ?? "nil")
        }
    }

    // MARK: - The grouping

    func testEachNotesFilesGoTogether() {
        let groups = groupJobPhotos([
            Photo(id: "a", noteId: "n1", createdAt: "2026-08-08T09:00:00Z"),
            Photo(id: "b", noteId: "n2", createdAt: "2026-08-08T15:00:00Z"),
            Photo(id: "c", noteId: "n1", createdAt: "2026-08-08T09:00:05Z"),
        ])
        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups[0].items.map(\.id), ["a", "c"])
        XCTAssertEqual(groups[1].items.map(\.id), ["b"])
    }

    func testTwoNotesWrittenInTheSameSecondStayApart() {
        // THE CASE THAT MATTERS for keying on the note rather than on the time: two
        // visits merged into one is a job record that says something untrue.
        let same = "2026-08-08T09:00:00Z"
        let groups = groupJobPhotos([
            Photo(id: "a", noteId: "n1", createdAt: same),
            Photo(id: "b", noteId: "n2", createdAt: same),
        ])
        XCTAssertEqual(groups.count, 2)
    }

    func testEverythingTheCustomerTextedIsOneGroup() {
        let groups = groupJobPhotos([
            Photo(id: "a", noteId: nil, createdAt: "2026-08-08T08:00:00Z"),
            Photo(id: "b", noteId: nil, createdAt: "2026-08-08T08:00:01Z"),
            Photo(id: "c", noteId: "n1", createdAt: "2026-08-08T09:00:00Z"),
        ])
        XCTAssertEqual(groups.count, 2)
        XCTAssertNil(groups[0].noteId)
        XCTAssertEqual(groups[0].items.map(\.id), ["a", "b"])
    }

    func testAVisitIsOrderedByWhenItStartedNotByItsLastUpload() {
        // A slow second upload must not move a visit later in the day than it
        // happened. The group's time is its EARLIEST file.
        let groups = groupJobPhotos([
            Photo(id: "late", noteId: "n1", createdAt: "2026-08-08T18:00:00Z"),
            Photo(id: "early", noteId: "n1", createdAt: "2026-08-08T08:00:00Z"),
            Photo(id: "midday", noteId: "n2", createdAt: "2026-08-08T12:00:00Z"),
        ])
        XCTAssertEqual(groups.map(\.noteId), ["n1", "n2"])
        XCTAssertEqual(groups[0].at, "2026-08-08T08:00:00Z")
    }

    func testTheLabelAndTheAuthorComeFromTheNote() {
        let groups = groupJobPhotos([
            Photo(id: "a", noteId: "n1", workPhase: "after", addedByUserId: "u1"),
        ])
        XCTAssertEqual(groups[0].workPhase, "after")
        XCTAssertEqual(groups[0].addedByUserId, "u1")
    }

    func testNothingInNothingOut() {
        XCTAssertTrue(groupJobPhotos([Photo]()).isEmpty)
    }

    // MARK: - The summary

    func testTheSummaryCountsEachLabel() {
        XCTAssertEqual(
            jobPhaseSummary([
                Photo(id: "a", workPhase: "before"),
                Photo(id: "b", workPhase: "before"),
                Photo(id: "c", workPhase: "after"),
            ]),
            "2 before, 1 after"
        )
    }

    func testAnUnlabelledJobGetsNoSummaryAtAll() {
        // Not "0 before, 0 after", which reads as a broken count rather than as a job
        // whose photos nobody classified — and most jobs will be that.
        XCTAssertNil(jobPhaseSummary([Photo(id: "a"), Photo(id: "b")]))
        XCTAssertNil(jobPhaseSummary([]))
    }

    // MARK: - Against the original

    private func repoPath(_ relative: String) throws -> URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        XCTFail("\(relative) is not reachable from \(#filePath)")
        throw CocoaError(.fileNoSuchFile)
    }

    private func sharedSource() throws -> String {
        try String(
            contentsOf: try repoPath("packages/shared/src/work-phase.ts"),
            encoding: .utf8
        )
    }

    func testTheLabelsMatchTheSharedModule() throws {
        let shared = try sharedSource()
        for label in [
            WorkPhase.label("before"),
            WorkPhase.label("after"),
            WorkPhase.unsetLabel,
        ] {
            XCTAssertTrue(
                shared.contains("\"\(label)\""),
                "this label has drifted: \(label)"
            )
        }
        let collapsed = shared
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        let hint = WorkPhase.hint
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        XCTAssertTrue(collapsed.contains(hint), "the hint has drifted: \(hint)")
    }

    func testTheSharedModuleStillKnowsOnlyTheseTwoPhases() throws {
        // A third phase added there and not here would leave this phone unable to
        // draw a label the server accepts.
        let shared = try sharedSource()
        guard let range = shared.range(of: "WORK_PHASES = [") else {
            return XCTFail("WORK_PHASES has moved — point this test at it")
        }
        let rest = shared[range.upperBound...]
        guard let end = rest.firstIndex(of: "]") else {
            return XCTFail("WORK_PHASES never closes")
        }
        let names = rest[..<end]
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " \"\n\r\t")) }
            .filter { !$0.isEmpty }
        XCTAssertEqual(names, WorkPhase.all)
    }
}
