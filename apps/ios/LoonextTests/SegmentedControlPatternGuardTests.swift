import XCTest

/// #733: a one-of-N choice drawn as a track is `SegmentedControl` and nowhere else.
///
/// The app had the flat grey system `.segmented` Picker in two places, ink-pill tracks
/// hand-built in five, and a themed copy. This fails on a system segmented picker, and
/// on a hand-built selected pill (a fill that flips to ink when the segment is
/// selected), outside `Support/SegmentedControl.swift`. A row of choice chips that is
/// not a track is named below.
///
/// P-0  the scan read source files and `SegmentedControl` is in use.
/// P-1  no file outside it draws a segmented choice itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class SegmentedControlPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "segmented control",
        component: "SegmentedControl (Support/SegmentedControl.swift)",
        sharedFiles: ["Support/SegmentedControl.swift"],
        rules: [
            PatternRule(name: "system segmented picker", pattern: #"\.pickerStyle\(\.segmented\)"#),
            PatternRule(name: "hand-built selected pill", pattern: #"\bselected\s*\?\s*BrandColor\.ink\s*:\s*(?:BrandColor\.(?:paper|inset|insetDeep)|Color\.clear)\s*,\s*in:\s*(?:Capsule|Circle|RoundedRectangle)"#),
        ],
        exceptions: [
            PatternException(file: "Features/Calls/DialerSheet.swift", rule: "hand-built selected pill", reason: "The caller-ID chooser is a scrolling row of one chip per workspace number, however many there are, not a fixed track of segments."),
        ],
        usePattern: #"\bSegmentedControl\("#,
        minUsers: 5
    )

    func testP0TheScanReadSourcesAndSegmentedControlIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoSegmentedChoiceIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
