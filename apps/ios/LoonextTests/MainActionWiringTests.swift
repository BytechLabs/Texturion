import XCTest

@testable import Loonext

/// #732 — every tab's main action is the same control in the same place.
///
/// Inbox "New text", Calls "Dial", Tasks "New task" and Contacts "New contact"
/// must each go through `.mainAction(`, and none may keep a hand-built circle of
/// its own in its header. A source scan, in the `CancelOneActionTests` idiom,
/// because the property is the SHAPE of four screens and a pure function cannot
/// see it.
final class MainActionWiringTests: XCTestCase {
    /// Tab source file, and the catalogue key its action is spoken as.
    private let tabs: [(path: String, key: String)] = [
        ("Features/Inbox/InboxTab.swift", "inbox.composeAria"),
        ("Features/Calls/CallsView.swift", "contactsTasks.dialANumber"),
        ("Features/Tasks/TasksTab.swift", "thread.newTask"),
        ("Features/Contacts/ContactsTab.swift", "contactsTasks.newContact"),
    ]

    private func source(_ relative: String) throws -> String {
        var url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
            .appendingPathComponent("Loonext")
        for part in relative.split(separator: "/") {
            url = url.appendingPathComponent(String(part))
        }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            throw missingSource(url.path)
        }
        return text.replacingOccurrences(of: "\r\n", with: "\n")
    }

    private func count(of needle: String, in text: String) -> Int {
        text.components(separatedBy: needle).count - 1
    }

    /// The source without its #238 audit fixtures (`…AuditScreen` types and
    /// `…Fixture()` functions), which draw the real header, main action
    /// included, a second time for the accessibility audit.
    private func withoutAuditFixtures(_ text: String) -> String {
        let fixtureStart = #"^(private |fileprivate )?(struct \w+AuditScreen\b|func \w+Fixture\()"#
        var kept: [Substring] = []
        var skipping = false
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if !skipping, line.range(of: fixtureStart, options: .regularExpression) != nil {
                skipping = true
            }
            if !skipping { kept.append(line) }
            if skipping, line == "}" { skipping = false }
        }
        return kept.joined(separator: "\n")
    }

    /// A `plus` symbol with a 38pt frame within the few lines after it.
    private func drawsPlusIn38ptCircle(_ text: String) -> Bool {
        text.components(separatedBy: "systemName: \"plus\"").dropFirst().contains { after in
            after.prefix(240).contains("frame(width: 38, height: 38)")
        }
    }

    func testEachOfTheFourTabsUsesTheSharedMainActionExactlyOnce() throws {
        for tab in tabs {
            let text = try source(tab.path)
            XCTAssertEqual(
                count(of: ".mainAction(", in: withoutAuditFixtures(text)), 1,
                "\(tab.path) must draw its main action with .mainAction(, once"
            )
            XCTAssertTrue(
                text.contains(tab.key),
                "\(tab.path)'s main action must be spoken as \(tab.key)"
            )
        }
    }

    func testNoTabKeepsAHandBuiltCircleForItsMainAction() throws {
        let headerCircle = "frame(width: 44, height: 44)\n"
            + "                    .background(BrandColor.ink, in: Circle())"
        for tab in tabs {
            let text = try source(tab.path)
            XCTAssertFalse(
                text.contains(headerCircle),
                "\(tab.path) still draws its own ink circle in the header"
            )
            // An add circle is a plus in a 38pt frame. Tasks' list and board switcher
            // also uses 38pt circles, and is not an add button.
            XCTAssertFalse(
                drawsPlusIn38ptCircle(text),
                "\(tab.path) still draws its own 38pt add circle"
            )
        }
    }

    func testTheSharedButtonIsAnInkCircleOverTheTouchMinimum() throws {
        let text = try source("Theme/MainAction.swift")
        XCTAssertTrue(text.contains("BrandColor.ink, in: Circle()"))
        XCTAssertGreaterThanOrEqual(MainAction.size, 44)
        XCTAssertTrue(text.contains("alignment: .bottomTrailing"))
    }

    func testTheShellComposeEntryYieldsToEveryTabThatHasItsOwn() throws {
        let text = try source("Features/Shell/ShellView.swift")
        XCTAssertTrue(
            text.contains("if tab == .forYou {"),
            "the shell's compose button must show on For you only"
        )
    }
}
