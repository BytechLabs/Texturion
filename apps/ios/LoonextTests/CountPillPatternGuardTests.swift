import XCTest

/// #733: a number in a small round token is `CountPill` and nowhere else.
///
/// The filter button, the contacts title and the pinned banner each drew their own count
/// as bare text in their own size and colour. This fails on a bare count (a `Text` that
/// holds only a number or a "+N") outside `Support/CountPill.swift`.
///
/// P-0  the scan read source files and `CountPill` is in use.
/// P-1  no file outside it draws a count token itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class CountPillPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "count pill",
        component: "CountPill (Support/CountPill.swift)",
        sharedFiles: ["Support/CountPill.swift"],
        rules: [
            PatternRule(name: "bare count text", pattern: #"Text\((?:String\([^()\n]*(?:[cC]ount|[uU]nread|older)[^()\n]*\)|"\+?\\\([^()\n]*(?:[cC]ount|[uU]nread|older)[^()\n]*\)")\)"#),
        ],
        exceptions: [],
        usePattern: #"\bCountPill\("#,
        minUsers: 3
    )

    func testP0TheScanReadSourcesAndCountPillIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoCountTokenIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
