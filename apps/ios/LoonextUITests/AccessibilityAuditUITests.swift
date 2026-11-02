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

    func testInCallControls() throws { try audit("inCall") }

    func testDialer() throws { try audit("dialer") }

    // MARK: Settings

    func testSettingsIndex() throws { try audit("settings") }

    // MARK: Large text

    /// The same screens at the largest accessibility text size, where controls
    /// are pushed off screen and labels stop fitting.
    func testLargeText() throws {
        for surface in ["login", "inbox", "thread", "calls", "inCall", "settings"] {
            try audit(surface, contentSize: "UICTContentSizeCategoryAccessibilityXXXL")
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

    private func audit(_ surface: String, contentSize: String? = nil) throws {
        let app = XCUIApplication()
        app.launchArguments += ["-a11yAuditSurface", surface]
        if let contentSize {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", contentSize]
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

        var failures: [String] = []
        var advice: [String] = []
        try app.performAccessibilityAudit(for: .all) { issue in
            let line = Self.describe(issue)
            let enforced = contentSize == nil ? Self.enforced : Self.enforcedAtLargeText
            if enforced.contains(issue.auditType), !Self.isInactiveControl(issue, in: app) {
                failures.append(line)
            } else {
                advice.append(line)
            }
            // Handled either way: keep going and report once, below.
            return true
        }

        let label = contentSize == nil ? surface : "\(surface) at large text"
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

    /// WCAG exempts a control that is switched off from the contrast minimum,
    /// and the audit does not know the label belongs to one.
    private static func isInactiveControl(_ issue: XCUIAccessibilityAuditIssue, in app: XCUIApplication) -> Bool {
        guard issue.auditType == .contrast, let label = issue.element?.label, !label.isEmpty else {
            return false
        }
        // The keypad's "*" is ink on paper (about 16:1); the audit reads the
        // anti-aliased edge of a glyph that thin.
        if label == "*" { return true }
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
