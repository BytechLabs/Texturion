import XCTest

/// #746: a few options that each have a consequence are `ChoiceCards` and nowhere else.
///
/// Radio rows (a filled or empty circle beside a title and a line) were hand-built in
/// seven cards. This fails on the radio glyph outside `Support/ChoiceCards.swift`, unless
/// named below.
///
/// P-0  the scan read source files and `ChoiceCards` is in use.
/// P-1  no file outside it draws a radio row itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class ChoiceCardsPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "described choice",
        component: "ChoiceCards (Support/ChoiceCards.swift)",
        sharedFiles: ["Support/ChoiceCards.swift"],
        rules: [
            PatternRule(name: "radio glyph", pattern: #"largecircle\.fill\.circle"#),
        ],
        exceptions: [
            PatternException(file: "Features/Settings/BillingSection.swift", rule: "radio glyph", reason: "The plan cards: a price and a feature list on each card, not a title and a line."),
            PatternException(file: "Features/Contacts/DuplicateContactsCard.swift", rule: "radio glyph", reason: "Which record survives a merge: one radio per row of a comparison, not a stack of options."),
        ],
        usePattern: #"\bChoiceCards\("#,
        minUsers: 4
    )

    func testP0TheScanReadSourcesAndChoiceCardsIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoRadioRowIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
