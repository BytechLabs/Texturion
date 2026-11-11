import XCTest

/// #733: a list's Filter button and Views menu are `ListFilterRow` (its pieces
/// `ListFilterButton` and `ListViewsMenu`) and nowhere else.
///
/// The inbox, Tasks and Contacts each offer the same two controls. This fails on a file
/// outside `Support/ListFilterHeader.swift` that draws either by hand: it uses the
/// decrease-lines or bookmark symbol the pair is built on, or reads the label keys only
/// they carry (the Filter button's "N on" name, the Views menu's name, "Save these
/// filters" and "Manage views"). A segmented control is not this pattern.
///
/// P-0  the scan read source files and the shared row is in use.
/// P-1  no file outside it draws a filter button or views menu itself.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class ListFilterPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "filter row",
        component: "ListFilterRow (Support/ListFilterHeader.swift)",
        sharedFiles: ["Support/ListFilterHeader.swift"],
        rules: [
            PatternRule(name: "hand-built filter or views icon", pattern: #"(?:systemName|systemImage):\s*"(?:line\.3\.horizontal\.decrease(?:\.circle)?(?:\.fill)?|bookmarks?(?:\.fill)?)""#),
            PatternRule(name: "hand-built filter or views label", pattern: #"translate\([^,()\n]+,\s*"inbox\.(?:filterActionCount|viewsMenuAria|viewsSaveCurrent|viewsManage)""#),
        ],
        exceptions: [],
        usePattern: #"\bListFilterRow\(|\bListFilterButton\("#,
        minUsers: 3
    )

    func testP0TheScanReadSourcesAndTheFilterRowIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoFilterButtonOrViewsMenuIsDrawnByHand() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
