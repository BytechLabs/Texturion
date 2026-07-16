import XCTest
@testable import Loonext

/// #166 native-auth pieces: PKCE verifier/challenge (RFC 7636 Appendix B
/// vector, cross-checked against a Python hashlib reference), the captcha
/// gate detector, SIWA nonce hashing, and the Google authorize/callback
/// plumbing.
final class AuthFlowsTests: XCTestCase {
    // MARK: - PKCE challenge (S256)

    func testRfc7636AppendixBVector() {
        // RFC 7636 Appendix B — the canonical verifier/challenge pair.
        XCTAssertEqual(
            Pkce.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )
    }

    func testSecondFixedVector() {
        // python3: base64.urlsafe_b64encode(hashlib.sha256(v).digest()).rstrip(b"=")
        XCTAssertEqual(
            Pkce.challenge(
                for: "loonext-166-fixed-verifier_0123456789abcdefghijKLMNOPQRSTUV~.-_"
            ),
            "8JqWXaKVpO2q8_9oOH2corhwt8IgCIeWCyRIL-Zj9NI"
        )
    }

    func testChallengeIsBase64UrlWithoutPadding() {
        let challenge = Pkce.challenge(for: Pkce.generateVerifier())
        XCTAssertEqual(challenge.count, 43) // 32 hash bytes → 43 chars unpadded
        XCTAssertFalse(challenge.contains("="))
        XCTAssertFalse(challenge.contains("+"))
        XCTAssertFalse(challenge.contains("/"))
    }

    // MARK: - PKCE verifier

    func testVerifierLengthAndAlphabet() {
        let verifier = Pkce.generateVerifier()
        XCTAssertEqual(verifier.count, 64)
        let unreserved = Set(
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        XCTAssertTrue(verifier.allSatisfy { unreserved.contains($0) })
    }

    func testVerifiersAreUnique() {
        let verifiers = (0 ..< 32).map { _ in Pkce.generateVerifier() }
        XCTAssertEqual(Set(verifiers).count, verifiers.count)
    }

    func testVerifierSupportsRfcLengthBounds() {
        XCTAssertEqual(Pkce.generateVerifier(length: 43).count, 43)
        XCTAssertEqual(Pkce.generateVerifier(length: 128).count, 128)
    }

    // MARK: - Captcha-gate detector

    func testStructuralCaptchaCodeDetected() {
        let error = ApiError(
            code: "captcha_failed",
            message: "request disallowed",
            httpStatus: 400
        )
        XCTAssertTrue(SupabaseAuth.isCaptchaRejection(error))
    }

    func testProductionCaptchaMessageShapeDetected() {
        // The exact founder-reported production string (#166).
        let error = ApiError(
            code: "unauthorized",
            message: "captcha protection: request disallowed (no captcha_token found)",
            httpStatus: 400
        )
        XCTAssertTrue(SupabaseAuth.isCaptchaRejection(error))
    }

    func testCaptchaDetectionIsCaseInsensitive() {
        let error = ApiError(
            code: "bad_request",
            message: "CAPTCHA verification process failed",
            httpStatus: 400
        )
        XCTAssertTrue(SupabaseAuth.isCaptchaRejection(error))
    }

    func testOrdinaryErrorsAreNotCaptcha() {
        let credentials = ApiError(
            code: "invalid_credentials",
            message: "Invalid login credentials",
            httpStatus: 400
        )
        XCTAssertFalse(SupabaseAuth.isCaptchaRejection(credentials))
        XCTAssertFalse(SupabaseAuth.isCaptchaRejection(URLError(.timedOut)))
    }

    // MARK: - SIWA nonce hashing

    func testNonceHashVector() {
        // python3: hashlib.sha256(b"loonext-raw-nonce-166").hexdigest()
        XCTAssertEqual(
            SiwaNonce.sha256Hex("loonext-raw-nonce-166"),
            "a31fe654e3cb0b903c28e3e4322a5e0e9ffe7dc78dd6f3143533f72764b33684"
        )
    }

    func testNonceHashIsLowercaseHex64() {
        let hash = SiwaNonce.sha256Hex(SiwaNonce.random())
        XCTAssertEqual(hash.count, 64)
        XCTAssertTrue(hash.allSatisfy { "0123456789abcdef".contains($0) })
    }

    func testRawNoncesAreUniqueAndRfcLength() {
        let nonces = (0 ..< 16).map { _ in SiwaNonce.random() }
        XCTAssertEqual(Set(nonces).count, nonces.count)
        XCTAssertTrue(nonces.allSatisfy { $0.count == 43 })
    }

    // MARK: - Google authorize URL

    func testAuthorizeURLCarriesThePkceQuery() throws {
        let url = GoogleOAuth.authorizeURL(challenge: "abc123", state: "state456")
        XCTAssertTrue(
            url.absoluteString.hasPrefix(
                "https://qoruyuxcgkdqpcgclgzs.supabase.co/auth/v1/authorize?"
            )
        )
        let components = try XCTUnwrap(
            URLComponents(url: url, resolvingAgainstBaseURL: false)
        )
        let items = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") }
        )
        XCTAssertEqual(items["provider"], "google")
        XCTAssertEqual(items["redirect_to"], "com.loonext.ios://auth-callback")
        XCTAssertEqual(items["code_challenge"], "abc123")
        XCTAssertEqual(items["code_challenge_method"], "s256")
        XCTAssertEqual(items["state"], "state456")
    }

