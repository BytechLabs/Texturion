import AuthenticationServices
import Foundation

/// Native Sign in with Apple (#166) — App Store rule: an app offering Google
/// sign-in without Apple's is a rejection. The SwiftUI `SignInWithAppleButton`
/// (Apple's required control) drives ASAuthorizationController itself; these
/// are the pure pieces around it: request configuration (hashed nonce),
/// credential extraction, and the one-shot name Apple only ever sends on the
/// account's FIRST authorization.
enum AppleSignIn {
    /// What a completed authorization yields for the Supabase exchange.
    struct Credential {
        /// Apple's identity token (JWT) — carries SHA-256(rawNonce) as its
        /// nonce claim and the app bundle id as audience.
        let idToken: String
        /// Formatted full name — non-nil ONLY on the first-ever authorization
        /// for this Apple ID; Apple never repeats it.
        let fullName: String?
    }

    /// Configure the SIWA request: scopes plus the HASHED nonce (the raw
    /// nonce stays on device for the Supabase exchange).
    static func configure(_ request: ASAuthorizationAppleIDRequest, rawNonce: String) {
        request.requestedScopes = [.fullName, .email]
        request.nonce = SiwaNonce.sha256Hex(rawNonce)
    }

    /// nil = the user canceled the Apple sheet (silent no-op per HIG).
    static func credential(from result: Result<ASAuthorization, Error>) throws -> Credential? {
        switch result {
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code == .canceled {
                return nil
            }
            throw ApiError(
                code: "apple_authorization",
                message: "Apple sign-in didn't complete. Try again.",
                httpStatus: 0
            )
        case .success(let authorization):
            guard let appleCredential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = appleCredential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8),
                  !idToken.isEmpty
            else {
                throw ApiError(
                    code: "apple_credential",
                    message: "Apple didn't return a usable credential. Try again.",
                    httpStatus: 0
                )
            }
            return Credential(
                idToken: idToken,
                fullName: formattedName(appleCredential.fullName)
            )
        }
    }

    /// "Given Family" via the locale-aware formatter; nil when Apple sent
    /// nothing (every authorization after the first) or the parts are empty.
    static func formattedName(_ components: PersonNameComponents?) -> String? {
        guard let components else { return nil }
        let formatted = PersonNameComponentsFormatter.localizedString(
            from: components,
            style: .default
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        return formatted.isEmpty ? nil : formatted
    }
}
