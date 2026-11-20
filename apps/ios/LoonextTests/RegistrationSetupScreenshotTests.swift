import SwiftUI
import XCTest

@testable import Loonext

@MainActor
final class RegistrationSetupScreenshotTests: XCTestCase {
    func testRegistrationSetupScreenshot() throws {
        DesignFonts.register()
        let view = RegistrationSetupView(onRefresh: {}, onSignOut: {})
            .environment(\.appLocale, "en")
            .environment(\.colorScheme, .light)
            .frame(width: 390, height: 844)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2

        let image = try XCTUnwrap(renderer.uiImage)
        XCTAssertEqual(image.size.width, 390)
        XCTAssertEqual(image.size.height, 844)
        let attachment = XCTAttachment(image: image)
        attachment.name = "ios-registration-setup"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
