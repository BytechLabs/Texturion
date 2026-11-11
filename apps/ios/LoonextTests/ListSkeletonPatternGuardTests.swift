import XCTest

/// #733: a list's first load is `ListSkeleton`, and the centred spinner is for
/// everything that is not a list.
///
/// Every list showed a bare spinner in the middle of an empty screen. This fails on a
/// `.redacted` placeholder anywhere, and on a `CenteredLoading()` in any file that is
/// not named below with the reason its loading is not a list. A screen that loads a
/// list moves to `ListSkeleton`; a screen that loads one record, a form, a board, a map
/// or a calendar is named here.
///
/// P-0  the scan read source files and `ListSkeleton` is in use.
/// P-1  no file outside the shared views draws list loading itself, unless named below.
/// P-2  the exceptions are closed: an entry that no longer matches fails.
/// P-3  every exception gives a reason.
final class ListSkeletonPatternGuardTests: XCTestCase {
    private static let spec = PatternGuardSpec(
        pattern: "list loading skeleton",
        component: "ListSkeleton (Support/ListSkeleton.swift)",
        sharedFiles: ["Support/ListSkeleton.swift"],
        rules: [
            PatternRule(name: "redacted placeholder", pattern: #"\.redacted\(reason:"#),
            PatternRule(name: "CenteredLoading", pattern: #"\bCenteredLoading\(\)"#),
        ],
        exceptions: [
            PatternException(file: "Features/Shell/RootView.swift", rule: "CenteredLoading", reason: "The app booting before any screen exists; there is no list to shape a skeleton like."),
            PatternException(file: "Features/Calls/CallDetailView.swift", rule: "CenteredLoading", reason: "One call's detail page loading a single record."),
            PatternException(file: "Features/Contacts/ContactDetailView.swift", rule: "CenteredLoading", reason: "One contact's detail page loading a single record."),
            PatternException(file: "Features/Tasks/TaskDetailView.swift", rule: "CenteredLoading", reason: "One task's detail page loading a single record."),
            PatternException(file: "Features/Compose/NewConversationView.swift", rule: "CenteredLoading", reason: "The new-conversation form booting its numbers and templates; a form, not a list."),
            PatternException(file: "Features/Thread/ThreadView.swift", rule: "CenteredLoading", reason: "A thread is a column of bubbles and a composer, not a list of rows; its skeleton keeps its own shape."),
            PatternException(file: "Features/Thread/AttachmentsGalleryView.swift", rule: "CenteredLoading", reason: "The gallery is a grid of thumbnails, not a list of rows."),
            PatternException(file: "Features/Tasks/TaskBoard.swift", rule: "CenteredLoading", reason: "A board of columns, not a list."),
            PatternException(file: "Features/Tasks/TaskCalendarView.swift", rule: "CenteredLoading", reason: "A calendar grid, not a list."),
            PatternException(file: "Features/Tasks/TaskMapView.swift", rule: "CenteredLoading", reason: "A map with pins, not a list."),
            PatternException(file: "Features/ForYou/ForYouTab.swift", rule: "CenteredLoading", reason: "The For you dashboard of panels, each its own shape, not a list."),
            PatternException(file: "Features/Payments/PaymentsSection.swift", rule: "CenteredLoading", reason: "A settings section that loads one form of toggles and keys."),
            PatternException(file: "Features/Settings/AiSection.swift", rule: "CenteredLoading", reason: "A settings section that loads one form of toggles."),
            PatternException(file: "Features/Settings/SettingsHome.swift", rule: "CenteredLoading", reason: "The settings home loading the workspace before any section can draw."),
            PatternException(file: "Features/Settings/TagsCard.swift", rule: "CenteredLoading", reason: "A small settings card with a fixed height that loads a handful of chips."),
            PatternException(file: "Features/Settings/TwoFactorCard.swift", rule: "CenteredLoading", reason: "A settings card loading one factor's status, not a list."),
            PatternException(file: "Features/Settings/UsageSection.swift", rule: "CenteredLoading", reason: "A usage report of figures and bars, not a list of rows."),
        ],
        usePattern: #"\bListSkeleton\("#,
        minUsers: 8
    )

    func testP0TheScanReadSourcesAndListSkeletonIsInUse() throws {
        try UiPatternScan.assertScanIsAlive(Self.spec)
    }

    func testP1NoListLoadsWithASpinnerUnlessNamed() throws {
        try UiPatternScan.assertNoHandRolledCopies(Self.spec)
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        try UiPatternScan.assertExceptionsAreCurrent(Self.spec)
    }

    func testP3EveryExceptionGivesAReason() {
        UiPatternScan.assertEveryExceptionGivesAReason(Self.spec)
    }
}
