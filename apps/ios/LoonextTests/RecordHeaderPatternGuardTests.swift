import XCTest

/// #733: a record's header is `RecordHeader` and nowhere else.
///
/// A contact, a task and a call each drew their own: a centred avatar over the name, a
/// done circle beside a title, a bare title with two pills under it. This fails on a
/// record screen's `identityHeader` or `header` that does not open with `RecordHeader`,
/// and on a `RecordHeader` that is never drawn.
///
/// P-0  the scan read source files and `RecordHeader` is in use.
/// P-1  no file outside it draws a record header itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class RecordHeaderPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "record header",
        component: "RecordHeader (Support/RecordHeader.swift)",
        sharedFiles: ["Support/RecordHeader.swift"],
        rules: [
            PatternRule(name: "record header drawn by hand", pattern: #"func\s+(?:identityHeader|header)\(_\s+\w+:\s*(?:Contact|TaskDetail|Call)\)\s*->\s*some View\s*\{(?:(?!RecordHeader)[\s\S]){300}"#),
        ],
        exceptions: [],
        usePattern: #"\bRecordHeader\s*[({]"#,
        minUsers: 4
    )

    func testP0TheScanReadSourcesAndRecordHeaderIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoRecordHeaderIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
