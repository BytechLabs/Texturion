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
///
/// `changes` broadcasts every save/clear (a refresh save included) so the root
/// state machine can react to sign-in/sign-out — the Keychain itself has no
/// observation API.
final class SessionStore: @unchecked Sendable {
    private let service = "com.loonext.ios.session"
    private let account = "supabase"
    private let lock = NSLock()
    private var observers: [UUID: AsyncStream<Session?>.Continuation] = [:]

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
        guard let data = try? JSONEncoder().encode(session) else {
            lock.unlock()
            return
        }
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
        let continuations = Array(observers.values)
        lock.unlock()
        for continuation in continuations { continuation.yield(session) }
    }

    func clear() {
        lock.lock()
        SecItemDelete(baseQuery as CFDictionary)
        let continuations = Array(observers.values)
        lock.unlock()
        for continuation in continuations { continuation.yield(nil) }
    }

    /// Emits after every save/clear (never an initial value) — each call
    /// returns an independent stream.
    var changes: AsyncStream<Session?> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<Session?>.makeStream(
            bufferingPolicy: .bufferingNewest(1)
        )
        continuation.onTermination = { [weak self] _ in
            guard let self else { return }
            self.lock.lock()
            self.observers.removeValue(forKey: id)
            self.lock.unlock()
        }
        lock.lock()
        observers[id] = continuation
        lock.unlock()
        return stream
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
