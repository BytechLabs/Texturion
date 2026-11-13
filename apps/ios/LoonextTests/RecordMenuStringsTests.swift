import XCTest

@testable import Loonext

/// Android's twin of these checks is in `AppStringsTest.kt`.
final class RecordMenuStringsTests: XCTestCase {
    func testATaskRowsDeleteConfirmationHasNoPlaceholderLeftToFill() throws {
        for locale in [MessageLocale.en, MessageLocale.frCA] {
            let body = AppStrings.translate(locale, "recordMenu.taskDeleteBody")
            XCTAssertFalse(body.contains("recordMenu."), "\(locale): the key did not resolve")
            XCTAssertFalse(body.contains("{"), "\(locale): a token is left on screen: \(body)")
        }
        // A row has no notes or files to name, so the menu must not read the detail screen's {what} sentence.
        let url = try UiPatternScan.sourceRoot().appendingPathComponent("Features/Tasks/TaskRecordMenu.swift")
        let menu = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(
            menu.contains("\"recordMenu.taskDeleteBody\""),
            "the list menu does not read recordMenu.taskDeleteBody"
        )
        XCTAssertFalse(
            menu.contains("\"contactsTasks.deleteTaskBody\""),
            "the list menu reads the {what} sentence"
        )
    }

    func testTheDeleteRefusalDoesNotPromiseTheCreatorCanDelete() {
        // Since #691 a member is refused even on a task they created; only an admin or the owner deletes.
        let english = AppStrings.translate(MessageLocale.en, "contactsTasks.deleteForbidden")
        let french = AppStrings.translate(MessageLocale.frCA, "contactsTasks.deleteForbidden")
        XCTAssertFalse(english.contains("creator"), "EN still names the creator: \(english)")
        XCTAssertTrue(english.contains("admin"), "EN does not name the admin: \(english)")
        XCTAssertFalse(french.contains("créateur"), "FR still names the creator: \(french)")
        XCTAssertTrue(french.contains("administrateur"), "FR does not name the admin: \(french)")
    }
}
