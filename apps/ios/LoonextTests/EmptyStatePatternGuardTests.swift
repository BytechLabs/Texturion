import XCTest

/// #733: the empty state is drawn by `EmptyState` and nowhere else.
///
/// Screens each drew their own: a bare muted line here, a `ContentUnavailableView`
/// there, a card stub in the For you editor, five paddings between them. This fails on
/// any of those outside `Support/EmptyState.swift`. A hand-rolled empty column is a
/// centred `Text` with a large top padding or one that fills its parent, so that shape
/// is the third rule.
///
/// P-0  the scan read source files and `EmptyState` is in use.
/// P-1  no file outside it draws an empty state itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class EmptyStatePatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "empty state",
        component: "EmptyState (Support/EmptyState.swift)",
        sharedFiles: ["Support/EmptyState.swift"],
        rules: [
            PatternRule(name: "ContentUnavailableView", pattern: #"\bContentUnavailableView\b"#),
            PatternRule(name: "PanelEmptyStub", pattern: #"\bPanelEmptyStub\b"#),
            PatternRule(name: "centred empty text", pattern: #"Text\([^;{}]{0,220}?\)\n(?:[ \t]*\.[^\n]*\n){0,8}?[ \t]*\.multilineTextAlignment\(\.center\)\n(?:[ \t]*\.[^\n]*\n){0,6}?[ \t]*\.(?:padding\(\.(?:top|vertical), (?:2[4-9]|[3-9][0-9]|1[0-9][0-9])\)|frame\(maxWidth: \.infinity, maxHeight: \.infinity)"#),
        ],
        exceptions: [],
        usePattern: #"\bEmptyState\("#,
        minUsers: 10
    )

    func testP0TheScanReadSourcesAndEmptyStateIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoEmptyStateIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
