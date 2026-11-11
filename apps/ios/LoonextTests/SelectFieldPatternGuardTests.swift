import XCTest

/// #746: a single choice from a short list is `SelectField` and nowhere else.
///
/// The app drew selects as a system `Picker` in twenty places and as a `Menu` of buttons in
/// a dozen more, with the role's description wrapped inside the closed control. This fails
/// on a system `Picker` outside `Support/SelectField.swift`, unless named below. The two
/// files named are Form rows, where the system draws the row's own title beside the value.
///
/// Not covered, and open: a `Menu` of buttons used as a select (it is also how an action
/// menu is drawn, so no pattern can tell them apart). The ones left are listed in
/// docs/UI-PATTERNS.md.
///
/// P-0  the scan read source files and `SelectField` is in use.
/// P-1  no file outside it draws a `Picker` itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class SelectFieldPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "select",
        component: "SelectField (Support/SelectField.swift)",
        sharedFiles: ["Support/SelectField.swift"],
        rules: [
            PatternRule(name: "system Picker", pattern: #"\bPicker\("#),
        ],
        exceptions: [
            PatternException(file: "Features/Inbox/InboxTab.swift", rule: "system Picker", reason: "The inbox filter sheet: Form rows, where the system draws the row's title beside the value."),
            PatternException(file: "Features/Tasks/TaskFilterSheet.swift", rule: "system Picker", reason: "The task filter sheet: Form rows, where the system draws the row's title beside the value."),
        ],
        usePattern: #"\bSelectField\("#,
        minUsers: 6
    )

    func testP0TheScanReadSourcesAndSelectFieldIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoSelectIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
