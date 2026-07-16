import AuthenticationServices
import Foundation
import UIKit

/// Pure pieces of the native Google PKCE flow (#166) — authorize-URL
/// building, callback parsing, and honest error mapping. Nonisolated so unit
/// tests exercise them directly; `GoogleSignInFlow` below owns the browser
/// session.
enum GoogleOAuth {
    /// Issue #166 scheme contract: `com.loonext.ios://auth-callback`.
    static let callbackScheme = "com.loonext.ios"
    static let redirectTo = "com.loonext.ios://auth-callback"

    /// Honest copy for the unprovisioned founder-step paths (PRODUCTION.md §8:
    /// enable the Google provider + allow-list the native redirect URLs).
    static let notConfiguredMessage = "Google sign-in isn't set up for this app yet."

    /// GoTrue's browser entry point. `state` is sent for defense in depth and
    /// validated when echoed (`parseCallback`); GoTrue signs its OWN state
    /// across the Google leg and does not round-trip ours today — the PKCE
    /// verifier (which never leaves the app) is what binds the code exchange
    /// to this attempt.
    static func authorizeURL(challenge: String, state: String) -> URL {
        // Static base URL — the components always reassemble.
        var components = URLComponents(
            url: AppConfig.supabaseURL.appending(path: "auth/v1/authorize"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "provider", value: "google"),
            URLQueryItem(name: "redirect_to", value: redirectTo),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
            URLQueryItem(name: "state", value: state),
        ]
        return components.url!
    }

    /// Outcome of the custom-scheme redirect.
    enum Callback: Equatable {
        case code(String)
        /// The user backed out at Google's consent screen — treat as cancel.
        case denied
        case failed(String)
    }

    static func parseCallback(_ url: URL, expectedState: String) -> Callback {
        guard url.scheme?.lowercased() == callbackScheme,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            return .failed("Sign-in was interrupted. Try again.")
        }
        let items = components.queryItems ?? []
        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value
        }
        if let error = value("error") {
            if error == "access_denied" { return .denied }
            if let description = value("error_description"), !description.isEmpty {
                // GoTrue form-encodes the description (spaces become "+").
                return .failed(description.replacingOccurrences(of: "+", with: " "))
            }
            return .failed("Google sign-in failed (\(error)). Try again.")
        }
        if let state = value("state"), state != expectedState {
            return .failed("Sign-in was interrupted. Try again.")
        }
        guard let code = value("code"), !code.isEmpty else {
            return .failed("Google didn't return a sign-in code. Try again.")
        }
        return .code(code)
    }

    /// Classifies the /authorize preflight: GoTrue answers with a redirect
    /// (302 → Google) when the provider is configured and a JSON error when
    /// it is not. nil = proceed to the browser.
    static func preflightError(status: Int, data: Data) -> ApiError? {
        if (300 ..< 400).contains(status) { return nil }
        let parsed = SupabaseAuth.parseAuthError(data, status: status)
        if SupabaseAuth.isProviderSetupError(parsed) || status == 400 {
            // The founder-step copy — never a browser sheet full of raw JSON.
            return ApiError(
                code: "provider_not_configured",
                message: notConfiguredMessage,
                httpStatus: status
            )
        }
        return parsed
    }
}

/// Runs the browser leg of Google sign-in: preflight (an honest sentence
/// instead of raw GoTrue JSON when the provider isn't configured), an
/// ASWebAuthenticationSession on the authorize URL, callback parsing, and
/// the PKCE exchange. `prefersEphemeralWebBrowserSession` stays false ON
/// PURPOSE — existing Google SSO cookies turn the sheet into a one-tap
/// account pick.
///
/// KNOWN LIMIT (documented in PRODUCTION.md §8): when the founder hasn't
/// allow-listed the native redirect URL yet, GoTrue silently falls back to
/// the site URL, so the sheet lands on the web app and never fires our
/// scheme — the user's only exit is Cancel, which reads as a calm no-op.
@MainActor
final class GoogleSignInFlow: NSObject {
    private let auth: SupabaseAuth
    /// Strong hold — the session dies if released mid-flow.
    private var webSession: ASWebAuthenticationSession?

    init(auth: SupabaseAuth) {
        self.auth = auth
        super.init()
    }

    /// nil = the user closed the sheet (or backed out at Google's consent
    /// screen) — the caller treats it as a calm no-op.
    func signIn() async throws -> AuthSession? {
        let verifier = Pkce.generateVerifier()
        let state = Pkce.generateVerifier(length: 43)
        let url = GoogleOAuth.authorizeURL(
            challenge: Pkce.challenge(for: verifier),
            state: state
        )
        try await preflight(url)
        guard let callback = try await startSession(url) else { return nil }
        switch GoogleOAuth.parseCallback(callback, expectedState: state) {
        case .denied:
            return nil
        case .failed(let message):
            throw ApiError(code: "oauth_callback", message: message, httpStatus: 0)
        case .code(let code):
            return try await auth.exchangePkce(authCode: code, codeVerifier: verifier)
        }
    }

    // MARK: - Browser leg

    private func startSession(_ url: URL) async throws -> URL? {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL?, Error>) in
            let session = ASWebAuthenticationSession(
                url: url,
                callback: .customScheme(GoogleOAuth.callbackScheme)
            ) { callbackURL, error in
                if let callbackURL {
                    continuation.resume(returning: callbackURL)
                    return
                }
                if let error, (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin {
                    continuation.resume(throwing: ApiError(
                        code: "oauth_browser",
                        message: "Couldn't open the Google sign-in window. Try again.",
                        httpStatus: 0
                    ))
                    return
                }
                continuation.resume(returning: nil) // user closed the sheet
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            webSession = session
            if !session.start() {
                // start() == false means the completion handler never fires.
                continuation.resume(throwing: ApiError(
                    code: "oauth_browser",
                    message: "Couldn't open the Google sign-in window. Try again.",
                    httpStatus: 0
                ))
            }
        }
    }

    /// Probe /authorize without following the redirect: enabled provider →
    /// 3xx to Google (proceed); disabled/misconfigured → GoTrue's JSON error,
    /// surfaced as the honest founder-step sentence.
    private func preflight(_ url: URL) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(
                for: request,
                delegate: RedirectBlocker()
            )
        } catch {
            throw ApiError(
                code: ApiErrorCode.network,
                message: "Can't reach the sign-in service. Check your connection.",
                httpStatus: 0
            )
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if let failure = GoogleOAuth.preflightError(status: status, data: data) {
            throw failure
        }
    }
}

/// The system asks for the anchor on the main thread — the `@preconcurrency`
/// conformance's main-actor assumption always holds (CallKitBridge pattern).
extension GoogleSignInFlow: @preconcurrency ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
        return windows.first { $0.isKeyWindow } ?? windows.first ?? ASPresentationAnchor()
    }
}

/// URLSession task delegate that surfaces 3xx responses instead of following
/// them — the preflight needs the redirect ITSELF as the success signal.
/// Stateless, hence the @unchecked Sendable (URLSession requires Sendable
/// delegates; NSObject blocks the checked synthesis).
private final class RedirectBlocker: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        nil // never follow; the caller reads the 3xx status directly
    }
}
