import XCTest

/// #733: a search box is `SearchField` and nowhere else.
///
/// Eight screens drew a magnifier, a text field and a clear button, with four paddings
/// and two sizes between them, and only some had a clear button. This fails on a
/// hand-drawn magnifier outside `Support/SearchField.swift`. The system `.searchable`
/// on a navigation stack is a different control; a screen that searches through it is
/// named below.
///
/// P-0  the scan read source files and `SearchField` is in use.
/// P-1  no file outside it draws a search box itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class SearchFieldPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "search field",
        component: "SearchField (Support/SearchField.swift)",
        sharedFiles: ["Support/SearchField.swift"],
        rules: [
            PatternRule(name: "hand-drawn magnifier", pattern: #"systemName:\s*"magnifyingglass""#),
            PatternRule(name: "searchable", pattern: #"\.searchable\("#),
        ],
        exceptions: [
            PatternException(file: "Features/Settings/WorkspaceSection.swift", rule: "searchable", reason: "The time zone picker searches through the navigation bar drawer of its own stack."),
            PatternException(file: "Theme/CountryField.swift", rule: "searchable", reason: "The country picker searches through the navigation bar drawer of its own stack."),
        ],
        usePattern: #"\bSearchField\("#,
        minUsers: 8
    )

    func testP0TheScanReadSourcesAndSearchFieldIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoSearchBoxIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
