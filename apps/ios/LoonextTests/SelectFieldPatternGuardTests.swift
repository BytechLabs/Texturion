import XCTest

/// #746: a single choice from a short list is `SelectField` and nowhere else.
///
/// The app drew selects as a system `Picker` in twenty places and as a `Menu` of buttons in
/// a dozen more, with the role's description wrapped inside the closed control. This fails
/// on a system `Picker` outside `Support/SelectField.swift`, unless named below. The two
/// files named are Form rows, where the system draws the row's own title beside the value.
///
/// A `Menu` of buttons that assign a value is a select drawn by hand: this fails on a
/// `Menu` whose `Button` sets a binding or state to something other than `true` or `false`
/// (a flag that opens a sheet is an action, not a choice). It cannot see a button that
/// calls a function to save the choice, so a reviewer still reads a new `Menu`.
///
/// P-0  the scan read source files and `SelectField` is in use.
/// P-1  no file outside it draws a `Picker` or a value-setting `Menu` itself, unless named
///      below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class SelectFieldPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "select",
        component: "SelectField (Support/SelectField.swift)",
        sharedFiles: ["Support/SelectField.swift"],
        rules: [
            PatternRule(name: "system Picker", pattern: #"\bPicker\("#),
            PatternRule(
                name: "Menu that sets a value",
                pattern: #"\bMenu\b[^{]*\{[\s\S]{0,900}?\bButton\b[^{}]*\{\s*[A-Za-z_][A-Za-z0-9_.\[\]]*\s*=\s*(?!true\b|false\b)[^=\s]"#
            ),
        ],
        exceptions: [
            PatternException(file: "Features/Inbox/InboxTab.swift", rule: "system Picker", reason: "The inbox filter sheet: Form rows, where the system draws the row's title beside the value."),
            PatternException(file: "Features/Tasks/TaskFilterSheet.swift", rule: "system Picker", reason: "The task filter sheet: Form rows, where the system draws the row's title beside the value."),
            PatternException(file: "Features/Tasks/TasksTab.swift", rule: "Menu that sets a value", reason: "The sort chip in the filter bar: a sort order is a view setting shown as a chip beside the filters, not a field."),
            PatternException(file: "Features/Contacts/ContactsTab.swift", rule: "Menu that sets a value", reason: "The import button: it picks which file type to open, then runs the importer. An action, not a stored choice."),
            PatternException(file: "Features/Tasks/TaskLinksSection.swift", rule: "Menu that sets a value", reason: "The add-link button: each row opens the task picker for that relation. An action, not a stored choice."),
            PatternException(file: "Features/Tasks/TaskDetailView.swift", rule: "Menu that sets a value", reason: "The comment actions menu: edit and delete. Its Button fills the edit draft, which is an action."),
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
