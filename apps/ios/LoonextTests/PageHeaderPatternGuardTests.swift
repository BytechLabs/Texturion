import XCTest

/// #733: a phone page header is a title, one main action and secondary actions, and
/// each is one shared piece: the title is `ScreenTitle`, the main action is
/// `.mainAction(...)` (`MainActionWiringTests` pins where it sits), and a secondary
/// action is `PaperIconButton`. This fails on a page that draws its own 30pt title or
/// its own 44pt paper circle, and on a tab that stopped using `ScreenTitle`. The web
/// twin is `page-header.test.ts`.
///
/// P-0  the scan read source files and `ScreenTitle` is in use.
/// P-1  no file outside the components draws a title or a header circle itself,
///      unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
/// P-4  each of the five tabs titles itself with `ScreenTitle`.
final class PageHeaderPatternGuardTests: XCTestCase {
    private static let ownTitle = "hand-built page title"
    private static let ownCircle = "hand-built 44pt paper circle"

    private static let spec = PatternGuardSpec(
        pattern: "page header",
        component: "ScreenTitle and PaperIconButton (Theme/DesignSystem.swift, Theme/PaperIconButton.swift)",
        sharedFiles: ["Theme/DesignSystem.swift", "Theme/PaperIconButton.swift"],
        rules: [
            PatternRule(name: ownTitle, pattern: #"\.font\(\.display\(30\)\)"#),
            PatternRule(
                name: ownCircle,
                pattern: #"\.frame\(width: 44, height: 44\)\n(?:[ \t]*\.[^\n]*\n){0,2}?[ \t]*\.background\((?:Circle\(\)\.fill\(BrandColor\.paper\)|BrandColor\.paper, in: Circle\(\))\)"#
            ),
        ],
        exceptions: [
            PatternException(file: "Features/Calls/InCallView.swift", rule: ownCircle, reason: "The system audio route picker is a UIKit view, not a Button, so it sits in a paper circle of its own."),
        ],
        usePattern: #"\bScreenTitle\("#,
        minUsers: 6
    )

    private static let tabs = [
        "Features/Calls/CallsView.swift",
        "Features/Contacts/ContactsTab.swift",
        "Features/ForYou/ForYouTab.swift",
        "Features/Inbox/InboxTab.swift",
        "Features/Tasks/TasksTab.swift",
    ]

    func testP0TheScanReadSourcesAndScreenTitleIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoTitleOrHeaderCircleIsDrawnByHandUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }

    func testP4EachTabTitlesItselfWithScreenTitle() throws {
        let base = try UiPatternScan.sourceRoot()
        for tab in Self.tabs {
            let text = UiPatternScan.stripComments(
                try String(contentsOf: base.appendingPathComponent(tab), encoding: .utf8)
            )
            XCTAssertEqual(
                text.components(separatedBy: "ScreenTitle(text:").count - 1,
                1,
                "\(tab) draws its title with ScreenTitle, once"
            )
        }
    }
}
