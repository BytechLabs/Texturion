import Foundation

/// #243 — workspace API keys. Twin of the Android `core/model/ApiKeys.kt`.
///
/// The token is not a property here, because it is not a field in any response
/// but the one that mints it. It exists outside the caller's own app exactly
/// once, in the 201, as `MintedApiKey.token_once`.
struct ApiKey: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    /// The first twelve characters, so three keys can be told apart.
    let token_prefix: String
    var scopes: [String] = []
    var created_at: String?
    /// The field that makes switching one off safe: is anything still calling?
    var last_used_at: String?
    var revoked_at: String?
    var expires_at: String?
}

struct ApiKeyList: Codable, Sendable {
    var keys: [ApiKey] = []
    var cap: Int = 0
    /// Live keys only — revoking makes room, so the cap counts what is on.
    var live: Int = 0
}

struct MintedApiKey: Codable, Sendable {
    let key: ApiKey
    let token_once: String
}

struct CreateApiKeyBody: Codable, Sendable {
    let name: String
    let scopes: [String]
}
