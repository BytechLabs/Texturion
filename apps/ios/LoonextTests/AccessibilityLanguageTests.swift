import Foundation
import XCTest

@testable import Loonext

/// #238: native language metadata follows the reader's in-app choice.
///
/// These tests prove the value and the root wiring. They deliberately do not
/// claim that a VoiceOver voice pronounced a primary flow correctly; that is a
/// physical-device record under the protocol in `docs/ACCESSIBILITY.md`.
final class AccessibilityLanguageTests: XCTestCase {
    func testFrenchCanadianResolutionBecomesTheNativeFrenchCanadianLocale() {
        let resolved = UiLocale.resolve(
            user: MessageLocale.frCA,
            device: "en-CA",
            company: MessageLocale.en
        )
        let native = UiLocale.platformLocale(resolved)

        XCTAssertEqual(native.language.languageCode?.identifier, "fr")
        XCTAssertEqual(native.region?.identifier, "CA")
    }

    func testEnglishResolutionBecomesANativeEnglishLocale() {
        let resolved = UiLocale.resolve(
            user: MessageLocale.en,
            device: "fr-CA",
            company: MessageLocale.frCA
        )
        let native = UiLocale.platformLocale(resolved)

        XCTAssertEqual(native.language.languageCode?.identifier, "en")
    }

    func testAppRootPublishesOneResolvedValueToBothEnvironments() throws {
        let source = try String(contentsOf: appRoot(), encoding: .utf8)

        XCTAssertTrue(
            source.contains("private var appLocale: String { UiLocaleStore.shared.resolved }"),
            "the app root must use the existing resolved reader locale"
        )
        XCTAssertTrue(
            source.contains(".environment(\\.appLocale, appLocale)"),
            "the product catalogue must receive the resolved locale"
        )
        XCTAssertTrue(
            source.contains(".environment(\\.locale, UiLocale.platformLocale(appLocale))"),
            "SwiftUI's native text/accessibility environment must receive the same locale"
        )

        let gate = try XCTUnwrap(source.range(of: "AppLockGate(prefs: graph.prefs)"))
        let nativeLocale = try XCTUnwrap(
            source.range(of: ".environment(\\.locale, UiLocale.platformLocale(appLocale))")
        )
        XCTAssertLessThan(
            gate.lowerBound,
            nativeLocale.lowerBound,
            "the native locale modifier must wrap AppLockGate, not only RootView below it"
        )
    }

    private func appRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
            .appendingPathComponent("Loonext/LoonextApp.swift")
    }
}
