import XCTest

/// #746: a long list found by typing is `SearchablePicker` and nowhere else.
///
/// A system search drawer (`.searchable`) over a list of choices was built for the time
/// zone and again for the country. This fails on `.searchable` outside
/// `Support/SearchablePicker.swift`, unless named below.
///
/// P-0  the scan read source files and `SearchablePicker` is in use.
/// P-1  no file outside it draws a searchable choice list itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class SearchablePickerPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "searchable picker",
        component: "SearchablePicker (Support/SearchablePicker.swift)",
        sharedFiles: ["Support/SearchablePicker.swift"],
        rules: [
            PatternRule(name: "searchable list", pattern: #"\.searchable\("#),
        ],
        exceptions: [
            PatternException(file: "Theme/CountryField.swift", rule: "searchable list", reason: "The country field: free text that also suggests, so an off-list value such as an enrichment's CA is still accepted as typed."),
        ],
        usePattern: #"\bSearchablePicker(?:Sheet)?\("#,
        minUsers: 2
    )

    func testP0TheScanReadSourcesAndSearchablePickerIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoSearchableListIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
