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

/// #330 — everything of the customer's that lives outside the session, wiped when the
/// session ends.
///
/// ## Why it hangs off the STORE rather than off sign-out
///
/// A session ends two ways: somebody taps Sign out, or the server refuses the refresh
/// token because the session was revoked. Only the first went through
/// `AppGraph.signOut`, so only the first cleared the per-workspace unread counts. The
/// second — a member deactivated, or an owner signing a departed tech's phone out from
/// Devices (#236) — dropped the token and left the customer's data sitting on a phone
/// the company does not own and cannot ask back. That is the case #330 says matters
/// most.
///
/// Attaching it to `SessionStore.clear()` rather than to either call site means a
/// third way for a session to end cannot forget: whatever kills the session runs this.
///
/// ## Every listener must tolerate being wrong about the reason
///
/// A revocation arrives on a background refresh with a screen open. The token is
/// already gone and the person is on their way to the sign-in screen either way, so a
/// failed cache eviction must never become a crash on the way out.
enum SessionEnded {
    private static let lock = NSLock()
    private nonisolated(unsafe) static var listeners: [() -> Void] = []

    /// Registered once, by the composition root.
    static func onEnded(_ listener: @escaping () -> Void) {
        lock.lock()
        listeners.append(listener)
        lock.unlock()
    }

    /// Called by `SessionStore.clear()`.
    static func fire() {
        lock.lock()
        let current = listeners
        lock.unlock()
        for listener in current { listener() }
    }

    /// Tests only: the app registers at startup and never unregisters.
    static func reset() {
        lock.lock()
        listeners.removeAll()
        lock.unlock()
    }
}

/// Where the encoded session actually lives. #599.
///
/// Three calls, pulled out of `SessionStore` so the thing the simulator test host lacks
/// — the keychain — is separable from the logic that sits on top of it. Everything else
/// about the store is unchanged: same encoding, same broadcast, same lock.
protocol SessionStorage: Sendable {
    func read() -> Data?
    func write(_ data: Data)
    func remove()
}

/// The real one, and the default. Same item, same accessibility, this-device-only.
struct KeychainSessionStorage: SessionStorage {
    private let service = "com.loonext.ios.session"
    private let account = "supabase"

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func read() -> Data? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return data
    }

    func write(_ data: Data) {
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

    func remove() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

/// Session persistence, keychain-backed by default.
///
/// `changes` broadcasts every save/clear (a refresh save included) so the root
/// state machine can react to sign-in/sign-out — the Keychain itself has no
/// observation API.
final class SessionStore: @unchecked Sendable {
    private let storage: SessionStorage
    private let lock = NSLock()
    private var observers: [UUID: AsyncStream<Session?>.Continuation] = [:]

    /// #599: defaulted, so every production call site is unchanged.
    init(storage: SessionStorage = KeychainSessionStorage()) {
        self.storage = storage
    }

    func current() -> Session? {
        lock.lock()
        defer { lock.unlock() }
        guard let data = storage.read() else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    func save(_ session: Session) {
        lock.lock()
        guard let data = try? JSONEncoder().encode(session) else {
            lock.unlock()
            return
        }
        storage.write(data)
        let continuations = Array(observers.values)
        lock.unlock()
        for continuation in continuations { continuation.yield(session) }
    }

    func clear() {
        lock.lock()
        storage.remove()
        let continuations = Array(observers.values)
        lock.unlock()
        // #330: the customer's data goes with the session, however it ended. Fired
        // before the observers so the root state machine never repaints a signed-out
        // screen over caches that are still full.
        SessionEnded.fire()
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

}
