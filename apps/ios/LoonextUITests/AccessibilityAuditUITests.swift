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

    /// Text clipping and scaling at the largest accessibility size. The default-size
    /// audit already covers contrast and hit regions, which the font does not change.
    func testLargeText() throws {
        for surface in ["login", "inbox", "thread", "calls", "inCall", "settings"] {
            try audit(
                surface,
                types: [.textClipped, .dynamicType],
                contentSize: "UICTContentSizeCategoryAccessibilityXXXL"
            )
        }
    }

    // MARK: Harness

    private func audit(
        _ surface: String,
        types: XCUIAccessibilityAuditType = .all,
        contentSize: String? = nil
    ) throws {
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

        var found: [String] = []
        try app.performAccessibilityAudit(for: types) { issue in
            found.append(Self.describe(issue))
            // Handled: keep going, and fail once with the whole list below.
            return true
        }

        let label = contentSize == nil ? surface : "\(surface) at large text"
        XCTAssertTrue(
            found.isEmpty,
            "\(label): \(found.count) accessibility issue(s)\n" + found.joined(separator: "\n")
        )
    }

    private static func describe(_ issue: XCUIAccessibilityAuditIssue) -> String {
        let element = issue.element
        let name = element.flatMap { $0.label.isEmpty ? nil : $0.label } ?? "(no label)"
        let kind = element.map { String(describing: $0.elementType) } ?? "?"
        return "  [\(typeName(issue.auditType))] \(issue.compactDescription)"
            + " - \(kind) \"\(name)\""
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
        case .action: "action"
        case .parentChild: "parentChild"
        default: "type \(type.rawValue)"
        }
    }
}
