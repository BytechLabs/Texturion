import XCTest

/// #733: a plain yes / no is `.confirmDialog(...)`, and anything bigger is
/// `ConfirmSheet`; both live in `Support/ConfirmDialog.swift`.
///
/// Each screen built its own `.alert` with a Cancel and a confirm button, sometimes
/// "Cancel", sometimes "Keep it", sometimes a red button and sometimes not, and a few
/// used an action sheet for the same question. This fails on a system alert or action
/// sheet anywhere else, unless the exception below says why the dialog is not a yes / no.
///
/// P-0  the scan read source files and the shared dialog is in use.
/// P-1  no file outside it presents an alert or action sheet itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class ConfirmDialogPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "confirm dialog",
        component: ".confirmDialog / ConfirmSheet (Support/ConfirmDialog.swift)",
        sharedFiles: ["Support/ConfirmDialog.swift"],
        rules: [
            PatternRule(name: "alert", pattern: #"\.alert\("#),
            PatternRule(name: "confirmationDialog", pattern: #"\.confirmationDialog\("#),
        ],
        exceptions: [
            PatternException(file: "Support/ListFilterHeader.swift", rule: "alert", reason: "A rename prompt with a text field, not a yes / no."),
            PatternException(file: "Features/Tasks/CallTask.swift", rule: "alert", reason: "A notice with an Open button after a task is made; it asks nothing."),
            PatternException(file: "Features/Tasks/NewTask.swift", rule: "alert", reason: "A notice with an Open button after a task is made; it asks nothing."),
            PatternException(file: "Features/Tasks/TasksTab.swift", rule: "alert", reason: "An error notice with a single OK; it asks nothing."),
            PatternException(file: "Features/Tasks/TaskDetailView.swift", rule: "confirmationDialog", reason: "Two action sheets that choose a scope (this task or all future ones), three choices rather than yes / no."),
            PatternException(file: "Features/Settings/CalendarFeedCard.swift", rule: "confirmationDialog", reason: "An action sheet with the one destructive action and no body copy to carry in a dialog."),
        ],
        usePattern: #"\.confirmDialog\(|\bConfirmSheet\("#,
        minUsers: 20
    )

    func testP0TheScanReadSourcesAndTheSharedDialogIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoYesNoIsPresentedByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
