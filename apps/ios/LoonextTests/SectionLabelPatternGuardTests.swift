import XCTest

/// #733: the small uppercase label over a group, a field or a list is `SectionLabel`
/// (or `SectionHeader` around it) and nowhere else.
///
/// Screens each drew their own: an upper-cased `Text`, a 10.5pt bold font and a
/// kerning of 0.8, 1.0 or 1.2 depending on who wrote it. This fails on a font that is
/// followed by positive kerning, or on an upper-cased `Text` that is followed by its
/// font, outside `Theme/DesignSystem.swift`, unless the exception list says why that
/// one is not a section label.
///
/// P-0  the scan read source files and `SectionLabel` is in use.
/// P-1  no file outside it draws a section label itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class SectionLabelPatternGuardTests: XCTestCase {
    private static let handBuilt = "hand-built section label"

    private static let spec = PatternGuardSpec(
        pattern: "section label",
        component: "SectionLabel (Theme/DesignSystem.swift)",
        sharedFiles: ["Theme/DesignSystem.swift"],
        rules: [
            PatternRule(
                name: handBuilt,
                pattern: #"\.font\([^\n]*\)\n[ \t]*\.kerning\((?!-)|\.uppercased\(\)\)?\n(?:[ \t]*\)\n)?[ \t]*\.font\("#
            ),
        ],
        exceptions: [
            PatternException(file: "Core/Model/EmergencyFlag.swift", rule: handBuilt, reason: "The urgent badge's own word inside its filled capsule, not a label over a group."),
            PatternException(file: "Features/Calls/DialerSheet.swift", rule: handBuilt, reason: "The letters under a dial pad key (ABC, DEF), part of the key."),
            PatternException(file: "Features/Tasks/TaskCalendarView.swift", rule: handBuilt, reason: "A weekday initial over a calendar column, centred, not a group heading."),
            PatternException(file: "Features/Tasks/TaskDetailView.swift", rule: handBuilt, reason: "A note's author and time byline, the caption of one note."),
            PatternException(file: "Features/Thread/MessageBubbles.swift", rule: handBuilt, reason: "The centred day divider (TODAY) between messages, which heads no group of fields."),
        ],
        usePattern: #"\bSectionLabel\("#,
        minUsers: 6
    )

    func testP0TheScanReadSourcesAndSectionLabelIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoSectionLabelIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
