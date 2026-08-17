import AuthenticationServices
import Foundation
import UIKit

/// #473 — enrolling a passkey on iOS, through AuthenticationServices.
///
/// ## The case for this being the iOS story rather than a nice extra
///
/// #314 shipped codes from an authenticator app and said in its own words that
/// passkeys suit these users better. It is right, and it is most right here: a
/// tradesperson holds ONE phone, and the authenticator sits on the same screen
/// as the app asking for the six digits it shows. Face ID instead of copying
/// digits between two apps on one screen is the largest single UX win in the
/// issue.
///
/// ## A SECOND FACTOR, NEVER THE PASSWORD (D125)
///
/// The credential lives on this handset and in this iCloud Keychain. Standing
/// alone it would make a lost phone an account reachable only through the
/// recovery codes, which turns the last resort into the primary key.
///
/// ## What travels, and what this file has to build by hand
///
/// Unlike Android — where Credential Manager eats and produces WebAuthn JSON, so
/// the app is a pure courier — Apple's API takes decoded `Data` and returns
/// decoded `Data`. So this file base64url-decodes three fields on the way in and
/// base64url-encodes three on the way out, into exactly the
/// `RegistrationResponseJSON` shape GoTrue expects. Those six conversions are
/// the whole risk surface, and they are why the encoder is a tested pure
/// function rather than six inline expressions.
enum Passkeys {
    /// The relying party every client enrols under.
    ///
    /// The web app enrols with `window.location.hostname`, which is this. A
    /// passkey is scoped to the RP that created it, so a different id here would
    /// mint a credential the web app could never use: one account, two second
    /// factors that each work in exactly one place.
    static let relyingPartyId = "app.loonext.com"

    /// What the caller needs out of the server's creation options.
    struct CreationOptions: Equatable {
        let challenge: Data
        let userId: Data
        let userName: String
    }

    /// Base64url without padding, per the WebAuthn spec's `Base64URLString`.
    ///
    /// Foundation only speaks standard base64, and the difference is not
    /// cosmetic: `+` and `/` appear in roughly half of all 32-byte challenges,
    /// so a naive `base64EncodedString()` produces a value the server rejects
    /// for *some* enrolments and accepts for others. An intermittent failure is
    /// far worse than a total one, which is the reason this is its own function
    /// with its own test rather than a line inside the encoder.
    static func base64UrlEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The inverse. Padding is restored because Foundation's decoder requires
    /// it, and a server is free to send either form.
    static func base64UrlDecode(_ value: String) -> Data? {
        var normalised = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = normalised.count % 4
        if remainder > 0 {
            normalised += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: normalised)
    }

    /// Pull what `ASAuthorizationPlatformPublicKeyCredentialProvider` needs out
    /// of the server's `PublicKeyCredentialCreationOptionsJSON`.
    ///
    /// Returns nil rather than throwing on a shape it does not recognise: the
    /// caller's answer to "the server sent something unexpected" is the same as
    /// its answer to every other enrolment failure, and a thrown error here
    /// would only travel further to be turned back into that same sentence.
    static func creationOptions(fromJson json: String) -> CreationOptions? {
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let challengeText = root["challenge"] as? String,
              let challenge = base64UrlDecode(challengeText),
              let user = root["user"] as? [String: Any],
              let userIdText = user["id"] as? String,
              let userId = base64UrlDecode(userIdText)
        else { return nil }

        // `name` is the account handle a passkey manager lists; `displayName` is
        // a human name. Apple shows one string, and the handle is the one that
        // disambiguates two accounts on the same device — which is exactly the
        // case somebody with a personal and a work login is in.
        let name = (user["name"] as? String)
            ?? (user["displayName"] as? String)
            ?? ""
        return CreationOptions(challenge: challenge, userId: userId, userName: name)
    }

