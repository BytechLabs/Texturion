import XCTest
@testable import Loonext

/// #473 — the six base64url conversions, and the summary rule ported from
/// TypeScript.
///
/// Unlike Android, where Credential Manager eats and produces WebAuthn JSON so
/// the app is a pure courier, Apple's API takes decoded `Data` and returns
/// decoded `Data`. Those conversions are the whole risk surface of the iOS
/// passkey path, and one of them fails INTERMITTENTLY when it is wrong: `+` and
/// `/` appear in roughly half of all 32-byte challenges, so standard base64
/// where base64url is wanted works for one person and not the next.
final class PasskeyEnrolmentTests: XCTestCase {

    /// Bytes chosen so standard base64 produces BOTH `+` and `/`, which is the
    /// only way this distinction is visible at all.
    private let awkward = Data([0xFB, 0xFF, 0xBE, 0x03, 0xEF, 0xFF])

    func testBase64UrlUsesTheUrlAlphabetAndNoPadding() {
        let standard = awkward.base64EncodedString()
        XCTAssertTrue(standard.contains("+") || standard.contains("/"),
                      "fixture no longer exercises the characters that differ")

        let encoded = Passkeys.base64UrlEncode(awkward)
        XCTAssertFalse(encoded.contains("+"))
        XCTAssertFalse(encoded.contains("/"))
        XCTAssertFalse(encoded.contains("="))
    }

    func testBase64UrlRoundTrips() {
        // Every length mod 4, because padding is where the decoder is fussy.
        for length in 1...8 {
            let data = Data((0..<length).map { UInt8(($0 &* 37 &+ 251) % 256) })
            let encoded = Passkeys.base64UrlEncode(data)
            XCTAssertEqual(Passkeys.base64UrlDecode(encoded), data, "length \(length)")
        }
    }

    func testBase64UrlDecodesWhatAServerMightSendEitherWay() {
        // A server is free to send padded standard base64; the challenge must
        // still decode. This is not hypothetical — GoTrue's own encoders have
        // differed between fields.
        XCTAssertEqual(Passkeys.base64UrlDecode("AAEC"), Data([0, 1, 2]))
        XCTAssertEqual(Passkeys.base64UrlDecode("AAECAw=="), Data([0, 1, 2, 3]))
        XCTAssertEqual(Passkeys.base64UrlDecode("AAECAw"), Data([0, 1, 2, 3]))
    }

    func testCreationOptionsDecodesTheThreeFieldsAppleNeeds() {
        let json = """
        {"challenge":"AAEC","rp":{"id":"app.loonext.com"},
         "user":{"id":"AwQF","name":"crew@example.com","displayName":"Crew"},
         "pubKeyCredParams":[{"type":"public-key","alg":-7}]}
        """
        let options = Passkeys.creationOptions(fromJson: json)
        XCTAssertEqual(options?.challenge, Data([0, 1, 2]))
        XCTAssertEqual(options?.userId, Data([3, 4, 5]))
        // The HANDLE, not the display name: Apple shows one string, and the
        // handle is what tells a personal login from a work one on one device.
        XCTAssertEqual(options?.userName, "crew@example.com")
    }