    // MARK: - Google callback parsing

    func testCallbackWithCode() throws {
        let url = try XCTUnwrap(URL(string: "com.loonext.ios://auth-callback?code=pkce-code-1"))
        XCTAssertEqual(
            GoogleOAuth.parseCallback(url, expectedState: "s"),
            .code("pkce-code-1")
        )
    }

    func testCallbackEchoedStateMustMatch() throws {
        let good = try XCTUnwrap(
            URL(string: "com.loonext.ios://auth-callback?code=c&state=expected")
        )
        XCTAssertEqual(GoogleOAuth.parseCallback(good, expectedState: "expected"), .code("c"))

        let forged = try XCTUnwrap(
            URL(string: "com.loonext.ios://auth-callback?code=c&state=forged")
        )
        guard case .failed = GoogleOAuth.parseCallback(forged, expectedState: "expected") else {
            return XCTFail("forged state must fail")
        }
    }

    func testCallbackAccessDeniedIsSilent() throws {
        let url = try XCTUnwrap(URL(string: "com.loonext.ios://auth-callback?error=access_denied"))
        XCTAssertEqual(GoogleOAuth.parseCallback(url, expectedState: "s"), .denied)
    }

    func testCallbackErrorDescriptionSurfacesDecoded() throws {
        let url = try XCTUnwrap(URL(
            string: "com.loonext.ios://auth-callback"
                + "?error=server_error&error_description=Unable+to+exchange+external+code"
        ))
        XCTAssertEqual(
            GoogleOAuth.parseCallback(url, expectedState: "s"),
            .failed("Unable to exchange external code")
        )
    }

    func testCallbackForeignSchemeFails() throws {
        let url = try XCTUnwrap(URL(string: "https://evil.example/auth-callback?code=c"))
        guard case .failed = GoogleOAuth.parseCallback(url, expectedState: "s") else {
            return XCTFail("foreign scheme must fail")
        }
    }

    func testCallbackMissingCodeFails() throws {
        let url = try XCTUnwrap(URL(string: "com.loonext.ios://auth-callback"))
        guard case .failed = GoogleOAuth.parseCallback(url, expectedState: "s") else {
            return XCTFail("missing code must fail")
        }
    }

    // MARK: - Provider-setup detection + honest copy

    func testProviderSetupErrorShapes() {
        let disabled = ApiError(
            code: "validation_failed",
            message: "Unsupported provider: provider is not enabled",
            httpStatus: 400
        )
        XCTAssertTrue(SupabaseAuth.isProviderSetupError(disabled))

        let audience = ApiError(
            code: "bad_jwt",
            message: "Unacceptable audience in id_token: [com.loonext.ios]",
            httpStatus: 400
        )
        XCTAssertTrue(SupabaseAuth.isProviderSetupError(audience))

        let credentials = ApiError(
            code: "invalid_credentials",
            message: "Invalid login credentials",
            httpStatus: 400
        )
        XCTAssertFalse(SupabaseAuth.isProviderSetupError(credentials))
    }

    func testAuthorizePreflightClassification() {
        // 302 → provider configured; proceed to the browser.
        XCTAssertNil(GoogleOAuth.preflightError(status: 302, data: Data()))

        // 400 JSON → the honest founder-step copy, never raw JSON in a sheet.
        let body = Data(
            #"{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}"#
                .utf8
        )
        let notConfigured = GoogleOAuth.preflightError(status: 400, data: body)
        XCTAssertEqual(notConfigured?.message, "Google sign-in isn't set up for this app yet.")

        // 429 keeps the server's own words — it is NOT a setup problem.
        let limited = Data(#"{"error_code":"over_request_rate_limit","msg":"Rate limit exceeded"}"#.utf8)
        let rateLimit = GoogleOAuth.preflightError(status: 429, data: limited)
        XCTAssertEqual(rateLimit?.message, "Rate limit exceeded")
    }
}
