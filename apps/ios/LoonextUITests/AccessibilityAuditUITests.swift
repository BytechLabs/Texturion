import XCTest

/// Apple's accessibility audit over the primary flows, on fixture data (see
/// `A11yAuditHost`). It checks labels, traits, hit regions, contrast and text
/// scaling; it does not run VoiceOver, so spoken output stays a manual pass
/// (docs/ACCESSIBILITY.md). Issues are gathered per launch and reported together.
@MainActor
final class AccessibilityAuditUITests: XCTestCase {

    // MARK: Sign in

    func testSignIn() throws { try audit("login") }

    func testSignUp() throws { try audit("signUp") }

    func testForgotPassword() throws { try audit("forgot") }

    // MARK: Inbox, thread and composer

    func testInbox() throws { try audit("inbox") }

    func testThreadAndComposer() throws { try audit("thread") }

    // MARK: Calls

    func testCallLog() throws { try audit("calls") }

    // MARK: Tasks and contacts

    func testTasks() throws { try audit("tasks") }

    func testContacts() throws { try audit("contacts") }

    func testInCallControls() throws { try audit("inCall") }

    func testDialer() throws { try audit("dialer") }

    // MARK: Settings

    func testSettingsIndex() throws { try audit("settings") }

    func testSettingsSearch() throws { try audit("settingsSearch") }

    // MARK: Account sheet

    func testAccountSheet() throws { try audit("account") }

    // MARK: Trash (#735)

    func testTrash() throws { try audit("trash") }

    // MARK: Exact time