    func testCreationOptionsRefusesAShapeItDoesNotUnderstand() {
        // Returning nil rather than guessing: a challenge we invented would be
        // signed happily and rejected by the server with nothing to read.
        XCTAssertNil(Passkeys.creationOptions(fromJson: "not json"))
        XCTAssertNil(Passkeys.creationOptions(fromJson: #"{"challenge":"AAEC"}"#))
        XCTAssertNil(Passkeys.creationOptions(
            fromJson: #"{"challenge":"AAEC","user":{"name":"x"}}"#
        ))
    }

    func testRegistrationResponseCarriesEveryFieldTheServerReads() throws {
        let json = try XCTUnwrap(Passkeys.registrationResponseJson(
            credentialId: Data([1, 2, 3]),
            clientDataJson: Data([4, 5, 6]),
            attestationObject: awkward
        ))
        let root = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        )
        let response = try XCTUnwrap(root["response"] as? [String: Any])

        XCTAssertEqual(root["type"] as? String, "public-key")
        // id and rawId are the same value in the JSON form; the SDK's own
        // fallback serializer sets both from `credential.id`.
        XCTAssertEqual(root["id"] as? String, Passkeys.base64UrlEncode(Data([1, 2, 3])))
        XCTAssertEqual(root["rawId"] as? String, root["id"] as? String)
        XCTAssertEqual(
            response["clientDataJSON"] as? String,
            Passkeys.base64UrlEncode(Data([4, 5, 6]))
        )
        XCTAssertEqual(
            response["attestationObject"] as? String,
            Passkeys.base64UrlEncode(awkward)
        )
        // Present and empty rather than absent — an absent key has been the
        // difference between a parse and a 400 on more than one implementation.
        XCTAssertNotNil(root["clientExtensionResults"])
    }

    func testRegistrationResponseUsesUrlSafeEncodingThroughout() throws {
        let json = try XCTUnwrap(Passkeys.registrationResponseJson(
            credentialId: awkward,
            clientDataJson: awkward,
            attestationObject: awkward
        ))
        // The failure this catches is intermittent by nature, so it is asserted
        // over the whole document rather than field by field.
        XCTAssertFalse(json.contains("+"))
        XCTAssertFalse(json.contains("/"))
    }

    // MARK: - The association probe

    func testAssociationNeedsThisBundleUnderWebcredentials() {
        let listed = Data(#"{"webcredentials":{"apps":["ABCDE12345.com.loonext.ios"]}}"#.utf8)
        XCTAssertTrue(Passkeys.associationLists(bundleId: "com.loonext.ios", in: listed))

        // A different app on the same domain must not turn our button on.
        XCTAssertFalse(Passkeys.associationLists(bundleId: "com.other.app", in: listed))
    }

    func testAssociationIsFalseForTheFileWeServeToday() {
        // The state the domain is actually in: nothing uploaded to App Store
        // Connect, so no app id exists to publish. The card must show no passkey
        // option rather than one that always fails.
        let empty = Data(#"{"webcredentials":{"apps":[]}}"#.utf8)
        XCTAssertFalse(Passkeys.associationLists(bundleId: "com.loonext.ios", in: empty))
        XCTAssertFalse(Passkeys.associationLists(bundleId: "com.loonext.ios", in: Data("{}".utf8)))
        XCTAssertFalse(
            Passkeys.associationLists(bundleId: "com.loonext.ios", in: Data("nope".utf8))
        )
    }

    // MARK: - The ported rule

    func testSummaryNamesWhichKindsAreOn() {
        XCTAssertEqual(mfaSummaryKey(["webauthn"]), "settingsMore.tfaPasskeyOn")
        XCTAssertEqual(mfaSummaryKey(["totp"]), "settingsMore.tfaAuthenticatorOn")
        XCTAssertEqual(mfaSummaryKey(["totp", "webauthn"]), "settingsMore.tfaBothOn")
    }

    func testAFactorTypeItCannotNameStillReadsAsProtected() {
        // The branch a hand-copy drops. Rendering "off" to somebody who is
        // protected is the most dangerous wrong answer this card can give.
        XCTAssertEqual(mfaSummaryKey(["phone"]), "settingsMore.tfaOn")
        XCTAssertEqual(mfaSummaryKey([nil]), "settingsMore.tfaOn")
    }

    func testOffersTheMissingKindAndNothingElse() {
        XCTAssertEqual(missingFactorTypes(["totp"]), ["webauthn"])
        XCTAssertEqual(missingFactorTypes(["webauthn"]), ["totp"])
        XCTAssertEqual(missingFactorTypes(["totp", "webauthn"]), [])
        // Nobody with zero factors gets an "add another" affordance — they get
        // the first-time pitch, which explains what setup involves.
        XCTAssertEqual(missingFactorTypes([]), [])
    }

    func testEveryKeyItCanReturnHasWordsInBothLanguages() {
        // The resolver fails open: a missing key renders as the key.
        let keys = [
            "settingsMore.tfaPasskeyOn",
            "settingsMore.tfaAuthenticatorOn",
            "settingsMore.tfaBothOn",
            "settingsMore.tfaOn",
            "settingsMore.tfaAddPasskey",
            "settingsMore.tfaAddAuthenticator",
            "settingsMore.tfaUsePasskey",
            "settingsMore.tfaPasskeyPitch",
            "settingsMore.tfaPasskeyFactorName",
            "settingsMore.tfaPasskeyFailed",
        ]
        for locale in ["en", "fr-CA"] {
            for key in keys {
                let words = AppStrings.translate(locale, key)
                XCTAssertNotEqual(words, key, "\(key) has no words in \(locale)")
                XCTAssertFalse(words.isEmpty, "\(key) is empty in \(locale)")
            }
        }
    }
}
