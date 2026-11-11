import SwiftUI
import XCTest
@testable import Loonext

/// #731: a settings group heading must not look like the rows under it. Web
/// pins this with `GROUP_HEADING_CLASS` (10.5px, semibold, upper case, tracked,
/// muted) against `NAV_LINK_CLASS` (14px, medium, ink); this pins the phone's
/// heading against a row's title. Mirrors `SectionHeadingStyleTest.kt`.
final class SectionHeadingStyleTests: XCTestCase {
    func testAHeadingIsSmallerThanARowTitle() {
        XCTAssertLessThan(SectionHeadingStyle.size, SettingsRowStyle.titleSize)
        XCTAssertEqual(SectionHeadingStyle.size, 10.5)
    }

    func testAHeadingIsBolderThanARowTitleAndTrackedOut() {
        // A row's title is semibold.
        XCTAssertNotEqual(SectionHeadingStyle.weight, Font.Weight.semibold)
        XCTAssertEqual(SectionHeadingStyle.weight, Font.Weight.bold)
        XCTAssertGreaterThan(SectionHeadingStyle.kerning, 0)
    }

    func testAHeadingIsUpperCaseInBothLanguagesARowIsNot() {
        for entry in SettingsGroup.allCases {
            for locale in [MessageLocale.en, MessageLocale.frCA] {
                let label = AppStrings.translate(locale, entry.titleKey)
                let heading = SectionHeadingStyle.text(label)
                XCTAssertEqual(heading, label.uppercased())
                XCTAssertNotEqual(heading, label)
            }
        }
    }
}