    /// Build the `RegistrationResponseJSON` GoTrue's verify step expects.
    ///
    /// The field set matches what the JavaScript SDK produces on a browser
    /// without WebAuthn Level 3 — `id`, `rawId`, `response.attestationObject`,
    /// `response.clientDataJSON`, `type`, `clientExtensionResults` — because
    /// that is the shape the server has always been fed and the one it parses.
    static func registrationResponseJson(
        credentialId: Data,
        clientDataJson: Data,
        attestationObject: Data
    ) -> String? {
        let id = base64UrlEncode(credentialId)
        let payload: [String: Any] = [
            "id": id,
            "rawId": id,
            "type": "public-key",
            "response": [
                "clientDataJSON": base64UrlEncode(clientDataJson),
                "attestationObject": base64UrlEncode(attestationObject),
            ],
            // Present and empty rather than absent: the server reads this key,
            // and an absent one has been the difference between a parse and a
            // 400 on more than one WebAuthn implementation.
            "clientExtensionResults": [String: String](),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    /// Whether this domain has authorised this app to hold passkeys for it.
    ///
    /// The same probe Android runs, against the file Apple reads: until
    /// `/.well-known/apple-app-site-association` lists this bundle under
    /// `webcredentials`, every ceremony fails — and it fails the way a bug does.
    /// Offering a button that cannot work is worse than not offering it, and
    /// this audience is standing in somebody's driveway when they try it.
    ///
    /// Read from the web app rather than from a build flag because a flag needs
    /// an App Store release to flip, and the file needs a deploy. Passkeys
    /// appear the day they start working, on phones installed months earlier.
    ///
    /// Any failure is `false`: no network, no passkey offer, and the
    /// authenticator app is right there needing nothing.
    static func isDomainAssociated(
        rpId: String = Passkeys.relyingPartyId,
        bundleId: String? = Bundle.main.bundleIdentifier
    ) async -> Bool {
        guard let bundleId,
              let url = URL(string: "https://\(rpId)/.well-known/apple-app-site-association")
        else { return false }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
            return associationLists(bundleId: bundleId, in: data)
        } catch {
            return false
        }
    }

    /// Whether an apple-app-site-association document names this bundle.
    ///
    /// Suffix-matched on `.<bundleId>` because the entries are Team-ID
    /// prefixed and the team id is not knowable here without reading the
    /// provisioning profile. That is enough for the question being asked —
    /// "has anybody configured this domain for iOS" — and the platform re-checks
    /// the whole association anyway, refusing on any mismatch. This is a UI
    /// gate, not a security one.
    static func associationLists(bundleId: String, in data: Data) -> Bool {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let webcredentials = root["webcredentials"] as? [String: Any],
              let apps = webcredentials["apps"] as? [String]
        else { return false }
        return apps.contains { $0.hasSuffix(".\(bundleId)") }
    }
}

/// Runs the platform's passkey creation sheet and hands back the credential.
///
/// A class with a strong self-reference for the duration: `ASAuthorizationController`
/// holds its delegate weakly, so a flow driven from a free function would be
/// deallocated between `performRequests()` and the callback, and the sheet would
/// simply never answer.
@MainActor
final class PasskeyEnrolment: NSObject {
    /// Held strong — the controller does not, and neither would anything else
    /// once the enclosing function has suspended.
    private var controller: ASAuthorizationController?
    private var retain: PasskeyEnrolment?
    private var continuation: CheckedContinuation<ASAuthorization?, Error>?

    /// Present the sheet.
    ///
    /// Returns nil when the person dismissed it, which is not an error to
    /// report: shouting at somebody who changed their mind teaches them that the
    /// button was dangerous.
    func createCredential(
        rpId: String,
        options: Passkeys.CreationOptions
    ) async throws -> ASAuthorization? {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: rpId
        )
        let request = provider.createCredentialRegistrationRequest(
            challenge: options.challenge,
            name: options.userName,
            userID: options.userId
        )
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        retain = self

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }

    /// Resume once and only once. The system is not required to call exactly one
    /// of these, and resuming a continuation twice is a crash rather than a bug
    /// report.
    private func finish(_ result: Result<ASAuthorization?, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        controller = nil
        retain = nil
        continuation.resume(with: result)
    }
}

/// The system calls these on the main thread; the `@preconcurrency` conformance's
/// main-actor assumption always holds. Same pattern as `GoogleSignInFlow`.
extension PasskeyEnrolment: @preconcurrency ASAuthorizationControllerDelegate {
    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        finish(.success(authorization))
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        // A cancel is a decision, not a failure.
        if (error as? ASAuthorizationError)?.code == .canceled {
            finish(.success(nil))
            return
        }
        finish(.failure(error))
    }
}

extension PasskeyEnrolment: @preconcurrency ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
        return windows.first { $0.isKeyWindow } ?? windows.first ?? ASPresentationAnchor()
    }
}
