import CryptoKit
import Foundation
import Security

/// RFC 7636 PKCE pieces for the native OAuth flow (#166).
///
/// Verifier: 43–128 characters from the unreserved set. The alphabet below is
/// a 64-character subset of it (unreserved minus "." and "~"), so `byte & 63`
/// maps random bytes to characters with zero modulo bias.
enum Pkce {
    static let alphabet = Array(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    )

    /// Cryptographically random verifier (default 64 chars).
    static func generateVerifier(length: Int = 64) -> String {
        precondition((43 ... 128).contains(length), "RFC 7636 §4.1 verifier length")
        var bytes = [UInt8](repeating: 0, count: length)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            // SecRandomCopyBytes practically never fails; if it does, fall
            // back to the system CSPRNG instead of aborting sign-in.
            var generator = SystemRandomNumberGenerator()
            for index in bytes.indices {
                bytes[index] = UInt8.random(in: .min ... .max, using: &generator)
            }
        }
        return String(bytes.map { alphabet[Int($0 & 63)] })
    }

    /// S256 challenge: base64url(SHA-256(ASCII(verifier))), no padding.
    static func challenge(for verifier: String) -> String {
        base64Url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// RFC 4648 §5 base64url, padding stripped.
    static func base64Url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Sign in with Apple nonce pair (#166): the AUTHORIZATION REQUEST carries
/// SHA-256(raw) as lowercase hex (Apple embeds that hash in the identity
/// token); Supabase gets the RAW nonce and recomputes the hash server-side.
enum SiwaNonce {
    /// Fresh random raw nonce — mint one per authorization request.
    static func random() -> String {
        Pkce.generateVerifier(length: 43)
    }

    /// Lowercase-hex SHA-256 for `ASAuthorizationAppleIDRequest.nonce`.
    static func sha256Hex(_ raw: String) -> String {
        SHA256.hash(data: Data(raw.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}
