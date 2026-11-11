import XCTest

/// #733: a symbol is drawn at `IconSize.small`, `.standard` or `.large` (12, 15 and 20
/// points, web's 14, 16 and 20 px) and at no number of its own.
///
/// This fails on an `Image(systemName:)` given a literal size from 10 to 20 points, or
/// any `.system(size:)`. Under 10 points a symbol sits inside a badge and is sized to
/// it; over 20 it is an illustration or a hero glyph. Both are outside the three, on
/// purpose, and are not scanned.
///
/// P-0  the scan read source files and the tokens are in use.
/// P-1  no file outside `IconSize.swift` sizes a symbol itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class IconSizePatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "icon size",
        component: "IconSize (Theme/IconSize.swift)",
        sharedFiles: ["Theme/IconSize.swift"],
        rules: [
            PatternRule(name: "symbol sized by hand", pattern: #"Image\(systemName:(?:[^()]|\([^()]*\))*\)(?:\s*\.[a-zA-Z]+\((?:[^()]|\([^()]*\))*\))*?\s*\.font\(\.(?:scaled\((?:1\d|20)(?:\.\d+)?[,)]|system\(size:\s*\d)"#),
        ],
        exceptions: [
            PatternException(
                file: "Features/Calls/InCallView.swift",
                rule: "symbol sized by hand",
                reason: "the in-call controls are sized as a set to the call buttons, not to the text beside them"
            ),
        ],
        usePattern: #"\bIconSize\.(?:small|standard|large)\b"#,
        minUsers: 20
    )

    func testP0TheScanReadSourcesAndTheTokensAreInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoSymbolIsSizedByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
