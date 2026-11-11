import XCTest

/// #733: "couldn't load this" is drawn by `LoadError` and nowhere else.
///
/// Screens drew a sentence and their own Retry button, each a little different (a text
/// button, a bordered one, an olive link). This fails on the old `CenteredError` and on
/// any file that spells the shared Retry label itself, outside `Support/LoadError.swift`.
///
/// P-0  the scan read source files and `LoadError` is in use.
/// P-1  no file outside it draws a load error itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class LoadErrorPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "load error",
        component: "LoadError (Support/LoadError.swift)",
        sharedFiles: ["Support/LoadError.swift"],
        rules: [
            PatternRule(name: "CenteredError", pattern: #"\bCenteredError\b"#),
            PatternRule(name: "hand-rolled Retry", pattern: #"[(,]\s*"common\.retry"\s*\)"#),
        ],
        exceptions: [
            PatternException(file: "Features/Settings/BillingSection.swift", rule: "hand-rolled Retry", reason: "Retries the pause check on the plan card, a bordered button under a status line that is already on screen; there is no failed load to replace."),
        ],
        usePattern: #"\bLoadError\("#,
        minUsers: 20
    )

    func testP0TheScanReadSourcesAndLoadErrorIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoLoadErrorIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