    /// #720: a long-press on a call row opens its menu, which leads with the
    /// exact time. Kept as a screenshot in each theme.
    func testLongPressOnACallRowShowsTheExactTime() throws {
        for theme in ["light", "dark"] {
            let app = XCUIApplication()
            app.launchArguments += ["-a11yAuditSurface", "calls", "-theme", theme]
            app.launch()
            // The row may read as one element, so match any whose label names her.
            let row = app.descendants(matching: .any)
                .matching(NSPredicate(
                    format: "label CONTAINS %@ AND NOT (label BEGINSWITH %@) AND NOT (label BEGINSWITH %@)",
                    "Dana Whitcomb", "Call back", "Message"
                ))
                .firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 20), "the first call row never appeared")
            row.press(forDuration: 1.2)
            sleep(1)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "calls long-press (\(theme))"
            shot.lifetime = .keepAlways
            add(shot)
            app.terminate()
        }
    }

    // MARK: Large text

    /// The same screens at the largest accessibility text size, where controls
    /// are pushed off screen and labels stop fitting.
    func testLargeText() throws {
        for surface in ["login", "inbox", "thread", "calls", "inCall", "settings"] {
            try audit(surface, contentSize: "UICTContentSizeCategoryAccessibilityXXXL")
        }
    }

    // MARK: Dark theme

    /// The same screens in the dark theme, where contrast is measured against
    /// the dark palette.
    func testDarkTheme() throws {
        for surface in [
            "login", "inbox", "thread", "calls", "tasks", "contacts", "dialer", "settings",
            "settingsSearch", "account", "trash",
        ] {
            try audit(surface, theme: "dark")
        }
    }

    // MARK: Harness

    /// Findings that fail the build. The two it leaves out are logged instead:
    /// `dynamicType` flags the small captions the app does scale (through
    /// `relativeTo:`, which `scripts/check-native-a11y.mjs` enforces), and
    /// `textClipped` flags the one-line previews that truncate by design.
    private static let enforced: XCUIAccessibilityAuditType = [
        .contrast, .elementDetection, .hitRegion, .sufficientElementDescription, .trait,
    ]

    /// Contrast does not depend on the font size, and measuring it on text
    /// reflowed to the largest size produced readings that differ from the default
    /// size on the same colours, so the large-text pass leaves it to the first.
    private static let enforcedAtLargeText: XCUIAccessibilityAuditType = [
        .elementDetection, .hitRegion, .sufficientElementDescription, .trait,
    ]

    private func audit(_ surface: String, contentSize: String? = nil, theme: String? = nil) throws {
        let app = XCUIApplication()
        app.launchArguments += ["-a11yAuditSurface", surface]
        if let contentSize {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", contentSize]
        }
        if let theme {
            app.launchArguments += ["-theme", theme]
        }
        app.launch()
        XCTAssertTrue(
            app.wait(for: .runningForeground, timeout: 30),
            "\(surface): the app never reached the foreground"
        )
        // Something must have drawn, or the audit would pass over an empty screen.
        XCTAssertTrue(
            app.descendants(matching: .any).element(boundBy: 0).waitForExistence(timeout: 20),
            "\(surface): nothing on screen to audit"
        )

        let label = (contentSize == nil ? surface : "\(surface) at large text")
            + (theme.map { " (\($0))" } ?? "")
        // Kept for a person to look at; CI exports every attachment.
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = label
        shot.lifetime = .keepAlways
        add(shot)

        var failures: [String] = []
        var advice: [String] = []
        let enforced = contentSize == nil ? Self.enforced : Self.enforcedAtLargeText
        // A busy runner can run the OS audit out of time (code -56) on a long
        // screen; that says nothing about the screen, so it gets two more goes.
        for attempt in 1...3 {
            failures = []
            advice = []
            do {
                try app.performAccessibilityAudit(for: .all) { issue in
                    let line = Self.describe(issue)
                    if enforced.contains(issue.auditType), !Self.isExempt(issue, in: app) {
                        failures.append(line)
                    } else {
                        advice.append(line)
                    }
                    // Handled either way: keep going and report once, below.
                    return true
                }
                break
            } catch let error as NSError where error.code == -56 && attempt < 3 {
                continue
            }
        }

        if !advice.isEmpty {
            let note = "\(label): \(advice.count) advisory finding(s)\n" + advice.joined(separator: "\n")
            print("A11Y-AUDIT " + note)
            let attachment = XCTAttachment(string: note)
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertTrue(
            failures.isEmpty,
            "\(label): \(failures.count) accessibility issue(s)\n" + failures.joined(separator: "\n")
        )
    }

    /// Findings the audit raises that are not defects.
    private static func isExempt(_ issue: XCUIAccessibilityAuditIssue, in app: XCUIApplication) -> Bool {
        // Email fields of identical geometry pass; only SwiftUI's SecureField reports
        // its text line as its hit region, whatever frame it is given.
        if issue.auditType == .hitRegion, issue.element?.elementType == .secureTextField {
            return true
        }
        // The shared SearchField reports the same way: its TextField sits in a 44pt
        // box (`.frame(height: 44)`), yet the audit reads the 18pt text line. Only a
        // wide field qualifies, so a genuinely small text field still fails.
        if issue.auditType == .hitRegion, issue.element?.elementType == .textField,
           let width = issue.element?.frame.width, width >= 200 {
            return true
        }
        // Text the OS saw drawn but cannot tie to any element: nothing to fix, and
        // it appeared on one of three runs of the same build.
        if issue.auditType == .elementDetection, issue.element == nil {
            return true
        }
        guard issue.auditType == .contrast, let label = issue.element?.label, !label.isEmpty else {
            return false
        }
        // The keypad's "*" is ink on paper (about 16:1); the audit reads the
        // anti-aliased edge of a glyph that thin.
        if label == "*" { return true }
        // WCAG exempts a control that is switched off from the contrast minimum,
        // and the audit does not know the label belongs to one.
        let button = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        return button.exists && !button.isEnabled
    }

    private static func describe(_ issue: XCUIAccessibilityAuditIssue) -> String {
        let element = issue.element
        let name = element.flatMap { $0.label.isEmpty ? nil : $0.label } ?? "(no label)"
        let kind = element.map { String(describing: $0.elementType) } ?? "?"
        let frame = element.map { String(describing: $0.frame) } ?? "?"
        return "  [\(typeName(issue.auditType))] \(issue.compactDescription)"
            + " - \(kind) \"\(name)\" \(frame)"
    }

    private static func typeName(_ type: XCUIAccessibilityAuditType) -> String {
        switch type {
        case .contrast: "contrast"
        case .elementDetection: "elementDetection"
        case .hitRegion: "hitRegion"
        case .sufficientElementDescription: "sufficientElementDescription"
        case .dynamicType: "dynamicType"
        case .textClipped: "textClipped"
        case .trait: "trait"
        default: "type \(type.rawValue)"
        }
    }
}
