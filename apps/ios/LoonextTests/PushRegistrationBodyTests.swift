import XCTest
@testable import Loonext

/// The wire shape of POST /v1/device-push-tokens (#228), where this phone
/// reports the language it is set to so a push can be composed in it.
///
/// Both properties worth pinning are invisible from inside the app: the tag
/// travels UNTOUCHED, and a phone with no preferred language omits the key
/// rather than sending a null. Nothing else in the build can see either — the
/// body encodes, the request succeeds, and a reader is quietly buzzed in the
/// wrong language.
final class PushRegistrationBodyTests: XCTestCase {
    private func decoded(_ body: PushRegistrar.RegisterBody) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: try JSONEncoder().encode(body))
    }

    /// Verbatim, in the shape iOS hands over. Folding `fr-CA` down to `fr` (or
    /// deciding `fr` means `fr-CA`) is the server's job precisely so that three
    /// hand-ported clients cannot arrive at three answers.
    func testTheDeviceTagIsSentExactlyAsThePhoneReportsIt() throws {
        XCTAssertEqual(
            try decoded(
                PushRegistrar.RegisterBody(platform: "ios", token: "fcm-1", locale: "fr-CA")
            ),
            .object([
                "platform": .string("ios"),
                "token": .string("fcm-1"),
                "locale": .string("fr-CA"),
            ])
        )
    }

    /// Underscored and unrecognised tags travel too. A client that filtered
    /// `de-DE` out here would be answering "which languages exist" a second
    /// time, and the answer it froze would be the one from the day it shipped.
    func testUnfamiliarAndUnderscoredTagsAreNotFilteredOut() throws {
        XCTAssertEqual(
            try decoded(
                PushRegistrar.RegisterBody(platform: "ios", token: "fcm-1", locale: "fr_CA")
            ),
            .object([
                "platform": .string("ios"),
                "token": .string("fcm-1"),
                "locale": .string("fr_CA"),
            ])
        )
        XCTAssertEqual(
            try decoded(
                PushRegistrar.RegisterBody(platform: "ios", token: "fcm-1", locale: "de-DE")
            ),
            .object([
                "platform": .string("ios"),
                "token": .string("fcm-1"),
                "locale": .string("de-DE"),
            ])
        )
    }

    /// ABSENT, not null. The server writes the column only when the field is
    /// present, so an omission leaves whatever an earlier registration reported
    /// standing — while a null is a value, and would erase it.
    func testNoDeviceLanguageOmitsTheKeyRatherThanSendingNull() throws {
        XCTAssertEqual(
            try decoded(
                PushRegistrar.RegisterBody(platform: "ios", token: "fcm-1", locale: nil)
            ),
            .object(["platform": .string("ios"), "token": .string("fcm-1")])
        )
    }

    /// One way to ask the phone what language it is in.
    ///
    /// `UiLocale.deviceTag()` already answers this for the app's own drawing,
    /// and it does not use `Locale.current` — that resolves against the
    /// languages the BUNDLE ships, which is one, so it would report English for
    /// every phone on earth. A registrar that reached for the OS itself would
    /// be a second reading free to drift into exactly that mistake, so this
    /// scan holds it to the shared helper.
    func testTheRegistrarAsksUiLocaleRatherThanTheOsItself() throws {
        let source = try registrarSource()
        XCTAssertTrue(
            source.contains("UiLocale.deviceTag()"),
            "PushRegistrar no longer reports the device language — a push composed "
                + "for this phone has lost the only record of what it reads."
        )
        for direct in ["Locale.current", "Locale.preferredLanguages"] {
            XCTAssertFalse(
                source.contains(direct),
                "PushRegistrar reads \(direct) directly. UiLocale.deviceTag() is the "
                    + "one reading; a second one drifts from what the app draws itself in."
            )
        }
    }

    private func registrarSource() throws -> String {
        // The test bundle lives in DerivedData, so walk up to the repo copy of
        // the sources rather than guessing a working directory. Same approach as
        // `ColorLiteralLintTests`.
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
            .appendingPathComponent("Loonext")
            .appendingPathComponent("Features")
            .appendingPathComponent("Push")
            .appendingPathComponent("PushRegistrar.swift")
        guard let text = try? String(contentsOf: file, encoding: .utf8) else {
            // Fails rather than skips — see `MissingSource`.
            throw missingSource(file.path)
        }
        return text
    }
}
