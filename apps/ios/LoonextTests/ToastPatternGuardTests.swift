import XCTest

/// #733: a notice that can be taken back, or that points at something made elsewhere,
/// is built by `Toast` and nowhere else.
///
/// Four ways to draw one by hand: the Undo label typed out (`thread.undo` or
/// `inbox.undo`), an Open action typed out on a notice or an alert, and a timer that
/// picks its own number of seconds for an undoable notice. A delete with no restore
/// asks first through `ConfirmDialog` and reports plainly; that half is the
/// `ConfirmDialogPatternGuardTests`.
///
/// P-0  the scan read source files and `Toast` is in use.
/// P-1  no file outside it builds an Undo or Open itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class ToastPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "toast",
        component: "Toast (Support/Toast.swift)",
        sharedFiles: ["Support/Toast.swift"],
        rules: [
            PatternRule(name: "undo label by hand", pattern: #""(?:inbox|thread)\.undo"(?!\s*:)"#),
            PatternRule(name: "open action on a notice by hand", pattern: #"actionLabel:[^\n]*"common\.open""#),
            PatternRule(name: "open action on an alert by hand", pattern: #"\.alert\([\s\S]{0,400}?"common\.open""#),
            PatternRule(name: "undo timer by hand", pattern: #"\.seconds\([^\n]*\?\s*\d+(?:\.\d+)?\s*:\s*\d"#),
        ],
        exceptions: [],
        usePattern: #"\bToast\.(?:undoable|created|undoLabel|seconds)\(|\.createdAlert\("#,
        minUsers: 5
    )

    func testP0TheScanReadSourcesAndToastIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoUndoOrOpenIsBuiltByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
