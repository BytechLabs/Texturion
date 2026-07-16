import Foundation
import Security

/// The persisted Supabase session.
struct Session: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    /// Epoch seconds when the access token expires.
    let expiresAt: TimeInterval
    let userId: String
    let email: String

    var isExpired: Bool {
        // 60s early so a token never dies mid-request.
        Date().timeIntervalSince1970 >= expiresAt - 60
    }
}

/// Keychain-backed session persistence (kSecClassGenericPassword, this-device-only).
final class SessionStore: @unchecked Sendable {
    private let service = "com.loonext.ios.session"
    private let account = "supabase"
    private let lock = NSLock()

    func current() -> Session? {
        lock.lock()
        defer { lock.unlock() }
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    func save(_ session: Session) {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? JSONEncoder().encode(session) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = baseQuery
            add.merge(attributes) { _, new in new }
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        SecItemDelete(baseQuery as CFDictionary)
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
