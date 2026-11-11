import XCTest

/// #733: a view has one filled primary. On the phones a "view" is one type: a screen,
/// a card, a dialog or a sheet each own a single filled button (or the
/// `.mainAction(...)` circle), and an empty state's action is an outline button,
/// never a filled one. `.borderedProminent` is filled; `.bordered`, `.borderless` and
/// `.plain` are not. The web twin is `page-header.test.ts`.
///
/// This fails on a type that draws a second filled button, unless the list below says
/// why the two never show at the same time. An entry that no longer matches fails too.
///
/// P-0  the scan read source files.
/// P-1  no type draws a second filled primary, unless named below.
/// P-2  the exceptions are closed: an entry whose file has a different count fails.
/// P-3  every exception gives a reason.
/// P-4  the empty state's own action is an outline button.
final class OneFilledPrimaryPatternGuardTests: XCTestCase {
    private struct Allowed {
        let file: String
        let extra: Int
        let reason: String
    }

    private static let allowed: [Allowed] = [
        Allowed(file: "Features/Onboarding/MemberOrientation.swift", extra: 1, reason: "Start working and Next are the last step and every other step of one sheet."),
        Allowed(file: "Features/Settings/BillingSection.swift", extra: 1, reason: "Resubscribe (a cancelled plan) and Resume (a paused plan) are different states of the plan card."),
        Allowed(file: "Features/Settings/CalendarFeedCard.swift", extra: 1, reason: "Create (no feed yet) and Done (the link is showing) are two states of one card."),
        Allowed(file: "Features/Settings/CallingSection.swift", extra: 1, reason: "Review and Confirm are two steps of one change; the editor hides while the confirmation shows."),
        Allowed(file: "Features/Settings/PortCards.swift", extra: 2, reason: "Submit and Fix-and-resubmit belong to different port statuses, and the sheet's Check and Start are two steps of one sheet."),
        Allowed(file: "Features/Settings/ReminderRulesCard.swift", extra: 1, reason: "Set up the usual is the empty card's only action; the rule list and its Save replace it."),
        Allowed(file: "Features/Settings/TwoFactorCard.swift", extra: 1, reason: "The passkey branch and the authenticator-only branch are alternatives; the other action is outline."),
        Allowed(file: "Features/Settings/VoiceGreetingCard.swift", extra: 2, reason: "Save, Stop and Record are the three states of one recorder; one shows at a time."),
        Allowed(file: "Features/Settings/WebsiteWidgetCard.swift", extra: 1, reason: "Copy stays while the inline confirmation to rotate the snippet shows; the confirmation is the step the person is on."),
    ]

    private static let filled = #"\.borderedProminent\b|\.mainAction\(|\bMainActionButton\("#
    private static let typeStart = #"^(?:(?:private|fileprivate|public|internal|final) )*(?:struct|class|extension|enum)\s"#

    /// Files scanned, and the second-and-later filled buttons per file.
    private func extras() throws -> (files: Int, byFile: [String: Int]) {
        let base = try UiPatternScan.sourceRoot()
        let walker = try XCTUnwrap(FileManager.default.enumerator(at: base, includingPropertiesForKeys: nil))
        let filledRegex = try NSRegularExpression(pattern: Self.filled)
        let startRegex = try NSRegularExpression(pattern: Self.typeStart, options: .anchorsMatchLines)
        var files = 0
        var byFile: [String: Int] = [:]
        for case let url as URL in walker where url.pathExtension == "swift" {
            let relative = String(url.path.dropFirst(base.path.count + 1))
            // The shared main action draws its own button once; it is the thing counted.
            if relative == "Theme/MainAction.swift" { continue }
            let text = UiPatternScan.stripComments(try String(contentsOf: url, encoding: .utf8))
            files += 1
            let whole = NSRange(text.startIndex..., in: text)
            var starts = startRegex.matches(in: text, range: whole).map(\.range.location)
            starts.append(whole.length)
            var extra = 0
            for (from, to) in zip(starts, starts.dropFirst()) {
                let chunk = NSRange(location: from, length: to - from)
                extra += max(0, filledRegex.numberOfMatches(in: text, range: chunk) - 1)
            }
            if extra > 0 { byFile[relative] = extra }
        }
        return (files, byFile)
    }

    func testP0TheScanReadSourceFiles() throws {
        let result = try extras()
        XCTAssertGreaterThan(result.files, 200, "the scan read \(result.files) files; the source tree moved")
    }

    func testP1NoTypeDrawsASecondFilledPrimaryUnlessNamed() throws {
        let result = try extras()
        let unlisted = result.byFile
            .filter { entry in (Self.allowed.first { $0.file == entry.key }?.extra ?? 0) < entry.value }
            .map { "\($0.key)  x\($0.value)" }
            .sorted()
        XCTAssertEqual(
            unlisted,
            [],
            "Scanned \(result.files) files. These draw a second filled primary in one type. "
                + "Make the other one outline, or name the exception, with its reason, in this guard:\n"
                + unlisted.joined(separator: "\n")
        )
    }

    func testP2TheExceptionsExcuseCodeThatStillExists() throws {
        let result = try extras()
        let stale = Self.allowed
            .filter { result.byFile[$0.file] != $0.extra }
            .map { "\($0.file)  expected \($0.extra), found \(result.byFile[$0.file] ?? 0)" }
        XCTAssertEqual(stale, [], "These exceptions no longer match any code. Delete them.")
    }

    func testP3EveryExceptionGivesAReason() {
        let thin = Self.allowed
            .filter { $0.reason.trimmingCharacters(in: .whitespaces).count < 15 }
            .map(\.file)
        XCTAssertEqual(thin, [], "an exception needs a reason of its own")
    }

    func testP4TheEmptyStateActionIsOutline() throws {
        let url = try UiPatternScan.sourceRoot().appendingPathComponent("Support/EmptyState.swift")
        let text = UiPatternScan.stripComments(try String(contentsOf: url, encoding: .utf8))
        XCTAssertTrue(text.contains(".buttonStyle(.bordered)"), "the empty state's action is an outline button")
        XCTAssertFalse(text.contains(".borderedProminent"), "the empty state's action is never the filled primary")
    }
}
